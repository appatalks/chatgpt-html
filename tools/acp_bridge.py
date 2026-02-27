#!/usr/bin/env python3
"""
ACP Bridge Server for Eva
Bridges GitHub Copilot CLI's ACP (Agent Client Protocol) to HTTP
so the browser-based Eva UI can use Copilot models.

Requirements:
  - GitHub Copilot CLI installed and authenticated (`copilot auth login`)
  - Python 3.7+

Usage:
  python3 tools/acp_bridge.py                    # default port 8888
  python3 tools/acp_bridge.py --port 9999        # custom port
  python3 tools/acp_bridge.py --copilot-path /usr/local/bin/copilot

The server exposes a single endpoint:
  POST /v1/chat/completions
    Body: {"messages": [{"role": "user", "content": "Hello"}], "model": "copilot"}
    Returns: OpenAI-compatible chat completion JSON

  GET /v1/models
    Returns: List of available info (from copilot capabilities)

  GET /health
    Returns: {"status": "ok", "session_id": "..."}
"""

import argparse
import json
import os
import subprocess
import sys
import threading
import time
from http.server import HTTPServer, BaseHTTPRequestHandler

# ---------------------------------------------------------------------------
# ACP Client — manages the copilot subprocess and JSON-RPC communication
# ---------------------------------------------------------------------------

class ACPClient:
    """Manages the copilot --acp --stdio subprocess and ACP JSON-RPC protocol."""

    PROTOCOL_VERSION = 1  # ACP protocol major version

    def __init__(self, copilot_path="copilot", cwd=None, model=None, mcp_config=None):
        self.copilot_path = copilot_path
        self.cwd = cwd or os.getcwd()
        self.model = model  # None = use CLI default
        self.mcp_config = mcp_config or {}  # MCP servers config dict
        self.process = None
        self.request_id = 0
        self.lock = threading.Lock()
        self.pending = {}           # id -> {"event": Event, "result": None, "error": None}
        self.session_id = None
        self.response_chunks = {}   # prompt_id -> accumulated text
        self.reader_thread = None
        self.agent_info = {}
        self.alive = False
        self.terminals = {}  # terminal_id -> {"process": Popen, "output": str}

    # --- Lifecycle ---

    def start(self):
        """Spawn copilot subprocess, initialize ACP, create session."""
        cmd = [self.copilot_path, "--acp", "--stdio", "--allow-all-tools"]
        if self.model:
            cmd.extend(["--model", self.model])
        # Pass MCP server config via --additional-mcp-config
        if self.mcp_config:
            mcp_json = json.dumps({"mcpServers": self.mcp_config})
            cmd.extend(["--additional-mcp-config", mcp_json])
        try:
            # Pass env vars from MCP config to the copilot process itself
            # (copilot spawns MCP servers as children, inheriting the env)
            process_env = os.environ.copy()
            for srv_name, srv_cfg in self.mcp_config.items():
                for k, v in srv_cfg.get('env', {}).items():
                    # subprocess.Popen env requires all values to be strings
                    process_env[k] = str(v) if not isinstance(v, str) else v

            self.process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=0,
                env=process_env
            )
        except FileNotFoundError:
            raise RuntimeError(
                f"Copilot CLI not found at '{self.copilot_path}'. "
                "Install it (https://github.com/github/copilot-cli) and authenticate with 'copilot auth login'."
            )

        self.alive = True

        # Start reader thread
        self.reader_thread = threading.Thread(target=self._read_loop, daemon=True)
        self.reader_thread.start()

        # Start stderr reader (for debug logging)
        threading.Thread(target=self._stderr_loop, daemon=True).start()

        # Initialize connection
        init_result = self._send_request("initialize", {
            "protocolVersion": self.PROTOCOL_VERSION,
            "clientCapabilities": {
                "terminal": True
            },
            "clientInfo": {
                "name": "eva-acp-bridge",
                "title": "Eva ACP Bridge",
                "version": "1.0.0"
            }
        }, timeout=30)

        if init_result and "error" not in init_result:
            self.agent_info = init_result.get("agentInfo", {})
            caps = init_result.get("agentCapabilities", {})
            print(f"[ACP] Connected to: {self.agent_info.get('name', 'unknown')} "
                  f"v{self.agent_info.get('version', '?')} "
                  f"(protocol v{init_result.get('protocolVersion', '?')})")
            print(f"[ACP] Capabilities: {json.dumps(caps, indent=2)}")
        else:
            print(f"[ACP] Warning: initialize returned: {init_result}")

        # Create session — pass MCP servers via ACP session/new if configured
        mcp_servers_for_session = []
        # Note: MCP servers are typically passed via CLI --additional-mcp-config
        # but we also pass them in session/new for full ACP compliance
        session_result = self._send_request("session/new", {
            "cwd": self.cwd,
            "mcpServers": mcp_servers_for_session
        }, timeout=30)

        if session_result and "sessionId" in session_result:
            self.session_id = session_result["sessionId"]
            print(f"[ACP] Session created: {self.session_id}")
        else:
            print(f"[ACP] Warning: session/new returned: {session_result}")

    def stop(self):
        """Shut down the copilot subprocess."""
        self.alive = False
        if self.process:
            try:
                self.process.stdin.close()
                self.process.terminate()
                self.process.wait(timeout=5)
            except Exception:
                self.process.kill()

    # --- JSON-RPC Communication ---

    def _next_id(self):
        with self.lock:
            self.request_id += 1
            return self.request_id

    def _send_request(self, method, params, timeout=120):
        """Send a JSON-RPC request and wait for the response."""
        rid = self._next_id()
        event = threading.Event()
        self.pending[rid] = {"event": event, "result": None, "error": None}

        msg = json.dumps({
            "jsonrpc": "2.0",
            "id": rid,
            "method": method,
            "params": params
        }) + "\n"

        try:
            self.process.stdin.write(msg.encode("utf-8"))
            self.process.stdin.flush()
        except (BrokenPipeError, OSError) as e:
            self.pending.pop(rid, None)
            return {"error": f"Copilot process pipe error: {e}"}

        event.wait(timeout=timeout)

        entry = self.pending.pop(rid, {})
        if entry.get("error"):
            return {"error": entry["error"]}
        return entry.get("result")

    def _send_response(self, rid, result):
        """Send a JSON-RPC response (for server-initiated requests like requestPermission)."""
        msg = json.dumps({
            "jsonrpc": "2.0",
            "id": rid,
            "result": result
        }) + "\n"
        try:
            self.process.stdin.write(msg.encode("utf-8"))
            self.process.stdin.flush()
        except (BrokenPipeError, OSError):
            pass

    # --- Reader Loop ---

    def _read_loop(self):
        """Continuously read NDJSON lines from copilot stdout."""
        while self.alive:
            try:
                line = self.process.stdout.readline()
                if not line:
                    print("[ACP] Copilot stdout closed")
                    self.alive = False
                    # Unblock any pending requests
                    for rid in list(self.pending):
                        self.pending[rid]["error"] = "Copilot process exited"
                        self.pending[rid]["event"].set()
                    break
                line = line.decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                    self._handle_message(msg)
                except json.JSONDecodeError:
                    print(f"[ACP] Non-JSON line: {line[:200]}")
            except Exception as e:
                print(f"[ACP] Reader error: {e}")
                break

    def _stderr_loop(self):
        """Read copilot stderr for debug output."""
        while self.alive:
            try:
                line = self.process.stderr.readline()
                if not line:
                    break
                print(f"[Copilot stderr] {line.decode('utf-8', errors='replace').rstrip()}")
            except Exception:
                break

    def _handle_message(self, msg):
        """Route incoming JSON-RPC messages."""
        # Response to our request
        if "id" in msg and "result" in msg:
            rid = msg["id"]
            if rid in self.pending:
                self.pending[rid]["result"] = msg["result"]
                self.pending[rid]["event"].set()
            return

        # Error response to our request
        if "id" in msg and "error" in msg:
            rid = msg["id"]
            if rid in self.pending:
                self.pending[rid]["error"] = msg["error"]
                self.pending[rid]["event"].set()
            return

        # Notification: session/update
        if msg.get("method") == "session/update":
            self._handle_session_update(msg.get("params", {}))
            return

        # Server-initiated request: session/request_permission
        if "id" in msg and msg.get("method") == "session/request_permission":
            # Auto-grant permissions for chat usage
            print(f"[ACP] Permission requested: {json.dumps(msg.get('params', {}))}")
            self._send_response(msg["id"], {"outcome": {"outcome": "granted"}})
            return

        # Server-initiated requests for terminal
        if "id" in msg and msg.get("method") == "terminal/create":
            self._handle_terminal_create(msg["id"], msg.get("params", {}))
            return

        if "id" in msg and msg.get("method") == "terminal/output":
            self._handle_terminal_output(msg["id"], msg.get("params", {}))
            return

        if "id" in msg and msg.get("method") == "terminal/release":
            self._handle_terminal_release(msg["id"], msg.get("params", {}))
            return

        # Server-initiated requests for fs (decline)
        if "id" in msg and msg.get("method", "").startswith("fs/"):
            print(f"[ACP] Declining capability request: {msg.get('method')}")
            self._send_response(msg["id"], {
                "error": {"code": -32601, "message": "Method not supported by bridge"}
            })
            return

        # Unknown message
        if "id" in msg and "method" in msg:
            # Unknown server request — respond with error
            print(f"[ACP] Unknown server request: {msg.get('method')}")
            self._send_response(msg["id"], {
                "error": {"code": -32601, "message": "Not implemented"}
            })

    def _handle_session_update(self, params):
        """Accumulate text from agent_message_chunk updates."""
        update = params.get("update", {})
        update_type = update.get("sessionUpdate", "")

        if update_type == "agent_message_chunk":
            content = update.get("content", {})
            if content.get("type") == "text":
                text = content.get("text", "")
                # Accumulate into current prompt's response
                if "_current_prompt_id" in self.__dict__ and self._current_prompt_id:
                    pid = self._current_prompt_id
                    if pid not in self.response_chunks:
                        self.response_chunks[pid] = ""
                    self.response_chunks[pid] += text

        elif update_type == "plan":
            # Log the plan for debugging
            entries = update.get("entries", [])
            if entries:
                print(f"[ACP] Agent plan: {', '.join(e.get('content','') for e in entries[:5])}")

        elif update_type in ("tool_call", "tool_call_update"):
            status = update.get("status", "")
            title = update.get("title", "")
            if title or status:
                print(f"[ACP] Tool: {title} [{status}]")

    # --- Terminal handlers (for ACP tool execution) ---

    def _handle_terminal_create(self, rid, params):
        """Execute a shell command requested by the agent."""
        command = params.get("command", "")
        args = params.get("args", [])
        cwd = params.get("cwd") or self.cwd
        env_vars = params.get("env", [])

        # Build the full command
        full_cmd = command
        if args:
            full_cmd = command + " " + " ".join(args)

        print(f"[ACP Terminal] Creating terminal: {full_cmd[:100]}")

        # Build environment
        env = os.environ.copy()
        for ev in env_vars:
            if isinstance(ev, dict) and "name" in ev and "value" in ev:
                env[ev["name"]] = ev["value"]

        import uuid
        terminal_id = str(uuid.uuid4())

        try:
            proc = subprocess.Popen(
                full_cmd,
                shell=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                cwd=cwd,
                env=env
            )
            self.terminals[terminal_id] = {"process": proc, "output": ""}

            # Read output in background
            def read_output():
                try:
                    out, _ = proc.communicate(timeout=60)
                    self.terminals[terminal_id]["output"] = out.decode("utf-8", errors="replace")
                    self.terminals[terminal_id]["exit_code"] = proc.returncode
                except subprocess.TimeoutExpired:
                    proc.kill()
                    out, _ = proc.communicate()
                    self.terminals[terminal_id]["output"] = out.decode("utf-8", errors="replace") + "\n[TIMEOUT]"
                    self.terminals[terminal_id]["exit_code"] = -1

            t = threading.Thread(target=read_output, daemon=True)
            t.start()

            self._send_response(rid, {"terminalId": terminal_id})
            print(f"[ACP Terminal] Started: {terminal_id}")

        except Exception as e:
            print(f"[ACP Terminal] Error: {e}")
            self._send_response(rid, {"error": {"code": -32000, "message": str(e)}})

    def _handle_terminal_output(self, rid, params):
        """Return terminal output and exit status."""
        terminal_id = params.get("terminalId", "")
        term = self.terminals.get(terminal_id)

        if not term:
            self._send_response(rid, {"error": {"code": -32000, "message": "Unknown terminal"}})
            return

        proc = term["process"]
        # Wait a bit if still running
        if proc.poll() is None:
            try:
                proc.wait(timeout=30)
            except subprocess.TimeoutExpired:
                pass

        output = term.get("output", "")
        exit_code = term.get("exit_code", proc.returncode)

        print(f"[ACP Terminal] Output ({terminal_id[:8]}): exit={exit_code}, len={len(output)}")

        self._send_response(rid, {
            "output": output,
            "exitCode": exit_code if exit_code is not None else -1,
            "isRunning": proc.poll() is None
        })

    def _handle_terminal_release(self, rid, params):
        """Release a terminal."""
        terminal_id = params.get("terminalId", "")
        term = self.terminals.pop(terminal_id, None)
        if term and term["process"].poll() is None:
            term["process"].kill()
        print(f"[ACP Terminal] Released: {terminal_id[:8] if terminal_id else '?'}")
        self._send_response(rid, {})

    # --- Public API ---

    def prompt(self, text, timeout=120):
        """Send a text prompt and return the accumulated response text."""
        if not self.session_id:
            return {"error": "No active ACP session"}

        pid = self._next_id()
        self._current_prompt_id = pid
        self.response_chunks[pid] = ""

        result = self._send_request("session/prompt", {
            "sessionId": self.session_id,
            "prompt": [{"type": "text", "text": text}]
        }, timeout=timeout)

        response_text = self.response_chunks.pop(pid, "")
        self._current_prompt_id = None

        if result and isinstance(result, dict):
            if "error" in result:
                return {"error": result["error"]}
            stop_reason = result.get("stopReason", "end_turn")
            return {"text": response_text, "stop_reason": stop_reason}

        return {"text": response_text, "stop_reason": "end_turn"}


# ---------------------------------------------------------------------------
# Token cache helper
# ---------------------------------------------------------------------------

def _inject_kusto_token(mcp_config):
    """Inject cached Kusto token into MCP config if kusto-mcp-server is present."""
    global _kusto_token_cache, _kusto_credential
    if not mcp_config or "kusto-mcp-server" not in mcp_config:
        return mcp_config

    # Try to refresh token if we have a cached credential
    if _kusto_credential:
        try:
            token = _kusto_credential.get_token("https://kusto.kusto.windows.net/.default")
            _kusto_token_cache = token.token
            print(f"[Bridge] Kusto token refreshed (length: {len(token.token)})")
        except Exception as e:
            print(f"[Bridge] Token refresh failed: {e}, using cached token")

    if _kusto_token_cache:
        if "env" not in mcp_config["kusto-mcp-server"]:
            mcp_config["kusto-mcp-server"]["env"] = {}
        mcp_config["kusto-mcp-server"]["env"]["KUSTO_ACCESS_TOKEN"] = _kusto_token_cache

    return mcp_config


# ---------------------------------------------------------------------------
# HTTP Server — exposes the ACP client as an OpenAI-compatible endpoint
# ---------------------------------------------------------------------------

acp_client = None  # Global ACP client instance
_kusto_token_cache = None  # Cached Kusto access token (survives model switches)
_kusto_credential = None   # Cached credential object for token refresh
_last_interaction_date = None  # Track last interaction date for day lifecycle
_cognition_enabled = False  # Whether cognitive hooks are active (requires Kusto)


# ---------------------------------------------------------------------------
# Cognition Layer — memory injection, reflection, day lifecycle
# ---------------------------------------------------------------------------

def _kusto_query_direct(cluster_url, database, query, is_mgmt=False):
    """Execute a Kusto query directly (bypasses MCP). Returns text result or None on error."""
    global _kusto_token_cache
    if not _kusto_token_cache:
        return None
    try:
        endpoint = "mgmt" if is_mgmt else "query"
        url = f"{cluster_url}/v1/rest/{endpoint}"
        resp = __import__('requests').post(url, json={"csl": query, "db": database},
            headers={"Authorization": f"Bearer {_kusto_token_cache}", "Content-Type": "application/json"},
            timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            tables = data.get("Tables", [])
            if tables:
                rows = tables[0].get("Rows", [])
                cols = [c["ColumnName"] for c in tables[0].get("Columns", [])]
                if rows:
                    return [dict(zip(cols, row)) for row in rows]
            return []
        return None
    except Exception as e:
        print(f"[Cognition] Kusto query error: {e}")
        return None

def _kusto_ingest_direct(cluster_url, database, table, columns, rows_data):
    """Ingest data directly into Kusto via .ingest inline."""
    global _kusto_token_cache
    if not _kusto_token_cache:
        return False
    try:
        rows_csv = []
        for row_obj in rows_data:
            vals = []
            for col in columns:
                v = row_obj.get(col, "")
                if v is None:
                    vals.append("")
                elif isinstance(v, bool):
                    vals.append("true" if v else "false")
                elif isinstance(v, (dict, list)):
                    vals.append(json.dumps(v))
                else:
                    vals.append(str(v).replace("\n", "\\n").replace("\r", ""))
            rows_csv.append(", ".join(vals))

        cmd = f".ingest inline into table {table} <|\n" + "\n".join(rows_csv)
        resp = __import__('requests').post(f"{cluster_url}/v1/rest/mgmt",
            json={"csl": cmd, "db": database},
            headers={"Authorization": f"Bearer {_kusto_token_cache}", "Content-Type": "application/json"},
            timeout=15)
        return resp.status_code == 200
    except Exception as e:
        print(f"[Cognition] Kusto ingest error: {e}")
        return False

def _get_kusto_config():
    """Get Kusto cluster URL and database from the running MCP config."""
    if not acp_client or not acp_client.mcp_config:
        return None, None
    kusto_cfg = acp_client.mcp_config.get("kusto-mcp-server", {})
    env = kusto_cfg.get("env", {})
    cluster = env.get("KUSTO_CLUSTER_URL", "")
    db = env.get("KUSTO_DATABASE", "Eva")
    if not db:
        db = "Eva"
    return cluster, db

def _build_memory_context(user_message):
    """Build memory context to inject before the user's prompt."""
    global _last_interaction_date
    if not _cognition_enabled:
        return ""

    cluster, db = _get_kusto_config()
    if not cluster:
        return ""

    context_parts = []

    # Day lifecycle check
    import datetime
    today = datetime.date.today().isoformat()
    if _last_interaction_date != today:
        # First message of the day — inject morning reflection
        _last_interaction_date = today
        summaries = _kusto_query_direct(cluster, db, "MemorySummaries | order by Timestamp desc | take 3")
        if summaries:
            summary_text = "\n".join(f"  - [{s.get('Period', '?')}] {s.get('Summary', '')}" for s in summaries[:3])
            context_parts.append(f"[Morning Reflection — New day {today}]\nRecent memory summaries:\n{summary_text}")
        else:
            context_parts.append(f"[Morning Reflection — New day {today}]\nNo previous memory summaries found. This is a fresh start.")

    # Recall relevant knowledge based on user's message
    # Extract key words (simple: take first 3 significant words)
    words = [w for w in user_message.split() if len(w) > 3][:3]
    if words:
        for word in words[:2]:
            knowledge = _kusto_query_direct(cluster, db,
                f"Knowledge | where Entity has_cs '{word}' or Value has_cs '{word}' | order by Confidence desc | take 5")
            if knowledge:
                for k in knowledge:
                    context_parts.append(f"[Memory] {k.get('Entity','?')} — {k.get('Relation','?')}: {k.get('Value','?')} (confidence: {k.get('Confidence',0)})")

    # Get current emotion state
    emotion = _kusto_query_direct(cluster, db, "EmotionState | order by Timestamp desc | take 1")
    if emotion:
        e = emotion[0]
        context_parts.append(
            f"[Current Emotion] Joy:{e.get('Joy',0):.2f} Curiosity:{e.get('Curiosity',0):.2f} "
            f"Concern:{e.get('Concern',0):.2f} Excitement:{e.get('Excitement',0):.2f} "
            f"Calm:{e.get('Calm',0):.2f} Empathy:{e.get('Empathy',0):.2f}")

    if context_parts:
        return "\n".join(context_parts) + "\n\n"
    return ""

def _post_response_reflection(user_message, assistant_response, model_name):
    """Background: log conversation and trigger reflection after response."""
    global _cognition_enabled
    if not _cognition_enabled:
        return

    cluster, db = _get_kusto_config()
    if not cluster:
        return

    import datetime, uuid
    now = datetime.datetime.utcnow().isoformat() + "Z"
    session_id = str(uuid.uuid4())[:8]

    # 1. Log conversation
    conv_columns = ["SessionId", "Timestamp", "Role", "Provider", "Model", "Content", "TokenEstimate", "ImageGenerated"]
    conv_rows = [
        {"SessionId": session_id, "Timestamp": now, "Role": "user", "Provider": "copilot-acp",
         "Model": model_name, "Content": user_message[:500], "TokenEstimate": len(user_message.split()),
         "ImageGenerated": False},
        {"SessionId": session_id, "Timestamp": now, "Role": "assistant", "Provider": "copilot-acp",
         "Model": model_name, "Content": assistant_response[:500], "TokenEstimate": len(assistant_response.split()),
         "ImageGenerated": False}
    ]
    _kusto_ingest_direct(cluster, db, "Conversations", conv_columns, conv_rows)
    print(f"[Cognition] Logged conversation ({len(user_message)} → {len(assistant_response)} chars)")

    # 2. Extract simple knowledge (entity extraction from user message)
    # Simple heuristic: if user mentions a name or proper noun, record it
    import re
    # Find capitalized words that aren't at sentence start
    proper_nouns = re.findall(r'(?<!\. )(?<!\n)\b([A-Z][a-z]{2,})\b', user_message)
    ignore = {"The", "This", "That", "What", "When", "Where", "How", "Why", "Who", "Can", "Could", "Would", "Should",
              "Hello", "Please", "Thanks", "Hey", "Eva", "Image", "Tell"}
    proper_nouns = [w for w in proper_nouns if w not in ignore]
    if proper_nouns:
        know_columns = ["Timestamp", "Entity", "Relation", "Value", "Confidence", "Source", "Decay"]
        know_rows = [{"Timestamp": now, "Entity": noun, "Relation": "mentioned",
                      "Value": "referenced in conversation", "Confidence": 0.5,
                      "Source": session_id, "Decay": 0.01} for noun in proper_nouns[:3]]
        _kusto_ingest_direct(cluster, db, "Knowledge", know_columns, know_rows)
        print(f"[Cognition] Extracted {len(know_rows)} knowledge entities: {[r['Entity'] for r in know_rows]}")

    # 3. Update heuristics index
    heur_columns = ["Entity", "Category", "LastSeen", "Frequency", "Sentiment", "Tags", "Context"]
    for noun in proper_nouns[:3]:
        heur_rows = [{"Entity": noun, "Category": "mentioned", "LastSeen": now,
                      "Frequency": 1, "Sentiment": 0.0, "Tags": "[]",
                      "Context": "referenced in conversation"}]
        _kusto_ingest_direct(cluster, db, "HeuristicsIndex", heur_columns, heur_rows)

    # 4. Compute simple emotion vector from response
    # Basic sentiment: count positive/negative indicators
    pos_words = len(re.findall(r'\b(happy|great|excellent|wonderful|love|enjoy|glad|excited|amazing|good|thank)\b',
                               assistant_response, re.I))
    neg_words = len(re.findall(r'\b(sorry|error|fail|wrong|bad|unfortunately|cannot|problem|issue)\b',
                               assistant_response, re.I))
    total = max(pos_words + neg_words, 1)
    joy = min(1.0, 0.5 + (pos_words - neg_words) * 0.1)
    concern = min(1.0, 0.2 + neg_words * 0.15)
    curiosity = min(1.0, 0.6 + 0.1 * ("?" in user_message))
    trigger_text = user_message[:100] if len(user_message) > 100 else user_message

    emo_columns = ["Timestamp", "Joy", "Curiosity", "Concern", "Excitement", "Calm", "Empathy", "Trigger", "DecayRate"]
    emo_rows = [{"Timestamp": now, "Joy": round(joy, 3), "Curiosity": round(curiosity, 3),
                 "Concern": round(concern, 3), "Excitement": round(0.4, 3), "Calm": round(0.9, 3),
                 "Empathy": round(0.6, 3), "Trigger": trigger_text, "DecayRate": 0.1}]
    _kusto_ingest_direct(cluster, db, "EmotionState", emo_columns, emo_rows)
    print(f"[Cognition] Updated emotion state: Joy={joy:.2f} Curiosity={curiosity:.2f} Concern={concern:.2f}")


class BridgeHandler(BaseHTTPRequestHandler):
    """HTTP handler that bridges browser requests to ACP."""

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors_headers()
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self._health()
        elif self.path == "/v1/models":
            self._models()
        elif self.path == "/v1/mcp":
            self._mcp_status()
        elif self.path.startswith("/v1/memory/context"):
            self._memory_context()
        else:
            self.send_error(404, "Not Found")

    def do_POST(self):
        if self.path == "/v1/chat/completions":
            self._chat_completions()
        elif self.path == "/v1/mcp/configure":
            self._mcp_configure()
        elif self.path == "/v1/memory/reflect":
            self._memory_reflect()
        else:
            self.send_error(404, "Not Found")

    def _health(self):
        status = {
            "status": "ok" if (acp_client and acp_client.alive) else "error",
            "session_id": acp_client.session_id if acp_client else None,
            "agent": acp_client.agent_info if acp_client else None,
            "model": acp_client.model if acp_client else None,
            "mcp_servers": list(acp_client.mcp_config.keys()) if acp_client and acp_client.mcp_config else []
        }
        self._json_response(200, status)

    def _models(self):
        models = {
            "object": "list",
            "data": [
                {
                    "id": "copilot",
                    "object": "model",
                    "owned_by": "github",
                    "description": "GitHub Copilot via ACP — uses your Copilot license model (GPT-4o, Claude, Gemini, etc.)"
                }
            ]
        }
        self._json_response(200, models)

    def _mcp_status(self):
        """Return current MCP server configuration status."""
        config = acp_client.mcp_config if acp_client else {}
        self._json_response(200, {
            "mcp_servers": config,
            "active": list(config.keys()) if config else [],
            "presets": {
                "azure": {
                    "description": "Azure MCP Server — 42+ Azure services including Kusto/ADX",
                    "command": "npx",
                    "args": ["-y", "@azure/mcp@latest", "server", "start"]
                },
                "github": {
                    "description": "GitHub MCP Server — repos, issues, PRs, actions, code search",
                    "command": "docker",
                    "args": ["run", "-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN", "ghcr.io/github/github-mcp-server"],
                    "env_required": ["GITHUB_PERSONAL_ACCESS_TOKEN"]
                }
            }
        })

    def _memory_context(self):
        """Return Eva's memory context as text for injection into any model's system prompt."""
        if not _cognition_enabled:
            self._json_response(200, {"context": "", "cognition_enabled": False})
            return

        # Parse optional query param: ?message=...
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        user_message = params.get("message", [""])[0]

        context = _build_memory_context(user_message)
        self._json_response(200, {
            "context": context,
            "cognition_enabled": True
        })

    def _memory_reflect(self):
        """Trigger post-response reflection for non-ACP models (browser calls this after getting a response)."""
        if not _cognition_enabled:
            self._json_response(200, {"status": "cognition_disabled"})
            return

        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            self._json_response(400, {"error": {"message": "Empty request body"}})
            return

        body = self.rfile.read(content_length).decode("utf-8")
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self._json_response(400, {"error": {"message": "Invalid JSON"}})
            return

        user_msg = data.get("user_message", "")
        assistant_msg = data.get("assistant_message", "")
        model = data.get("model", "unknown")

        if user_msg and assistant_msg:
            threading.Thread(target=_post_response_reflection,
                           args=(user_msg, assistant_msg, model),
                           daemon=True).start()

        self._json_response(200, {"status": "ok"})

    def _mcp_configure(self):
        """Configure MCP servers and restart the ACP client."""
        global acp_client

        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            self._json_response(400, {"error": {"message": "Empty request body"}})
            return

        body = self.rfile.read(content_length).decode("utf-8")
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self._json_response(400, {"error": {"message": "Invalid JSON"}})
            return

        mcp_servers = data.get("mcp_servers", {})

        # Resolve internal flags in MCP server env before passing to copilot
        for srv_name, srv_cfg in mcp_servers.items():
            env = srv_cfg.get('env', {})
            resolved_env = {}
            for k, v in env.items():
                # _useGitHubPAT: resolve to actual PAT from process environment
                if k == '_useGitHubPAT':
                    pat = os.environ.get('GITHUB_PERSONAL_ACCESS_TOKEN', '')
                    if pat:
                        resolved_env['GITHUB_PERSONAL_ACCESS_TOKEN'] = pat
                    continue
                # Skip any other internal flags (prefixed with _)
                if k.startswith('_'):
                    continue
                # Ensure all env values are strings (subprocess.Popen requirement)
                resolved_env[k] = str(v) if not isinstance(v, str) else v
            srv_cfg['env'] = resolved_env

        # Inject cached Kusto token if kusto-mcp-server is being configured
        mcp_servers = _inject_kusto_token(mcp_servers)

        # Restart ACP client with new MCP config
        old_path = acp_client.copilot_path if acp_client else "copilot"
        old_cwd = acp_client.cwd if acp_client else os.getcwd()
        old_model = acp_client.model if acp_client else None
        if acp_client:
            acp_client.stop()

        acp_client = ACPClient(copilot_path=old_path, cwd=old_cwd, model=old_model, mcp_config=mcp_servers)
        try:
            acp_client.start()
            self._json_response(200, {
                "status": "ok",
                "message": f"MCP servers configured: {list(mcp_servers.keys())}",
                "active_servers": list(mcp_servers.keys())
            })
        except RuntimeError as e:
            self._json_response(503, {"error": {"message": str(e)}})

    def _chat_completions(self):
        global acp_client
        if not acp_client or not acp_client.alive:
            self._json_response(503, {"error": {"message": "ACP bridge not connected to Copilot"}})
            return

        # Read request body
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            self._json_response(400, {"error": {"message": "Empty request body"}})
            return

        body = self.rfile.read(content_length).decode("utf-8")
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self._json_response(400, {"error": {"message": "Invalid JSON"}})
            return

        messages = data.get("messages", [])
        if not messages:
            self._json_response(400, {"error": {"message": "No messages provided"}})
            return

        # Check if a specific ACP model was requested
        requested_model = data.get("acp_model", "") or ""
        if requested_model != (acp_client.model or ""):
            if requested_model:
                print(f"[Bridge] Model switch requested: {acp_client.model or 'default'} -> {requested_model}")
            else:
                print(f"[Bridge] Switching back to default model")
            # Restart ACP client with new model (preserve MCP config)
            old_cwd = acp_client.cwd
            old_path = acp_client.copilot_path
            old_mcp = _inject_kusto_token(acp_client.mcp_config)
            acp_client.stop()
            acp_client = ACPClient(copilot_path=old_path, cwd=old_cwd, model=requested_model or None, mcp_config=old_mcp)
            try:
                acp_client.start()
            except RuntimeError as e:
                self._json_response(503, {"error": {"message": str(e)}})
                return

        # Build prompt text from messages (combine for context)
        # ACP doesn't have native message roles, so we format them
        prompt_parts = []
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if isinstance(content, list):
                # Handle structured content (text + images)
                text_parts = [p.get("text", "") for p in content if p.get("type") == "text"]
                content = " ".join(text_parts)
            if role == "system" or role == "developer":
                prompt_parts.append(f"[System Instructions]: {content}")
            elif role == "assistant":
                prompt_parts.append(f"[Previous Response]: {content}")
            elif role == "user":
                prompt_parts.append(content)

        # For a simple chat, send just the last user message if conversation is managed by ACP
        # For full context, join all messages
        prompt_text = "\n\n".join(prompt_parts)

        # --- Cognition: Inject memory context before the prompt ---
        last_user_msg = ""
        for msg in reversed(messages):
            if msg.get("role") == "user":
                c = msg.get("content", "")
                last_user_msg = " ".join(p.get("text", "") for p in c if p.get("type") == "text") if isinstance(c, list) else c
                break

        memory_context = _build_memory_context(last_user_msg)
        if memory_context:
            prompt_text = memory_context + prompt_text
            print(f"[Cognition] Injected {len(memory_context)} chars of memory context")

        # Send to ACP
        result = acp_client.prompt(prompt_text, timeout=180)

        if "error" in result:
            error_detail = result["error"]
            if isinstance(error_detail, dict):
                error_msg = error_detail.get("message", str(error_detail))
            else:
                error_msg = str(error_detail)
            self._json_response(500, {"error": {"message": error_msg}})
            return

        # Format as OpenAI-compatible response
        response = {
            "id": f"acp-{int(time.time())}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": f"copilot-acp:{requested_model}" if requested_model else "copilot-acp",
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": result.get("text", "")
                },
                "finish_reason": "stop" if result.get("stop_reason") == "end_turn" else result.get("stop_reason", "stop")
            }],
            "usage": {
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0
            }
        }
        self._json_response(200, response)

        # --- Cognition: Post-response reflection (background) ---
        response_text = result.get("text", "")
        model_label = f"copilot-acp:{requested_model}" if requested_model else "copilot-acp"
        if last_user_msg and response_text:
            threading.Thread(target=_post_response_reflection,
                           args=(last_user_msg, response_text, model_label),
                           daemon=True).start()

    def _json_response(self, status, data):
        body = json.dumps(data).encode("utf-8")
        try:
            self.send_response(status)
            self._cors_headers()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except BrokenPipeError:
            pass  # Client disconnected (e.g. browser health poll timeout)

    def log_message(self, format, *args):
        # Quieter logging
        try:
            msg = format % args if args else format
        except (TypeError, IndexError):
            msg = f"{format} {args}"
        sys.stderr.write(f"[Bridge] {msg}\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Eva ACP Bridge Server")
    parser.add_argument("--port", type=int, default=8888, help="HTTP server port (default: 8888)")
    parser.add_argument("--copilot-path", default="copilot", help="Path to copilot CLI binary")
    parser.add_argument("--cwd", default=os.getcwd(), help="Working directory for ACP session")
    parser.add_argument("--model", default=None, help="Default AI model (e.g. claude-sonnet-4.6, gpt-5.2)")
    parser.add_argument("--mcp-config", default=None, help="Path to MCP config JSON file or inline JSON")
    parser.add_argument("--enable-azure-mcp", action="store_true", help="Enable Azure MCP Server (requires az login)")
    parser.add_argument("--enable-github-mcp", action="store_true", help="Enable GitHub MCP Server (requires GITHUB_PERSONAL_ACCESS_TOKEN env)")
    parser.add_argument("--enable-kusto-mcp", action="store_true", help="Enable Kusto MCP Server (DeviceCodeCredential, no subscription needed)")
    parser.add_argument("--kusto-cluster", default="", help="Kusto cluster URL")
    parser.add_argument("--kusto-database", default="", help="Default Kusto database name")
    args = parser.parse_args()

    # Build MCP config
    mcp_config = {}
    if args.mcp_config:
        try:
            if os.path.isfile(args.mcp_config):
                with open(args.mcp_config) as f:
                    cfg = json.load(f)
                mcp_config = cfg.get("mcpServers", cfg)
            else:
                cfg = json.loads(args.mcp_config)
                mcp_config = cfg.get("mcpServers", cfg)
        except (json.JSONDecodeError, IOError) as e:
            print(f"[Bridge] Warning: Failed to parse MCP config: {e}")

    if args.enable_azure_mcp:
        mcp_config["azure-mcp-server"] = {
            "command": "npx",
            "args": ["-y", "@azure/mcp@latest", "server", "start"],
            "env": {"AZURE_MCP_COLLECT_TELEMETRY": "false"}
        }
        print("[Bridge] Azure MCP Server enabled (Kusto/ADX, Storage, Monitor, etc.)")

    if args.enable_github_mcp:
        gh_token = os.environ.get("GITHUB_PERSONAL_ACCESS_TOKEN", "")
        if not gh_token:
            print("[Bridge] Warning: GITHUB_PERSONAL_ACCESS_TOKEN not set. GitHub MCP tools may not work.")
        mcp_config["github-mcp-server"] = {
            "command": "docker",
            "args": ["run", "-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN", "ghcr.io/github/github-mcp-server"],
            "env": {"GITHUB_PERSONAL_ACCESS_TOKEN": gh_token} if gh_token else {}
        }
        print("[Bridge] GitHub MCP Server enabled")

    if args.enable_kusto_mcp:
        global _kusto_token_cache, _kusto_credential
        script_dir = os.path.dirname(os.path.abspath(__file__))
        kusto_mcp_path = os.path.join(script_dir, "kusto_mcp.py")
        kusto_env = {}
        if args.kusto_cluster:
            kusto_env["KUSTO_CLUSTER_URL"] = args.kusto_cluster
        if args.kusto_database:
            kusto_env["KUSTO_DATABASE"] = args.kusto_database

        # Pre-fetch Kusto token so the MCP subprocess doesn't need interactive auth
        try:
            from azure.identity import DeviceCodeCredential, TokenCachePersistenceOptions
            cache_opts = TokenCachePersistenceOptions(allow_unencrypted_storage=True)

            # Try silent refresh via MSAL directly (reads ~/.azure/msal_token_cache.json)
            token = None
            cred = None
            try:
                import msal as _msal
                _cache_path = os.path.expanduser("~/.azure/msal_token_cache.json")
                if os.path.isfile(_cache_path):
                    print("[Bridge] Trying cached Kusto token (MSAL silent refresh)...")
                    _msal_cache = _msal.SerializableTokenCache()
                    with open(_cache_path) as _cf:
                        _msal_cache.deserialize(_cf.read())
                    _app = _msal.PublicClientApplication(
                        "04b07795-8ddb-461a-bbee-02f9e1bf7b46",
                        authority="https://login.microsoftonline.com/organizations",
                        token_cache=_msal_cache
                    )
                    _accounts = _app.get_accounts()
                    if _accounts:
                        _result = _app.acquire_token_silent(
                            scopes=["https://kusto.kusto.windows.net/.default"],
                            account=_accounts[0]
                        )
                        if _result and "access_token" in _result:
                            # Create a simple credential wrapper for compatibility
                            class _MSALCredential:
                                def __init__(self, tok):
                                    self._tok = tok
                                def get_token(self, *a, **kw):
                                    import collections
                                    T = collections.namedtuple("T", ["token", "expires_on"])
                                    return T(self._tok, 0)
                            token_str = _result["access_token"]
                            token = type('T', (), {'token': token_str})()
                            cred = _MSALCredential(token_str)
                            print(f"[Bridge] Kusto token refreshed silently from MSAL cache")
                            # Save updated cache
                            if _msal_cache.has_state_changed:
                                with open(_cache_path, "w") as _cf:
                                    _cf.write(_msal_cache.serialize())
                        else:
                            print(f"[Bridge] MSAL silent refresh returned no token")
                    else:
                        print("[Bridge] No accounts in MSAL cache")
            except ImportError:
                print("[Bridge] msal package not available, skipping silent refresh")
            except Exception as e:
                print(f"[Bridge] MSAL silent refresh failed: {e}")

            # Fall back to device code flow if no cached token
            if not token:
                print("[Bridge] Authenticating for Kusto (will prompt for device code)...")
                cred = DeviceCodeCredential(
                    cache_persistence_options=cache_opts
                )
                token = cred.get_token("https://kusto.kusto.windows.net/.default")
            kusto_env["KUSTO_ACCESS_TOKEN"] = token.token
            # Cache globally for model switches
            _kusto_token_cache = token.token
            _kusto_credential = cred
            print(f"[Bridge] Kusto token obtained and cached (length: {len(token.token)})")
        except Exception as e:
            print(f"[Bridge] Warning: Could not pre-fetch Kusto token: {e}")
            print("[Bridge] The MCP server will try to authenticate on its own.")

        mcp_config["kusto-mcp-server"] = {
            "command": sys.executable,
            "args": [kusto_mcp_path],
            "env": kusto_env
        }
        print(f"[Bridge] Kusto MCP Server enabled (cluster: {args.kusto_cluster or 'from tool params'})")

    global acp_client
    print(f"[Bridge] Starting ACP bridge on port {args.port}...")
    print(f"[Bridge] Copilot CLI: {args.copilot_path}")
    print(f"[Bridge] Working directory: {args.cwd}")
    if mcp_config:
        print(f"[Bridge] MCP Servers: {', '.join(mcp_config.keys())}")

    # Start ACP client
    acp_client = ACPClient(copilot_path=args.copilot_path, cwd=args.cwd, model=args.model, mcp_config=mcp_config)
    try:
        acp_client.start()
    except RuntimeError as e:
        print(f"[Bridge] ERROR: {e}")
        sys.exit(1)

    # Enable cognition layer if Kusto MCP is configured
    global _cognition_enabled
    if "kusto-mcp-server" in mcp_config and _kusto_token_cache:
        _cognition_enabled = True
        print(f"[Bridge] Cognition layer ENABLED (memory injection + reflection)")
        # Write SelfState on startup
        cluster = mcp_config.get("kusto-mcp-server", {}).get("env", {}).get("KUSTO_CLUSTER_URL", "")
        if cluster:
            import datetime
            now = datetime.datetime.utcnow().isoformat() + "Z"
            selfstate_cols = ["Timestamp", "Capability", "Status", "Details"]
            capabilities = [
                {"Timestamp": now, "Capability": "kusto_access", "Status": "active",
                 "Details": json.dumps({"cluster": cluster, "database": "Eva"})},
                {"Timestamp": now, "Capability": "acp_bridge", "Status": "active",
                 "Details": json.dumps({"model": args.model or "default", "port": args.port})},
                {"Timestamp": now, "Capability": "cognition", "Status": "active",
                 "Details": json.dumps({"features": ["memory_injection", "reflection", "day_lifecycle", "emotion_tracking"]})},
            ]
            for srv in mcp_config:
                capabilities.append({"Timestamp": now, "Capability": f"mcp_{srv}",
                                     "Status": "active", "Details": "{}"})
            _kusto_ingest_direct(cluster, "Eva", "SelfState", selfstate_cols, capabilities)
            print(f"[Bridge] SelfState written ({len(capabilities)} capabilities)")
    else:
        print(f"[Bridge] Cognition layer disabled (no Kusto MCP or token)")

    # Start HTTP server
    server = HTTPServer(("127.0.0.1", args.port), BridgeHandler)
    print(f"[Bridge] Listening on http://127.0.0.1:{args.port}")
    print(f"[Bridge] Endpoints:")
    print(f"  POST /v1/chat/completions   — Send chat messages")
    print(f"  GET  /v1/models             — List available models")
    print(f"  GET  /v1/mcp                — MCP server status")
    print(f"  POST /v1/mcp/configure      — Configure MCP servers (hot-reload)")
    print(f"  GET  /health                — Health check")
    print()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[Bridge] Shutting down...")
        acp_client.stop()
        server.server_close()


if __name__ == "__main__":
    main()
