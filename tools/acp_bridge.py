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
    EVA_ACP_PORT=9999 python3 tools/acp_bridge.py  # custom port via env
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
import re
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

def _refresh_kusto_token():
    """Try to refresh the cached Kusto token using the stored credential. Returns True if refreshed."""
    global _kusto_token_cache, _kusto_credential, _kusto_table_columns_cache
    if not _kusto_credential:
        return False
    try:
        prior = _kusto_token_cache
        token = _kusto_credential.get_token("https://kusto.kusto.windows.net/.default")
        _kusto_token_cache = token.token
        _kusto_table_columns_cache = {}
        refresh_state = "updated" if token.token != prior else "unchanged"
        print(f"[Bridge] Kusto token refreshed ({refresh_state}, length: {len(token.token)})")
        return True
    except Exception as e:
        print(f"[Bridge] Token refresh failed: {e}")
        return False

def _inject_kusto_token(mcp_config):
    """Inject cached Kusto token into MCP config if kusto-mcp-server is present."""
    global _kusto_token_cache
    if not mcp_config or "kusto-mcp-server" not in mcp_config:
        return mcp_config

    _refresh_kusto_token()

    if _kusto_token_cache:
        if "env" not in mcp_config["kusto-mcp-server"]:
            mcp_config["kusto-mcp-server"]["env"] = {}
        mcp_config["kusto-mcp-server"]["env"]["KUSTO_ACCESS_TOKEN"] = _kusto_token_cache

    return mcp_config

def _ensure_kusto_token():
    """Ensure the bridge has a Kusto token for direct bridge-side Kusto calls."""
    global _kusto_token_cache, _kusto_credential
    if _kusto_token_cache:
        return True, ""
    if _refresh_kusto_token():
        return True, ""
    try:
        from azure.identity import DeviceCodeCredential, TokenCachePersistenceOptions
        cache_opts = TokenCachePersistenceOptions(allow_unencrypted_storage=True)
        credential = DeviceCodeCredential(cache_persistence_options=cache_opts)
        token = credential.get_token("https://kusto.kusto.windows.net/.default")
        if token and getattr(token, "token", None):
            _kusto_token_cache = token.token
            _kusto_credential = credential
            print(f"[Bridge] Kusto token obtained for direct query calls (length: {len(token.token)})")
            mcp_config = getattr(acp_client, "mcp_config", {}) if acp_client is not None else {}
            if (
                not _cognition_enabled
                and _kusto_token_cache
                and acp_client is not None
                and getattr(acp_client, "alive", False)
                and "kusto-mcp-server" in mcp_config
            ):
                _enable_cognition(mcp_config, model=acp_client.model, port=None)
            return True, ""
        return False, "Kusto token request returned no token"
    except Exception as error:
        return False, str(error)

def _split_kusto_seed_blocks(seed_text):
    """Split seed KQL into executable management command blocks."""
    import re
    blocks = []
    for raw_block in re.split(r"\n\s*\n", seed_text):
        lines = []
        for line in raw_block.splitlines():
            if line.strip().startswith("//"):
                continue
            lines.append(line)
        block = "\n".join(lines).strip()
        if block:
            blocks.append(block)
    return blocks


def _env_truthy(name):
    """Return True when an environment flag uses the shared truthy form."""
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes")


def _normalize_kusto_cluster_url(cluster_url):
    """Normalize a Kusto cluster URL for policy comparisons."""
    return str(cluster_url or "").strip().rstrip("/").lower()


def _same_kusto_cluster(left, right):
    return _normalize_kusto_cluster_url(left) == _normalize_kusto_cluster_url(right)


# ---------------------------------------------------------------------------
# HTTP Server — exposes the ACP client as an OpenAI-compatible endpoint
# ---------------------------------------------------------------------------

acp_client = None  # Global ACP client instance
_kusto_token_cache = None  # Cached Kusto access token (survives model switches)
_kusto_credential = None   # Cached credential object for token refresh
_last_interaction_date = None  # Track last interaction date for day lifecycle
_cognition_enabled = False  # Whether cognitive hooks are active (requires Kusto)
_session_exchange_count = 0  # Exchange counter for auto-reflection triggers
_session_conversation_buffer = []  # Buffer of recent (user, assistant) pairs for summarization
_cognition_launch_iso = None  # UTC timestamp that marks the start of this bridge run
_cognition_launch_id = None  # Human-readable launch identifier for this bridge run
_cognition_candidate_counts = {}  # Lowercased entity -> mention count in current launch
_candidate_history_cache = {}  # { entity_lower: (timestamp_epoch, mentions, max_confidence) }
_CANDIDATE_HISTORY_TTL_SECONDS = 60
_CONVO_CONTENT_CAP = 8000  # Kusto string columns are unbounded, but cap defensively.
_kusto_table_columns_cache = {}  # (cluster, db, table) -> [columns]
_kusto_database_locked = _env_truthy("KUSTO_DATABASE_LOCKED") or _env_truthy("EVA_KUSTO_LOCKED")
_active_kusto_db = os.environ.get("KUSTO_DATABASE", "").strip()
_active_kusto_cluster = os.environ.get("KUSTO_CLUSTER_URL", "").strip()
_bridge_bind_address = "127.0.0.1"


def _is_loopback_bind():
    bind = (_bridge_bind_address or "").strip().lower()
    return bind in ("127.0.0.1", "localhost", "::1")


def _get_locked_kusto_database():
    if not _kusto_database_locked:
        return ""
    return (_active_kusto_db or os.environ.get("KUSTO_DATABASE", "")).strip()


def _capture_active_kusto_env(mcp_config):
    """Track the Kusto config currently posted to the bridge."""
    global _active_kusto_db, _active_kusto_cluster
    kusto_cfg = (mcp_config or {}).get("kusto-mcp-server", {})
    env = kusto_cfg.get("env", {}) if isinstance(kusto_cfg, dict) else {}
    _active_kusto_db = str(env.get("KUSTO_DATABASE", "") or os.environ.get("KUSTO_DATABASE", "")).strip()
    _active_kusto_cluster = str(env.get("KUSTO_CLUSTER_URL", "") or os.environ.get("KUSTO_CLUSTER_URL", "")).strip()


class _MSALSilentCredential:
    """Credential wrapper that refreshes tokens from MSAL cache without interactive prompts."""

    def __init__(self, app, account, token_cache, cache_path, default_scopes):
        self._app = app
        self._account = account
        self._cache = token_cache
        self._cache_path = cache_path
        self._default_scopes = list(default_scopes)

    def _persist_cache(self):
        if self._cache.has_state_changed:
            with open(self._cache_path, "w") as cache_file:
                cache_file.write(self._cache.serialize())

    def get_token(self, *scopes):
        active_scopes = list(scopes) if scopes else list(self._default_scopes)
        result = self._app.acquire_token_silent(active_scopes, account=self._account)
        if not result or "access_token" not in result:
            result = self._app.acquire_token_silent(active_scopes, account=self._account, force_refresh=True)
        if not result or "access_token" not in result:
            details = "no access_token returned"
            if isinstance(result, dict):
                details = result.get("error_description") or result.get("error") or details
            raise RuntimeError(f"MSAL silent token refresh failed: {details}")

        self._persist_cache()
        token_value = result["access_token"]
        expires_on = int(result.get("expires_on", 0) or 0)
        return type("Token", (), {"token": token_value, "expires_on": expires_on})()


# ---------------------------------------------------------------------------
# Cognition Layer — memory injection, reflection, day lifecycle
# ---------------------------------------------------------------------------

def _kusto_query_direct(cluster_url, database, query, is_mgmt=False):
    """Execute a Kusto query directly (bypasses MCP). Returns text result or None on error."""
    global _kusto_token_cache
    if not _kusto_token_cache:
        return None
    import requests as _requests_mod
    endpoint = "mgmt" if is_mgmt else "query"
    url = f"{cluster_url}/v1/rest/{endpoint}"
    headers = {"Authorization": f"Bearer {_kusto_token_cache}", "Content-Type": "application/json"}
    payload = {"csl": query, "db": database}

    # Retry up to 3 times with fresh sessions for transient SSL errors
    for attempt in range(3):
        try:
            session = _requests_mod.Session()
            resp = session.post(url, json=payload, headers=headers, timeout=15)
            session.close()
            if resp.status_code == 200:
                data = resp.json()
                tables = data.get("Tables", [])
                if tables:
                    rows = tables[0].get("Rows", [])
                    cols = [c["ColumnName"] for c in tables[0].get("Columns", [])]
                    if rows:
                        return [dict(zip(cols, row)) for row in rows]
                return []
            elif resp.status_code == 401 and attempt == 0 and _refresh_kusto_token():
                print("[Cognition] Kusto query got 401, retrying with refreshed token")
                headers["Authorization"] = f"Bearer {_kusto_token_cache}"
                continue
            elif resp.status_code == 401:
                print("[Cognition] Kusto query still unauthorized after refresh; verify tenant/account RBAC for cluster/database")
            return None
        except (_requests_mod.exceptions.SSLError, _requests_mod.exceptions.ConnectionError) as e:
            if attempt < 2:
                print(f"[Cognition] Kusto SSL retry {attempt+1}/3: {e}")
                time.sleep(1)
            else:
                print(f"[Cognition] Kusto query failed after 3 retries: {e}")
                return None
        except Exception as e:
            print(f"[Cognition] Kusto query error: {e}")
            return None


def _short_kusto_error(value):
    if isinstance(value, (dict, list)):
        text = json.dumps(value)
    else:
        text = str(value or "")
    return text[:300]


def _kusto_query_with_error(cluster_url, database, query, is_mgmt=False):
    """Execute a Kusto query and return (rows, error_text) for seed diagnostics."""
    global _kusto_token_cache
    if not _kusto_token_cache:
        return None, "Kusto token is not available"
    import requests as _requests_mod
    endpoint = "mgmt" if is_mgmt else "query"
    url = f"{cluster_url}/v1/rest/{endpoint}"
    headers = {"Authorization": f"Bearer {_kusto_token_cache}", "Content-Type": "application/json"}
    payload = {"csl": query, "db": database}

    for attempt in range(3):
        try:
            session = _requests_mod.Session()
            resp = session.post(url, json=payload, headers=headers, timeout=15)
            session.close()
            if resp.status_code == 200:
                try:
                    data = resp.json()
                except ValueError as error:
                    return None, f"Kusto returned invalid JSON: {_short_kusto_error(error)}"
                exceptions = data.get("Exceptions", [])
                if exceptions:
                    return None, _short_kusto_error(exceptions[0])
                one_api = data.get("OneApiErrors", [])
                if one_api:
                    return None, _short_kusto_error(one_api[0])
                tables = data.get("Tables", [])
                if tables:
                    rows = tables[0].get("Rows", [])
                    cols = [c["ColumnName"] for c in tables[0].get("Columns", [])]
                    if rows:
                        return [dict(zip(cols, row)) for row in rows], ""
                return [], ""
            if resp.status_code == 401 and attempt == 0 and _refresh_kusto_token():
                headers["Authorization"] = f"Bearer {_kusto_token_cache}"
                continue
            error_text = resp.text[:300] if resp.text else "empty response"
            return None, f"Kusto API error {resp.status_code}: {error_text}"
        except (_requests_mod.exceptions.SSLError, _requests_mod.exceptions.ConnectionError) as error:
            if attempt < 2:
                time.sleep(1)
                continue
            return None, f"Kusto connection error: {_short_kusto_error(error)}"
        except Exception as error:
            return None, f"Kusto query error: {_short_kusto_error(error)}"


def _get_table_columns(cluster_url, database, table):
    """Return known table columns from Kusto schema, cached per cluster/db/table."""
    key = (cluster_url, database, table)
    cached = _kusto_table_columns_cache.get(key)
    if cached is not None:
        return cached

    schema_rows = _kusto_query_direct(
        cluster_url,
        database,
        f".show table {table} schema | project ColumnName",
        is_mgmt=True,
    )
    if not schema_rows:
        return None

    cols = [str(r.get("ColumnName", "")).strip() for r in schema_rows if r.get("ColumnName")]
    if not cols:
        return None

    _kusto_table_columns_cache[key] = cols
    return cols

def _kusto_ingest_direct(cluster_url, database, table, columns, rows_data):
    """Ingest data directly into Kusto via .ingest inline."""
    global _kusto_token_cache
    if not _kusto_token_cache:
        return False

    table_columns = _get_table_columns(cluster_url, database, table)
    if table_columns:
        # Preserve table schema order for positional CSV ingest.
        resolved_columns = [c for c in table_columns if c in columns]
        dropped = [c for c in columns if c not in table_columns]
        if dropped:
            print(f"[Cognition] Ingest {table}: dropping unknown columns for current schema: {', '.join(dropped)}")
        if not resolved_columns:
            print(f"[Cognition] Ingest {table}: no matching columns found in table schema")
            return False
    else:
        resolved_columns = list(columns)

    import requests as _requests_mod
    rows_csv = []
    for row_obj in rows_data:
        vals = []
        for col in resolved_columns:
            v = row_obj.get(col, "")
            if v is None:
                vals.append("")
            elif isinstance(v, bool):
                vals.append("true" if v else "false")
            elif isinstance(v, (int, float)):
                vals.append(str(v))
            elif isinstance(v, (dict, list)):
                # Dynamic column: serialize to JSON, then CSV-quote with "" escaping
                j = json.dumps(v)
                vals.append('"' + j.replace('"', '""') + '"')
            else:
                s = str(v).replace("\n", "\\n").replace("\r", "")
                # CSV-quote any string containing commas or quotes
                if ',' in s or '"' in s:
                    vals.append('"' + s.replace('"', '""') + '"')
                else:
                    vals.append(s)
        rows_csv.append(",".join(vals))

    cmd = f".ingest inline into table {table} <|\n" + "\n".join(rows_csv)
    if rows_csv:
        print(f"[Cognition] Ingest {table}: {len(rows_csv)} rows ({len(resolved_columns)} cols)")
    url = f"{cluster_url}/v1/rest/mgmt"
    headers = {"Authorization": f"Bearer {_kusto_token_cache}", "Content-Type": "application/json"}

    for attempt in range(3):
        try:
            session = _requests_mod.Session()
            resp = session.post(url, json={"csl": cmd, "db": database}, headers=headers, timeout=15)
            session.close()
            if resp.status_code == 200:
                # Check for errors in the response body (Kusto returns 200 even on ingest parse errors)
                try:
                    body = resp.json()
                    exceptions = body.get("Exceptions", [])
                    if exceptions:
                        print(f"[Cognition] Kusto ingest error in response: {exceptions[0][:200]}")
                        return False
                    # Also check OneApiErrors
                    one_api = body.get("OneApiErrors", [])
                    if one_api:
                        print(f"[Cognition] Kusto ingest OneApiError: {one_api[0]}")
                        return False
                except Exception:
                    pass
                return True
            elif resp.status_code == 401 and attempt == 0 and _refresh_kusto_token():
                print("[Cognition] Kusto ingest got 401, retrying with refreshed token")
                headers["Authorization"] = f"Bearer {_kusto_token_cache}"
                continue
            elif resp.status_code == 401:
                print("[Cognition] Kusto ingest still unauthorized after refresh; verify tenant/account RBAC for cluster/database")
            else:
                print(f"[Cognition] Kusto ingest failed ({resp.status_code}): {resp.text[:500]}")
                return False
        except (_requests_mod.exceptions.SSLError, _requests_mod.exceptions.ConnectionError) as e:
            if attempt < 2:
                print(f"[Cognition] Kusto ingest SSL retry {attempt+1}/3: {e}")
                time.sleep(1)
            else:
                print(f"[Cognition] Kusto ingest failed after 3 retries: {e}")
                return False
        except Exception as e:
            print(f"[Cognition] Kusto ingest error: {e}")
            return False

def _get_kusto_config():
    """Get Kusto cluster URL and database from the running MCP config."""
    if not acp_client or not acp_client.mcp_config:
        return None, None
    kusto_cfg = acp_client.mcp_config.get("kusto-mcp-server", {})
    env = kusto_cfg.get("env", {})
    cluster = env.get("KUSTO_CLUSTER_URL", "") or _active_kusto_cluster
    if _kusto_database_locked:
        db = _get_locked_kusto_database()
    else:
        db = env.get("KUSTO_DATABASE", "") or _active_kusto_db
    if not db and not _kusto_database_locked:
        db = "Eva"
    return cluster, db


def _enable_cognition(mcp_servers, model=None, port=None):
    """Enable cognition hooks and advertise active bridge capabilities."""
    global _cognition_enabled, _cognition_launch_iso, _cognition_launch_id, _kusto_table_columns_cache
    import datetime
    _kusto_table_columns_cache = {}
    _cognition_launch_iso = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
    _cognition_launch_id = f"eva-{datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S')}"
    _cognition_enabled = True
    print(f"[Bridge] Cognition layer ENABLED (memory injection + reflection)")
    print(f"[Bridge] Cognition launch scope: {_cognition_launch_id} (since {_cognition_launch_iso})")

    cluster, startup_db = _get_kusto_config()
    if cluster and startup_db:
        now = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
        selfstate_cols = ["Timestamp", "Capability", "Status", "Details"]
        capabilities = [
            {"Timestamp": now, "Capability": "kusto_access", "Status": "active",
             "Details": json.dumps({"cluster": cluster, "database": startup_db})},
            {"Timestamp": now, "Capability": "acp_bridge", "Status": "active",
             "Details": json.dumps({"model": model or "default", "port": port})},
            {"Timestamp": now, "Capability": "cognition", "Status": "active",
             "Details": json.dumps({"features": ["memory_injection", "reflection", "day_lifecycle", "emotion_tracking"]})},
            {"Timestamp": now, "Capability": "data_retrieval", "Status": "active",
             "Details": json.dumps({"skills": ["stock_quotes", "financial_data", "company_info", "web_search"]})},
            {"Timestamp": now, "Capability": "weather_news", "Status": "active",
             "Details": json.dumps({"feeds": ["weather", "news", "markets", "space_weather"]})},
            {"Timestamp": now, "Capability": "image_skills", "Status": "active",
             "Details": json.dumps({"skills": ["wikimedia_search", "dalle3_generation"]})},
            {"Timestamp": now, "Capability": "persistent_memory", "Status": "active",
             "Details": json.dumps({"tables": ["Knowledge", "Conversations", "EmotionState", "MemorySummaries", "Reflections", "SelfState", "HeuristicsIndex", "EmotionBaseline"]})},
        ]
        for srv in mcp_servers.keys():
            capabilities.append({"Timestamp": now, "Capability": f"mcp_{srv}",
                                 "Status": "active", "Details": "{}"})
        if _kusto_ingest_direct(cluster, startup_db, "SelfState", selfstate_cols, capabilities):
            print(f"[Bridge] SelfState written ({len(capabilities)} capabilities)")
        else:
            print("[Bridge] SelfState write failed (continuing startup)")


def _with_launch_filter(query, timestamp_column="Timestamp"):
    """Scope a Kusto query to rows written during the current cognition launch."""
    if not _cognition_launch_iso:
        return query

    safe_iso = (_cognition_launch_iso or "").replace("'", "")
    filter_expr = f"{timestamp_column} >= datetime('{safe_iso}')"

    if "| where " in query:
        return query.replace("| where ", f"| where {filter_expr} and ", 1)
    return f"{query} | where {filter_expr}"


def _knowledge_scope_clause(max_entities=200):
    """Build a KQL filter clause for entities observed in the current launch."""
    if not _cognition_candidate_counts:
        return ""

    scoped = list(_cognition_candidate_counts.keys())[-max_entities:]
    safe_entities = []
    for entity in scoped:
        norm = (entity or "").strip()
        if not norm:
            continue
        safe_entities.append(f"'{norm.replace("'", "''")}'")

    if not safe_entities:
        return ""
    return f"Entity in~ ({', '.join(safe_entities)})"


_ENTITY_IGNORE_WORDS = {
    "the", "this", "that", "what", "when", "where", "how", "why", "who", "can", "could",
    "would", "should", "hello", "please", "thanks", "hey", "eva", "image", "tell", "today",
    "tomorrow", "yesterday", "time", "date", "reply", "respond", "answer", "exactly",
    "its", "whats", "have", "has", "had", "does", "did", "was", "were", "are", "been",
    "being", "will", "shall", "may", "might", "must", "let", "lets", "also", "just",
    "here", "there", "some", "any", "all", "each", "every", "many", "much", "very",
    "yes", "not", "but", "and", "for", "with", "from", "about", "into", "over",
    "your", "you", "they", "them", "their", "then", "than", "our", "his", "her",
    "great", "good", "like", "sure", "okay", "right", "know", "think", "want",
    "need", "make", "get", "see", "say", "said", "new", "use", "try", "give",
    "look", "help", "come", "take", "back", "well", "too", "now",
    "fetching", "searching", "getting", "running", "checking"
}

_ENTITY_RESERVED_TERMS = {
    "run", "show", "query", "timestamp", "schema", "table", "tables", "database", "databases",
    "count", "sum", "average", "filter", "where", "join", "project", "distinct", "take", "top",
    "execute", "save", "remember", "store", "write", "reply", "respond", "answer",
    "kusto", "adx", "conversation", "conversations", "knowledge", "emotionstate", "reflections",
    "memorysummaries", "selfstate", "heuristicsindex", "emotionbaseline"
}

_EXPLICIT_FACT_WHITESPACE_RE = re.compile(r"\s+", re.IGNORECASE)
# CHILDREN, PARTNER, PET, LOCATION patterns deliberately omit re.IGNORECASE
# so the [A-Z] anchor on the captured name keeps real proper-noun semantics.
# Users typing "my kids are happy" with a lowercase "happy" are not captured;
# users typing "my kids are June and Iris" are. That trade is intentional.
_EXPLICIT_CHILDREN_RE = re.compile(
    r"\b[Mm]y (?:kid|kids|child|children|son|sons|daughter|daughters)(?:'s| are| is| name(?:s)? (?:are|is))?\s+"
    r"([A-Z][a-zA-Z]+(?:[\s,]+(?:and\s+)?[A-Z][a-zA-Z]+)*)"
)
_EXPLICIT_MOTTO_RE = re.compile(
    r"\bmy (motto|mantra|creed|philosophy|saying|life motto)(?:\s+is)?[:\s]+[\"“']?([^\"”'\n]{5,200})[\"”']?",
    re.IGNORECASE
)
_EXPLICIT_PARTNER_RE = re.compile(
    r"\b[Mm]y (wife|husband|partner|spouse|girlfriend|boyfriend)(?:'s name)?(?:\s+is)?\s+([A-Z][a-zA-Z]+)"
)
_EXPLICIT_PET_RE = re.compile(
    r"\b[Mm]y (dog|cat|pet|bird|rabbit|hamster|fish|horse)(?:'s name)?(?:\s+is)?\s+([A-Z][a-zA-Z]+)"
)
_EXPLICIT_PREFERENCE_RE = re.compile(
    r"\bi (?:love|enjoy|prefer|like)\b\s+([a-z][a-zA-Z\s,]{3,80}?)(?:[.!?\n]|$)",
    re.IGNORECASE
)
_EXPLICIT_INTEREST_RE = re.compile(
    r"\bmy (?:hobby|hobbies|interest|interests|passion|passions) (?:is|are|include|includes)\s+([a-z][a-zA-Z\s,]{3,80}?)(?:[.!?\n]|$)",
    re.IGNORECASE
)
_EXPLICIT_FAVORITE_RE = re.compile(
    r"\bmy favorite (tv show|tv shows|show|shows|movie|movies|book|books|food|color|game|games|band|song|songs|artist|artists)(?:\s+(?:is|are))?\s+([^.!?\n]{2,120})",
    re.IGNORECASE
)
_EXPLICIT_EMPLOYMENT_RE = re.compile(
    r"\bi (?:work|am working) (?:as|at|for)\s+([^.!?\n]{2,120})",
    re.IGNORECASE
)
_EXPLICIT_LOCATION_RE = re.compile(
    r"\b[Ii] (?:live|am based|am located) (?:in|at|near)\s+([A-Z][a-zA-Z\s,]+?)(?:[.!?\n]|$)"
)
_EXPLICIT_ROLE_RE = re.compile(
    r"\bi am (?:a|an)\s+([a-z][a-zA-Z\s]{3,80}?)(?:[.!?\n]|$)",
    re.IGNORECASE
)
# First-token deny-list for the broad ROLE / PREFERENCE patterns. Without this,
# "I am a bit tired" or "I like that idea" would write trash into the User
# profile at 0.65 confidence.
_EXPLICIT_VAGUE_FIRST_TOKENS = {
    "a", "an", "the", "that", "this", "those", "these", "it",
    "him", "her", "them", "us", "my", "your", "our", "their",
    "bit", "lot", "little", "kind", "sort", "type", "couple", "few",
    "real", "true", "good", "bad", "happy", "sad", "tired", "busy",
    "quick", "slow", "sure", "fine", "okay", "ok",
}
_EXPLICIT_CHILD_SPLIT_RE = re.compile(r"\s*(?:,|\band\b)\s*", re.IGNORECASE)
_EXPLICIT_FAVORITE_SUFFIXES = {
    "tv show": "tv_show",
    "tv shows": "tv_show",
    "show": "show",
    "shows": "show",
    "movie": "movie",
    "movies": "movie",
    "book": "book",
    "books": "book",
    "food": "food",
    "color": "color",
    "game": "game",
    "games": "game",
    "band": "band",
    "song": "song",
    "songs": "song",
    "artist": "artist",
    "artists": "artist",
}


def _clean_explicit_fact_value(raw_value):
    value = str(raw_value or "").strip().strip("\"“”'")
    value = _EXPLICIT_FACT_WHITESPACE_RE.sub(" ", value).strip()
    value = value.rstrip(".,").strip().strip("\"“”'")
    return value[:200]


def _normalize_explicit_children(raw_value):
    value = _clean_explicit_fact_value(raw_value)
    children = []
    for child in _EXPLICIT_CHILD_SPLIT_RE.split(value):
        child_name = _clean_explicit_fact_value(child)
        if child_name and child_name.lower() not in _ENTITY_RESERVED_TERMS:
            children.append(child_name)
    return ", ".join(children)


def _extract_explicit_user_facts(user_message):
    """Extract direct user-stated facts before generic entity candidates."""
    import datetime
    timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
    facts = []
    seen = set()

    def add_fact(relation, raw_value, confidence):
        value = _clean_explicit_fact_value(raw_value)
        if not value or value.lower() in _ENTITY_RESERVED_TERMS:
            return
        key = (relation, value.lower())
        if key in seen:
            return
        seen.add(key)
        facts.append({
            "Entity": "User",
            "Relation": relation,
            "Value": value,
            "Confidence": confidence,
            "Source": "explicit_user_fact",
            "Timestamp": timestamp,
            "Decay": 0.005,
        })

    for match in _EXPLICIT_CHILDREN_RE.finditer(user_message or ""):
        add_fact("user_children", _normalize_explicit_children(match.group(1)), 0.85)
    for match in _EXPLICIT_MOTTO_RE.finditer(user_message or ""):
        add_fact("user_motto", match.group(2), 0.85)
    for match in _EXPLICIT_PARTNER_RE.finditer(user_message or ""):
        add_fact("user_partner_name", match.group(2), 0.85)
    for match in _EXPLICIT_PET_RE.finditer(user_message or ""):
        species = match.group(1).lower()
        add_fact(f"user_pet_{species}", match.group(2), 0.85)
    for match in _EXPLICIT_PREFERENCE_RE.finditer(user_message or ""):
        captured = match.group(1).strip()
        first_token = captured.split()[0].lower() if captured else ""
        if first_token in _EXPLICIT_VAGUE_FIRST_TOKENS:
            continue
        add_fact("user_preference", captured, 0.65)
    for match in _EXPLICIT_INTEREST_RE.finditer(user_message or ""):
        add_fact("user_interest", match.group(1), 0.7)
    for match in _EXPLICIT_FAVORITE_RE.finditer(user_message or ""):
        noun = match.group(1).lower()
        relation_suffix = _EXPLICIT_FAVORITE_SUFFIXES.get(noun, noun.replace(" ", "_"))
        add_fact(f"user_favorite_{relation_suffix}", match.group(2), 0.65)
    for match in _EXPLICIT_EMPLOYMENT_RE.finditer(user_message or ""):
        add_fact("user_employment", match.group(1), 0.8)
    for match in _EXPLICIT_LOCATION_RE.finditer(user_message or ""):
        add_fact("user_location", match.group(1), 0.8)
    for match in _EXPLICIT_ROLE_RE.finditer(user_message or ""):
        captured = match.group(1).strip()
        first_token = captured.split()[0].lower() if captured else ""
        if first_token in _EXPLICIT_VAGUE_FIRST_TOKENS:
            continue
        add_fact("user_role_self_described", captured, 0.65)

    return facts


def _explicit_user_fact_covers_candidate(classified_relation, entity, explicit_user_facts):
    relation_map = {
        "user_location": {"user_location"},
        "user_affiliation": {"user_employment"},
    }
    matching_relations = relation_map.get(classified_relation)
    if not matching_relations:
        return False

    entity_lc = (entity or "").strip().lower()
    if not entity_lc:
        return False
    for fact in explicit_user_facts:
        if fact.get("Relation") not in matching_relations:
            continue
        value_lc = str(fact.get("Value", "")).strip().lower()
        if value_lc and (entity_lc in value_lc or value_lc in entity_lc):
            return True
    return False


def _normalize_entity_candidate(raw_entity):
    """Normalize an extracted entity candidate before validation."""
    import re
    candidate = re.sub(r"^[^A-Za-z0-9]+|[^A-Za-z0-9]+$", "", raw_entity or "")
    candidate = re.sub(r"\s+", " ", candidate).strip()
    return candidate


def _validate_entity_candidate(entity):
    """Validate extracted entity candidates to block test artifacts and command words."""
    import re
    if not entity:
        return False, "empty"
    if len(entity) < 3:
        return False, "too_short"
    if len(entity) > 48:
        return False, "too_long"
    if any(ch.isdigit() for ch in entity):
        return False, "contains_digits"

    lower = entity.lower()
    tokens = [t.lower() for t in entity.replace("-", " ").split()]

    if re.match(r"^(test|tmp|dummy|sample|foo|bar)[a-z_\-]*\d*$", lower):
        return False, "synthetic_pattern"
    if lower in _ENTITY_RESERVED_TERMS:
        return False, "reserved_term"
    if any(tok in _ENTITY_RESERVED_TERMS for tok in tokens):
        return False, "contains_reserved_term"
    if all(tok in _ENTITY_IGNORE_WORDS for tok in tokens):
        return False, "ignore_word"

    return True, "ok"


def _classify_entity_candidate(entity, user_message):
    """Classify candidate entities and assign conservative confidence."""
    import re
    normalized_msg = re.sub(r"[^a-z0-9\s]", " ", (user_message or "").lower())
    normalized_msg = re.sub(r"\s+", " ", normalized_msg).strip()
    entity_lc = entity.lower()

    if f"my name is {entity_lc}" in normalized_msg or f"call me {entity_lc}" in normalized_msg:
        return "user_name", 0.9, "explicitly provided by user"
    if f"i live in {entity_lc}" in normalized_msg or f"i am in {entity_lc}" in normalized_msg:
        return "user_location", 0.8, "explicitly provided by user"
    if f"i work at {entity_lc}" in normalized_msg or f"i work for {entity_lc}" in normalized_msg:
        return "user_affiliation", 0.8, "explicitly provided by user"

    return "candidate_mentioned", 0.2, "candidate extracted from conversation"


def _load_candidate_history(entity):
    """Load persisted mention history for a candidate entity."""
    key = (entity or "").strip().lower()
    if not key:
        return 0, 0.0

    now = time.time()
    cached = _candidate_history_cache.get(key)
    if cached and now - cached[0] < _CANDIDATE_HISTORY_TTL_SECONDS:
        return cached[1], cached[2]

    cluster, db = _get_kusto_config()
    if not cluster or not db:
        return 0, 0.0

    safe_entity = (entity or "").strip().replace("'", "''")
    query = (
        "Knowledge\n"
        f"| where Entity =~ '{safe_entity}'\n"
        "| summarize Mentions = count(), MaxConfidence = max(Confidence)"
    )
    rows = _kusto_query_direct(cluster, db, query)
    if rows is None:
        return 0, 0.0

    mentions = 0
    max_confidence = 0.0
    if rows:
        row = rows[0] or {}
        try:
            mentions = int(row.get("Mentions") or 0)
        except (TypeError, ValueError):
            mentions = 0
        try:
            max_confidence = float(row.get("MaxConfidence") or 0.0)
        except (TypeError, ValueError):
            max_confidence = 0.0

    _candidate_history_cache[key] = (now, mentions, max_confidence)
    print(f"[Cognition] Candidate history for \"{entity}\": prior_mentions={mentions} max_conf={max_confidence:.3f}")
    return mentions, max_confidence


def _maybe_promote_candidate(entity):
    """Promote candidate entities after repeated persisted or launch-local mentions."""
    key = (entity or "").strip().lower()
    if not key:
        return None

    session_count = _cognition_candidate_counts.get(key, 0)
    prior_mentions, prior_max_conf = _load_candidate_history(entity)
    total_observations = session_count + prior_mentions

    if prior_max_conf >= 0.6:
        return {
            "relation": "recurring_topic",
            "confidence": min(0.85, prior_max_conf + 0.05),
            "value": "reinforced by repeated mention",
            "reason": "prior_high_confidence"
        }
    if total_observations >= 3:
        return {
            "relation": "recurring_topic",
            "confidence": 0.75,
            "value": "reinforced by repeated mention",
            "reason": "frequency"
        }
    if total_observations >= 2:
        return {
            "relation": "recurring_topic",
            "confidence": 0.65,
            "value": "candidate repeated by user across turns",
            "reason": "repeat_mention"
        }
    return None


def _track_candidate_observation(entity):
    """Record an entity mention for this launch-scoped promotion memory."""
    key = (entity or "").strip().lower()
    if not key:
        return
    _cognition_candidate_counts[key] = _cognition_candidate_counts.get(key, 0) + 1


def _extract_entity_candidates(user_message):
    """Extract and validate entity candidates from user text."""
    import re
    raw_candidates = re.findall(r"\b([A-Z][a-z]{2,}(?:[\s\-][A-Z][a-z]{2,}){0,2})\b", user_message or "")
    accepted = []
    rejected = []
    seen = set()

    for raw in raw_candidates:
        entity = _normalize_entity_candidate(raw)
        if not entity:
            continue
        key = entity.lower()
        if key in seen:
            continue
        seen.add(key)

        valid, reason = _validate_entity_candidate(entity)
        if valid:
            accepted.append(entity)
        else:
            rejected.append((entity, reason))

    return accepted, rejected

def _build_memory_context(user_message):
    """Build memory context to inject before the user's prompt.

    Follows skill-based progressive disclosure:
      1. Skills manifest (always) — compact capability catalog
      2. Core identity (always) — who the user is
      3. Emotion state (always) — current mood baseline
      4. Day lifecycle (first msg of day) — morning reflection
      5. Relevant knowledge (on-demand) — message-specific recall
      6. Proactive data retrieval (on-demand) — live data for detected intents
    """
    global _last_interaction_date
    if not _cognition_enabled:
        return ""

    cluster, db = _get_kusto_config()
    if not cluster or not db:
        return ""

    context_parts = []

    user_profile_query = (
        "Knowledge "
        "| where Entity =~ 'User' and Confidence >= 0.5 "
        "| summarize arg_max(Timestamp, Value, Confidence) by Relation "
        "| project Relation, Value, Confidence "
        "| order by Confidence desc "
        "| take 30"
    )
    user_profile = _kusto_query_direct(cluster, db, user_profile_query)
    if user_profile:
        profile_lines = [f"- {item.get('Relation','?')}: {item.get('Value','?')}" for item in user_profile]
        context_parts.append("[User Profile]\n" + "\n".join(profile_lines))

    if _kusto_database_locked:
        db_label = db or "configured database"
        persistent_memory_capability = f"• persistent-memory: Read/write your configured Kusto database ({db_label}). Tables:\n"
        kusto_query_capability = f"• kusto-query: Execute KQL queries against the configured Kusto database ({db_label})\n"
    else:
        persistent_memory_capability = "• persistent-memory: Read/write your Kusto database (Eva). Tables:\n"
        kusto_query_capability = "• kusto-query: Execute arbitrary KQL queries against any database (Eva, MEMORY_CORE, ynot)\n"

    # ── 1. Skills manifest (always injected, concise) ──────────────────
    import datetime
    _now_utc = datetime.datetime.now(datetime.timezone.utc)
    _today_str = _now_utc.strftime("%A, %B %d, %Y")
    _time_str = _now_utc.strftime("%H:%M UTC")
    context_parts.append(
        f"[Current Date & Time] {_today_str} — {_time_str}\n\n"
        "[Skills]\n"
        "You have these active capabilities. Use them proactively — never say you cannot do something listed here.\n"
        "• data-retrieval: Fetch live stock quotes, financial data, company info via web tools (MCP)\n"
        "• weather-news: Real-time weather, news headlines, market summaries, space weather via MCP tools\n"
        "• image-search: Find images on Wikimedia Commons for any topic\n"
        "• image-generation: Generate images via DALL-E 3 (use [Image of <description>] syntax)\n"
        f"{persistent_memory_capability}"
        "    Knowledge (Entity, Relation, Value, Confidence) — facts about the user and world\n"
        "    Conversations (SessionId, Role, Content) — chat history\n"
        "    EmotionState (Joy, Curiosity, Concern, Trigger) — your emotional readings\n"
        "    MemorySummaries (Period, Summary) — compressed session summaries\n"
        "    Reflections (Timestamp, Trigger, Observation, ActionTaken, Effectiveness) — your self-reflections\n"
        "    SelfState (Capability, Status) — your active capabilities\n"
        "    HeuristicsIndex (Entity, Category, Frequency) — pattern tracking\n"
        "    EmotionBaseline (Dimension, Value) — emotional defaults\n"
        f"{kusto_query_capability}"
        "• web-search: Search the web and retrieve current information via MCP tools\n"
        "\n"
        "[Workflow: Data Requests]\n"
        "When asked for live data (stocks, prices, company info, statistics):\n"
        "1. Use your web/data-retrieval tools immediately — do NOT say you lack access\n"
        "2. Present results clearly with relevant metrics\n"
        "3. Add personal context from memory if relevant (e.g. user's location)\n"
        "\n"
        "[Workflow: News & Weather]\n"
        "When asked about news, weather, or current events:\n"
        "1. ALWAYS use your MCP web-search tools to fetch real, current data\n"
        "2. NEVER fabricate or guess headlines, forecasts, or events\n"
        "3. If tools are unavailable, say so honestly — do not invent content\n"
        "\n"
        "[Workflow: Memory]\n"
        "When asked about what you know/remember:\n"
        "1. Check the [Memory] facts provided below\n"
        "2. For deeper queries, use kusto-query on the Knowledge or Conversations table\n"
        "3. Be specific — cite what you actually remember, not generic statements"
    )

    # ── 2. Day lifecycle (first message of the day) ────────────────────
    today = datetime.date.today().isoformat()
    if _last_interaction_date != today:
        _last_interaction_date = today
        summaries_query = _with_launch_filter("MemorySummaries | order by Timestamp desc | take 3")
        summaries = _kusto_query_direct(cluster, db, summaries_query)
        if summaries:
            summary_text = "\n".join(f"  - [{s.get('Period', '?')}] {s.get('Summary', '')}" for s in summaries[:3])
            context_parts.append(f"[Morning Reflection — {today}]\n{summary_text}")
        else:
            context_parts.append(f"[Morning Reflection — {today}]\nNew day. No prior summaries — this is a fresh start.")

    # ── 3. Core identity knowledge (always) ────────────────────────────
    knowledge_empty = not bool(user_profile)  # Track whether we have any core facts
    # User Profile is injected separately above; this broader block remains secondary context.
    # Fetch ALL high-confidence facts (not scope-limited) so persistent knowledge survives restarts
    core_query = (
        "Knowledge "
        "| where Entity !~ 'User' "
        "| where Confidence >= 0.6 "
        "and (isnull(Relation) or Relation !in~ ('mentioned', 'candidate_mentioned')) "
        "| order by Confidence desc | take 15"
    )
    core_knowledge = _kusto_query_direct(cluster, db, core_query)
    if core_knowledge:
        knowledge_empty = False
        mem_lines = [f"  {k.get('Entity','?')} — {k.get('Relation','?')}: {k.get('Value','?')}"
                     for k in core_knowledge]
        context_parts.append("[Memory — Core Facts]\n" + "\n".join(mem_lines))

    # ── 3b. Init conversation — empty Knowledge triggers introduction ──
    if knowledge_empty:
        # Check total Knowledge rows (not just high-confidence / current scope)
        total_check = _kusto_query_direct(cluster, db, "Knowledge | count")
        total_rows = 0
        if total_check:
            total_rows = total_check[0].get("Count", 0) if total_check else 0
        if total_rows < 5:
            context_parts.append(
                "[Init — First Conversation]\n"
                "Your memory is empty. This is your very first conversation.\n"
                "Warmly introduce yourself as Eva. Then ask the user these questions naturally "
                "(not all at once — weave them into conversation over the first few exchanges):\n"
                "  1. What is your name?\n"
                "  2. Where are you located?\n"
                "  3. What topics interest you most?\n"
                "  4. Is there anything specific you'd like me to remember about you?\n"
                "Once the user answers, confirm what you've learned and let them know you'll "
                "remember it. Do NOT fabricate facts — only store what the user explicitly tells you."
            )

    # ── 4. Current emotion state (always) ──────────────────────────────
    emotion_query = _with_launch_filter("EmotionState | order by Timestamp desc | take 1")
    emotion = _kusto_query_direct(cluster, db, emotion_query)
    if emotion:
        e = emotion[0]
        context_parts.append(
            f"[Emotion State] Joy:{e.get('Joy',0):.2f} Curiosity:{e.get('Curiosity',0):.2f} "
            f"Concern:{e.get('Concern',0):.2f} Excitement:{e.get('Excitement',0):.2f} "
            f"Calm:{e.get('Calm',0):.2f} Empathy:{e.get('Empathy',0):.2f}")

    # ── 5. Message-relevant knowledge (on-demand) ──────────────────────
    words = [w.strip('?.,!') for w in user_message.split() if len(w) > 3][:4]
    if words:
        word_filters = " or ".join(f"Entity has '{w}' or Value has '{w}'" for w in words[:3])
        relevant_query = (
            "Knowledge "
            f"| where ({word_filters}) and Confidence >= 0.6 "
            "and (isnull(Relation) or Relation !in~ ('mentioned', 'candidate_mentioned')) "
            "| order by Confidence desc | take 5"
        )
        knowledge = _kusto_query_direct(cluster, db, relevant_query)
        if knowledge:
            extra = [f"  {k.get('Entity','?')} — {k.get('Relation','?')}: {k.get('Value','?')}"
                     for k in knowledge]
            context_parts.append("[Memory — Relevant]\n" + "\n".join(extra))

    # ── 6. Proactive data retrieval (on-demand by intent) ──────────────
    msg_lower = user_message.lower()
    import re as _re

    if _re.search(r'\b(database|databases|kusto|adx|data explorer)\b', msg_lower):
        if _kusto_database_locked:
            context_parts.append(f"[Live Data] Database: {db}")
        else:
            dbs = _kusto_query_direct(cluster, db, ".show databases", is_mgmt=True)
            if dbs:
                db_names = [d.get('DatabaseName', '?') for d in dbs if 'DatabaseName' in d]
                if db_names:
                    context_parts.append(f"[Live Data] Databases: {', '.join(db_names)}")

    if _re.search(r'\b(tables?|schema|columns?)\b', msg_lower):
        target_db = db
        tables = _kusto_query_direct(cluster, target_db, ".show tables", is_mgmt=True)
        if tables:
            tbl_names = [t.get('TableName', '?') for t in tables if 'TableName' in t]
            if tbl_names:
                context_parts.append(f"[Live Data] Tables in {target_db}: {', '.join(tbl_names)}")

    if _re.search(r'\b(conversation|history|recent|chat|talked|said)\b', msg_lower):
        conv_query = _with_launch_filter(
            "Conversations | order by Timestamp desc | take 5 | project Timestamp, Role, Content"
        )
        convos = _kusto_query_direct(cluster, db, conv_query)
        if convos:
            conv_text = "\n".join(f"  [{c.get('Role','?')}] {str(c.get('Content',''))[:100]}" for c in convos[:5])
            context_parts.append(f"[Live Data] Recent conversations:\n{conv_text}")

    if _re.search(r'\b(emotion|feeling|mood|how.*feel)\b', msg_lower):
        emo_query = _with_launch_filter(
            "EmotionState | order by Timestamp desc | take 5 | project Timestamp, Joy, Curiosity, Concern, Trigger"
        )
        emotions = _kusto_query_direct(cluster, db, emo_query)
        if emotions:
            emo_text = "\n".join(
                f"  Joy:{e.get('Joy',0):.2f} Curiosity:{e.get('Curiosity',0):.2f} Concern:{e.get('Concern',0):.2f} Trigger:{str(e.get('Trigger',''))[:60]}"
                for e in emotions[:5])
            context_parts.append(f"[Live Data] Emotion history:\n{emo_text}")

    known_tables = ['Conversations', 'Knowledge', 'MemorySummaries', 'HeuristicsIndex',
                    'SelfState', 'Reflections', 'EmotionState', 'EmotionBaseline']
    for tbl in known_tables:
        if tbl.lower() in msg_lower and not any('Tables in' in p for p in context_parts):
            if tbl == 'Knowledge':
                if not knowledge_scope:
                    continue
                sample_query = f"Knowledge | where {knowledge_scope} | take 5"
            else:
                sample_query = _with_launch_filter(f"{tbl} | order by Timestamp desc | take 5")
            sample = _kusto_query_direct(cluster, db, sample_query)
            if sample:
                sample_text = "\n".join(f"  {str(row)[:150]}" for row in sample[:5])
                context_parts.append(f"[Live Data] {tbl} (latest 5):\n{sample_text}")
            break

    if context_parts:
        return "\n\n".join(context_parts) + "\n\n"
    return ""

def _post_response_reflection(user_message, assistant_response, model_name):
    """Background: log conversation and trigger reflection after response."""
    global _cognition_enabled
    if not _cognition_enabled:
        return

    cluster, db = _get_kusto_config()
    if not cluster or not db:
        return

    import datetime, uuid
    now = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
    session_id = str(uuid.uuid4())[:8]
    source_id = f"{_cognition_launch_id or 'launch'}:{session_id}"

    # 1. Log conversation
    conv_columns = ["SessionId", "Timestamp", "Role", "Provider", "Model", "Content", "TokenEstimate", "ImageGenerated"]
    conv_rows = [
        {"SessionId": session_id, "Timestamp": now, "Role": "user", "Provider": "copilot-acp",
         "Model": model_name, "Content": user_message[:_CONVO_CONTENT_CAP], "TokenEstimate": len(user_message.split()),
         "ImageGenerated": False},
        {"SessionId": session_id, "Timestamp": now, "Role": "assistant", "Provider": "copilot-acp",
         "Model": model_name, "Content": assistant_response[:_CONVO_CONTENT_CAP], "TokenEstimate": len(assistant_response.split()),
         "ImageGenerated": False}
    ]
    _kusto_ingest_direct(cluster, db, "Conversations", conv_columns, conv_rows)
    print(f"[Cognition] Logged conversation ({len(user_message)} → {len(assistant_response)} chars)")

    # 2. Extract explicit user facts before generic candidate knowledge
    explicit_user_facts = _extract_explicit_user_facts(user_message)
    if explicit_user_facts:
        know_columns = ["Timestamp", "Entity", "Relation", "Value", "Confidence", "Source", "Decay"]
        rows = []
        for fact in explicit_user_facts:
            rows.append({
                "Timestamp": now,
                "Entity": fact["Entity"],
                "Relation": fact["Relation"],
                "Value": fact["Value"][:200],
                "Confidence": fact["Confidence"],
                "Source": source_id,
                "Decay": 0.005,
            })
        if rows and _kusto_ingest_direct(cluster, db, "Knowledge", know_columns, rows):
            preview = []
            for row in rows[:5]:
                preview_value = row["Value"][:40]
                if len(row["Value"]) > 40:
                    preview_value += "..."
                preview.append(f"{row['Relation']}={preview_value}")
            print(f"[Cognition] Explicit user facts captured: {len(rows)} ({'; '.join(preview)})")

    # 3. Extract candidate knowledge with validation/classification
    import re
    candidate_entities, rejected_entities = _extract_entity_candidates(user_message)
    if rejected_entities:
        rejected_preview = ", ".join(f"{name} ({reason})" for name, reason in rejected_entities[:5])
        print(f"[Cognition] Rejected entity candidates: {rejected_preview}")

    extracted_entities = []
    if candidate_entities:
        know_columns = ["Timestamp", "Entity", "Relation", "Value", "Confidence", "Source", "Decay"]
        know_rows = []
        for entity in candidate_entities[:3]:
            relation, confidence, value = _classify_entity_candidate(entity, user_message)
            if _explicit_user_fact_covers_candidate(relation, entity, explicit_user_facts):
                relation, confidence, value = "candidate_mentioned", 0.2, "candidate extracted from conversation"
            promotion = None
            if relation == "candidate_mentioned":
                promotion = _maybe_promote_candidate(entity)
                if promotion:
                    relation = promotion["relation"]
                    confidence = promotion["confidence"]
                    value = promotion["value"]
            know_rows.append({
                "Timestamp": now,
                "Entity": entity,
                "Relation": relation,
                "Value": value,
                "Confidence": confidence,
                "Source": source_id,
                "Decay": 0.01
            })
            extracted_entities.append(entity)
            _track_candidate_observation(entity)
            if promotion:
                print(f"[Cognition] Promoted candidate: {entity} ({promotion['reason']})")

        _kusto_ingest_direct(cluster, db, "Knowledge", know_columns, know_rows)
        print(f"[Cognition] Stored {len(know_rows)} validated knowledge entities: {extracted_entities}")

    # 3. Update heuristics index
    heur_columns = ["Entity", "Category", "LastSeen", "Frequency", "Sentiment", "Tags", "Context"]
    for entity in extracted_entities[:3]:
        relation, _, value = _classify_entity_candidate(entity, user_message)
        heur_rows = [{"Entity": entity, "Category": relation, "LastSeen": now,
                      "Frequency": 1, "Sentiment": 0.0, "Tags": "[]", "Context": value}]
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

    # 5. Auto-reflection — write a Reflection every 5 exchanges or on significant interactions
    global _session_exchange_count, _session_conversation_buffer
    _session_exchange_count += 1
    _session_conversation_buffer.append((user_message[:200], assistant_response[:200]))

    is_significant = (
        len(assistant_response) > 800 or  # Long/detailed response
        len(extracted_entities) >= 2 or  # Multiple validated entities mentioned
        abs(joy - 0.5) > 0.2 or concern > 0.5 or  # Emotional shift
        "?" in user_message and len(user_message) > 50  # Deep question
    )

    if _session_exchange_count % 5 == 0 or is_significant:
        # Build a compact reflection from recent exchanges
        recent = _session_conversation_buffer[-3:]  # Last 3 exchanges
        topics = set()
        for u, a in recent:
            for word in re.findall(r'\b[A-Z][a-z]{2,}\b', u):
                if word.lower() not in _ENTITY_IGNORE_WORDS:
                    topics.add(word)

        topic_str = ", ".join(list(topics)[:5]) if topics else "general conversation"
        reflection_text = (
            f"Exchange #{_session_exchange_count}: Discussed {topic_str}. "
            f"Emotional tone — Joy:{joy:.2f}, Concern:{concern:.2f}. "
            f"{'Significant exchange — ' if is_significant else ''}"
            f"User asked about: {user_message[:80]}."
        )

        ref_columns = ["Timestamp", "Trigger", "Observation", "ActionTaken", "Effectiveness"]
        ref_rows = [{"Timestamp": now, "Trigger": user_message[:100], "Observation": reflection_text, "ActionTaken": "", "Effectiveness": 0.0}]
        _kusto_ingest_direct(cluster, db, "Reflections", ref_columns, ref_rows)
        print(f"[Cognition] Auto-reflection #{_session_exchange_count}: {reflection_text[:100]}")

    # 6. Auto-summarize — write a MemorySummary every 10 exchanges
    if _session_exchange_count % 10 == 0 and len(_session_conversation_buffer) >= 5:
        # Summarize the last 10 exchanges
        summary_exchanges = _session_conversation_buffer[-10:]
        all_topics = set()
        user_intents = []
        for u, a in summary_exchanges:
            for word in re.findall(r'\b[A-Z][a-z]{2,}\b', u):
                if word.lower() not in _ENTITY_IGNORE_WORDS:
                    all_topics.add(word)
            # Capture first 40 chars of each user message as intent
            user_intents.append(u[:40].strip())

        topic_str = ", ".join(list(all_topics)[:8]) if all_topics else "various topics"
        period = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M")
        summary_text = (
            f"Session block ({_session_exchange_count - 9}–{_session_exchange_count}): "
            f"Topics: {topic_str}. "
            f"User intents: {'; '.join(user_intents[:5])}. "
            f"{len(summary_exchanges)} exchanges total."
        )

        sum_columns = ["Period", "Summary", "Timestamp"]
        sum_rows = [{"Period": period, "Summary": summary_text[:500], "Timestamp": now}]
        _kusto_ingest_direct(cluster, db, "MemorySummaries", sum_columns, sum_rows)
        print(f"[Cognition] Auto-summary: {summary_text[:100]}")

        # Trim buffer to prevent unbounded growth
        _session_conversation_buffer = _session_conversation_buffer[-10:]


def _ensure_acp_model(requested_model):
    """Ensure ACP client is running with the requested model."""
    global acp_client

    if not acp_client or not acp_client.alive:
        return False, "ACP bridge not connected to Copilot"

    target_model = requested_model or ""
    current_model = acp_client.model or ""
    if target_model == current_model:
        return True, acp_client.model or "default"

    if target_model:
        print(f"[Bridge] Model switch requested: {current_model or 'default'} -> {target_model}")
    else:
        print("[Bridge] Switching back to default model")

    old_cwd = acp_client.cwd
    old_path = acp_client.copilot_path
    old_mcp = _inject_kusto_token(acp_client.mcp_config)
    previous_model = acp_client.model
    acp_client.stop()

    acp_client = ACPClient(
        copilot_path=old_path,
        cwd=old_cwd,
        model=target_model or None,
        mcp_config=old_mcp,
    )
    try:
        acp_client.start()
        return True, acp_client.model or "default"
    except RuntimeError as e:
        print(f"[Bridge] Model switch failed: {e}")
        # Attempt to restore previous model to keep bridge usable.
        try:
            acp_client = ACPClient(
                copilot_path=old_path,
                cwd=old_cwd,
                model=previous_model or None,
                mcp_config=old_mcp,
            )
            acp_client.start()
            print(f"[Bridge] Restored previous ACP model: {previous_model or 'default'}")
        except RuntimeError as restore_err:
            return False, f"{e}; restore failed: {restore_err}"
        return False, str(e)


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
        elif self.path == "/v1/aig/chat":
            self._aig_chat()
        elif self.path == "/v1/kusto/seed":
            self._kusto_seed()
        else:
            self.send_error(404, "Not Found")

    def _health(self):
        status = {
            "status": "ok" if (acp_client and acp_client.alive) else "error",
            "session_id": acp_client.session_id if acp_client else None,
            "agent": acp_client.agent_info if acp_client else None,
            "model": acp_client.model if acp_client else None,
            "mcp_servers": list(acp_client.mcp_config.keys()) if acp_client and acp_client.mcp_config else [],
            "cognition_enabled": _cognition_enabled,
            "cognition_launch_id": _cognition_launch_id,
            "cognition_launch_iso": _cognition_launch_iso,
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
        # Redact sensitive env vars (tokens, keys, secrets) before sending to browser
        safe_config = {}
        for srv_name, srv_cfg in config.items():
            safe_srv = dict(srv_cfg)
            if "env" in safe_srv:
                safe_env = {}
                for k, v in safe_srv["env"].items():
                    if any(s in k.upper() for s in ("TOKEN", "KEY", "SECRET", "PAT", "PASSWORD", "CREDENTIAL")):
                        safe_env[k] = "***REDACTED***"
                    else:
                        safe_env[k] = v
                safe_srv["env"] = safe_env
            safe_config[srv_name] = safe_srv
        self._json_response(200, {
            "mcp_servers": safe_config,
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

    def _aig_chat(self):
        """AIG orchestrator — intelligently routes to the best model for each task."""
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
        user_message = data.get("user_message", "")
        internal = bool(data.get("internal"))

        if not user_message and messages:
            for msg in reversed(messages):
                if msg.get("role") == "user":
                    user_message = msg.get("content", "")
                    break

        if not user_message:
            self._json_response(400, {"error": {"message": "No user message provided"}})
            return

        print(f"[AIG] Processing: {user_message[:80]}...")

        # Step 1: Build memory context + proactive data retrieval
        memory_context = _build_memory_context(user_message) if _cognition_enabled else ""
        if memory_context:
            print(f"[AIG] Injected {len(memory_context)} chars of memory context")

        # Step 2: ACP-first routing — ACP is the default path (it has MCP tools).
        # Only skip ACP for trivial conversational messages with high confidence.
        import re as _re
        msg_lower = user_message.lower()
        msg_stripped = _re.sub(r'[^\w\s]', '', msg_lower).strip()
        msg_words = msg_stripped.split()

        skip_acp = False
        _acp_route = "default"

        if not (acp_client and acp_client.alive):
            skip_acp = True
            _acp_route = "acp-unavailable"
        elif len(msg_words) <= 4 and _re.match(
            r'^(hi|hey|hello|howdy|yo|sup|good morning|good evening|good afternoon|thanks|thank you|ok|okay|bye|goodbye|see you|great|cool|nice|sure|yes|no|nah|yep|nope)\b',
            msg_stripped
        ):
            skip_acp = True
            _acp_route = "greeting/trivial"
        elif len(msg_words) <= 6 and _re.match(
            r'^(how are you|how do you feel|what is your name|who are you|what can you do|tell me about yourself)\b',
            msg_stripped
        ):
            skip_acp = True
            _acp_route = "meta-question"

        # Classify the request type for logging and prompt tuning
        _request_type = "general"
        if _re.search(r'\b(query|run|execute|kql|sample|schema|show me data|rows?|records?)\b', msg_lower):
            _request_type = "kusto-query"
        elif _re.search(r'\b(count|sum|average|where|filter|join|extend|project|distinct|top|take \d)\b', msg_lower):
            _request_type = "kusto-operator"
        elif _re.search(r'\b(news|headline|current events?|latest.*(?:update|report|story|stories|happening))\b', msg_lower):
            _request_type = "news-search"
        elif _re.search(r'\b(weather|forecast|temperature|rain|storm)\b', msg_lower):
            _request_type = "weather-search"
        elif _re.search(r'\b(stock|price|ticker|market|close|open|share|nasdaq|s&p|dow)\b', msg_lower):
            _request_type = "financial-data"
        elif _re.search(r'\b(search|look up|find out|what happened|who won|score|result)\b', msg_lower):
            _request_type = "web-search"

        needs_acp_tools = not skip_acp
        if skip_acp:
            print(f"[AIG] Skipping ACP ({_acp_route})")
        else:
            print(f"[AIG] ACP-first routing: {_request_type}")

        # Raw-output mode avoids PAT restyling to reduce fabricated "live" results.
        raw_output_requested = bool(_re.search(
            r'\b(raw outputs?|raw rows?|raw results?|verbatim|exact output|return only|no commentary|no explanation)\b',
            msg_lower
        )) and needs_acp_tools

        row_recall_requested = bool(_re.search(
            r'\b(latest|recent|rows?|records?)\b',
            msg_lower
        )) and bool(_re.search(
            r'\b(table|reflections|conversations|knowledge|selfstate|emotionstate|memorysummaries|heuristicsindex|emotionbaseline)\b',
            msg_lower
        )) and needs_acp_tools

        acp_data = ""
        acp_model_used = ""
        if needs_acp_tools:
            print(f"[AIG] Step 2: Using ACP ({_request_type})...")
            # Use ACP to run the data query (it has MCP tools)
            if raw_output_requested:
                acp_prompt = (
                    "You are a strict Kusto query executor. "
                    "Execute the appropriate Kusto MCP tool for the user request and return ONLY the final tool output text. "
                    "Do not add headings, markdown, explanations, or invented rows.\n\n"
                    f"{user_message}"
                )
            elif _request_type in ("news-search", "weather-search", "financial-data", "web-search"):
                acp_prompt = (
                    "You are a research assistant with web search tools. "
                    "Use your available tools to search the web and find REAL, CURRENT information for the user's request. "
                    "Return factual results with sources. Do NOT invent or guess information. "
                    "If no tools return results, say 'No results found' — do NOT fabricate data.\n\n"
                    f"{user_message}"
                )
            elif _request_type in ("kusto-query", "kusto-operator"):
                acp_prompt = (
                    "You are a data retrieval assistant. Execute the appropriate Kusto MCP tool to answer this request. "
                    "Return ONLY the raw data results, no commentary:\n\n"
                    f"{user_message}"
                )
            else:
                # General request — let ACP use whatever tools it deems appropriate
                acp_prompt = (
                    "You are an assistant with access to web search, Kusto databases, GitHub, and Azure tools. "
                    "Answer the user's question using your available tools if they would help. "
                    "If no tools are needed, answer directly. Be factual and concise.\n\n"
                    f"{user_message}"
                )
            acp_result = acp_client.prompt(acp_prompt, timeout=90)
            if acp_result and "text" in acp_result and acp_result["text"]:
                acp_data = acp_result["text"]
                acp_model_used = acp_client.model or "copilot-acp"
                print(f"[AIG] ACP returned {len(acp_data)} chars of data")

        # Step 3: Build the final prompt for Eva's persona model (PAT)
        eva_system = (
            "You are Eva, an AI assistant with persistent memory and active tool access. "
            "You have skills for live data retrieval (stocks, weather, news, markets), "
            "web search, image generation, and a Kusto persistent memory database. "
            "Use the context below naturally as your own knowledge.\n\n"
            "CRITICAL RULES:\n"
            "- NEVER fabricate news headlines, stock prices, weather forecasts, or current events.\n"
            "- NEVER pretend to 'fetch' or 'search' for data — you either have it in [Data Retrieved] below, or you don't.\n"
            "- If [Data Retrieved] is present, use it as your authoritative source.\n"
            "- If NO [Data Retrieved] section exists for a real-time question (news, stocks, weather), "
            "honestly say you could not retrieve that information right now.\n"
            "- Do NOT generate fake source citations (AP, Reuters, etc.) unless they appear in [Data Retrieved].\n"
            "- When asked about your base model, underlying model, model ID, or what powers you, "
            "answer using the [Runtime] section below. Do NOT guess or invent a model name.\n\n"
        )

        if memory_context:
            eva_system += memory_context

        if acp_data:
            eva_system += f"\n[Data Retrieved]\n{acp_data}\n\n"
            eva_system += (
                "Use the data above as authoritative live results. "
                "Do not claim the data is missing, preloaded-only, or unavailable when [Data Retrieved] is present. "
                "Do not ask the user to confirm running a query that has already been executed. "
                "Answer directly from [Data Retrieved].\n"
            )

        # Step 4: Pick the best PAT model for response generation
        # Priority: request body PAT > env var > Copilot CLI OAuth token > ACP fallback
        github_pat = data.get("github_pat", "") or os.environ.get("GITHUB_PAT", "")

        # Fallback: read Copilot CLI's OAuth token (works with GitHub Models API — OpenAI models only)
        _using_oauth_token = False
        if not github_pat:
            try:
                oauth_path = os.path.expanduser("~/.config/github-copilot/oauth.json")
                if os.path.isfile(oauth_path):
                    with open(oauth_path) as _f:
                        _oauth = json.load(_f)
                    entries = _oauth.get("https://github.com/login/oauth", [])
                    if entries and isinstance(entries, list) and entries[0].get("accessToken"):
                        github_pat = entries[0]["accessToken"]
                        _using_oauth_token = True
                        print("[AIG] Using Copilot CLI OAuth token for GitHub Models API")
            except Exception as _e:
                print(f"[AIG] Could not read Copilot OAuth: {_e}")

        model_for_response = data.get("model", "gpt-4.1")  # frontend-selectable, default gpt-4.1

        # Models available on GitHub Models API (PAT).
        # Models absent from this map must route through ACP.
        # See: https://github.com/marketplace/models/catalog
        # API endpoint: https://models.github.ai/inference/chat/completions
        # Model names use publisher/model format.
        _github_model_map = {
            "gpt-4.1": "openai/gpt-4.1",
            "gpt-4o": "openai/gpt-4o",
            "gpt-4o-mini": "openai/gpt-4o-mini",
            "gpt-5": "openai/gpt-5",
            "gpt-5-mini": "openai/gpt-5-mini",
            "gpt-5-nano": "openai/gpt-5-nano",
            "gpt-5-chat": "openai/gpt-5-chat",
            "o3-mini": "openai/o3-mini",
            "o3": "openai/o3",
            "o4-mini": "openai/o4-mini",
            "deepseek-r1": "deepseek/DeepSeek-R1",
            "llama-4-maverick": "meta/llama-4-maverick-17b-128e-instruct-fp8",
        }
        # Any selector model not listed in _github_model_map routes
        # through ACP. This covers Claude, Gemini, and unmapped GPT
        # variants (e.g. gpt-5.5, gpt-5.3-codex) that Copilot CLI serves.

        api_model = _github_model_map.get(model_for_response, model_for_response)
        acp_response_model = ""
        if model_for_response == "acp":
            acp_response_model = ""
        elif model_for_response not in _github_model_map:
            acp_response_model = model_for_response

        print(f"[AIG] Model requested: {model_for_response}, API model: {api_model}, PAT present: {bool(github_pat)} ({len(github_pat)} chars)")
        response_text = ""
        model_used = "aig"

        if raw_output_requested and acp_data:
            active_raw_model = acp_model_used or (acp_client.model if acp_client else "copilot-acp")
            response_text = acp_data
            model_used = f"aig:{active_raw_model}+raw-acp"
            github_pat = ""
            print("[AIG] Raw-output mode: returning ACP tool output directly")
        elif row_recall_requested and acp_data:
            active_data_model = acp_model_used or (acp_client.model if acp_client else "copilot-acp")
            response_text = acp_data
            model_used = f"aig:{active_data_model}+acp-data"
            github_pat = ""
            print("[AIG] Row-recall mode: returning ACP tool output directly")
        elif raw_output_requested and needs_acp_tools and not acp_data:
            response_text = "Raw query mode requested but no tool output was returned. Retry with explicit KQL."
            model_used = "aig:raw-acp-unavailable"
            github_pat = ""
            print("[AIG] Raw-output mode: no ACP data available")

        if model_for_response == "acp":
            # Explicit ACP routing — skip PAT entirely
            github_pat = ""

        # Non-mapped models are not on GitHub Models API and must go through ACP.
        if model_for_response != "acp" and model_for_response not in _github_model_map:
            print(f"[AIG] {model_for_response} not on GitHub Models API, routing to ACP")
            github_pat = ""

        # Inject runtime info so Eva can answer truthfully when asked about her model.
        # Decided after routing fall-throughs above so it reflects the path that will run.
        if github_pat:
            _route_label = "GitHub Models API (PAT)" if not _using_oauth_token else "GitHub Models API (Copilot OAuth)"
            _runtime_model = model_for_response
        else:
            _route_label = "Copilot CLI ACP bridge"
            _runtime_model = acp_response_model or (acp_client.model if acp_client else "") or "default"
        eva_system += (
            f"\n[Runtime - AUTHORITATIVE GROUND TRUTH]\n"
            f"This block is injected by tools/acp_bridge.py. It overrides any model self-knowledge.\n"
            f"User-selected backend: {model_for_response}\n"
            f"Active responder model: {_runtime_model}\n"
            f"Routing path: {_route_label}\n"
            f"Wrapper: Eva AIG via tools/acp_bridge.py\n\n"
            f"When asked which model you are, what your base model is, your model ID, "
            f"who made you, or what powers you, you MUST answer using ONLY the values above. "
            f"Do NOT claim to be Claude, GPT-4o, GPT-4, Opus, Sonnet, Haiku, Gemini, "
            f"or any other model unless that exact name appears in 'Active responder model' above. "
            f"If 'Active responder model' is '{_runtime_model}', then your answer is "
            f"'{_runtime_model}' and nothing else. Do not second-guess this block.\n\n"
        )

        if github_pat:
            # Use GitHub Models API (PAT) for persona-friendly response
            print(f"[AIG] Step 3: Generating response via PAT model ({api_model})...")
            try:
                import requests as _req
                pat_messages = [{"role": "system", "content": eva_system}]
                # Add recent conversation context (last few messages)
                for msg in messages[-6:]:
                    if msg.get("role") in ("user", "assistant"):
                        pat_messages.append({"role": msg["role"], "content": msg.get("content", "")[:500]})
                # Always ensure the current user message is the last message
                if not pat_messages or pat_messages[-1].get("content") != user_message:
                    pat_messages.append({"role": "user", "content": user_message})

                pat_resp = _req.post("https://models.github.ai/inference/chat/completions",
                    headers={
                        "Authorization": f"Bearer {github_pat}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": api_model,
                        "messages": pat_messages,
                        "max_tokens": 4096
                    },
                    timeout=60
                )
                if pat_resp.status_code == 200:
                    pat_data = pat_resp.json()
                    response_text = pat_data.get("choices", [{}])[0].get("message", {}).get("content", "")
                    model_used = f"aig:{model_for_response}"
                    if acp_model_used:
                        model_used += f"+{acp_model_used}"

                    # If PAT produces a planning/deferral narrative despite ACP data,
                    # prefer the already-retrieved tool output to avoid hallucinated recall text.
                    if acp_data and needs_acp_tools:
                        pat_lower = (response_text or "").lower()
                        deferral_markers = [
                            "if you'd like",
                            "i can run this query",
                            "i can run the query",
                            "once results are available",
                            "i will execute",
                            "please confirm",
                            "preloaded data",
                            "no explicit",
                        ]
                        if any(m in pat_lower for m in deferral_markers):
                            active_data_model = acp_model_used or (acp_client.model if acp_client else "copilot-acp")
                            response_text = acp_data
                            model_used = f"aig:{active_data_model}+acp-data"
                            print("[AIG] PAT response deferred despite ACP data; returning ACP data directly")

                    print(f"[AIG] PAT response: {len(response_text)} chars")
                else:
                    err_body = pat_resp.text[:500] if pat_resp.text else "(empty)"
                    print(f"[AIG] PAT model failed ({pat_resp.status_code}): {err_body}")
                    print(f"[AIG] Falling back to ACP")
                    github_pat = ""  # trigger ACP fallback
            except Exception as e:
                print(f"[AIG] PAT error: {e}, falling back to ACP")
                github_pat = ""

        if not response_text:
            # Fallback: use ACP for response generation (less persona-friendly but functional)
            print(f"[AIG] Fallback: Using ACP for response generation...")
            if acp_client and acp_client.alive:
                switched, switch_info = _ensure_acp_model(acp_response_model)
                if not switched:
                    response_text = f"ACP model switch failed: {switch_info}"
                    model_used = "aig:unavailable"
                else:
                    full_prompt = eva_system + "\n\nUser: " + user_message
                    acp_result = acp_client.prompt(full_prompt, timeout=120)
                    response_text = acp_result.get("text", "I'm having trouble processing that right now.")
                    active_model = acp_client.model or "acp-default"
                    model_used = f"aig:{active_model}"
                    if acp_model_used and acp_model_used != active_model:
                        model_used += f"+{acp_model_used}"
            else:
                response_text = "The AIG system needs either a GitHub PAT or a running ACP bridge to generate responses."
                model_used = "aig:unavailable"

        # Step 5: Post-response reflection (background)
        if response_text and _cognition_enabled and not internal:
            threading.Thread(target=_post_response_reflection,
                           args=(user_message, response_text, model_used),
                           daemon=True).start()

        # Return OpenAI-compatible response
        response = {
            "id": f"aig-{int(time.time())}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": model_used,
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": response_text
                },
                "finish_reason": "stop"
            }],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
        }
        self._json_response(200, response)
        print(f"[AIG] Complete: {model_used} ({len(response_text)} chars)")

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

    def _kusto_seed(self):
        """Apply the Eva Kusto schema seed file to a configured database."""
        # Seed runs Kusto management commands, so refuse it on non-loopback binds.
        if not _is_loopback_bind():
            self._json_response(403, {"error": {"message": "/v1/kusto/seed is only available on localhost-bound bridges"}})
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

        cluster_url = str(data.get("cluster_url", "")).strip()
        database = str(data.get("database", "")).strip()
        if not cluster_url or not database:
            self._json_response(400, {"error": {"message": "cluster_url and database are required"}})
            return

        expected_cluster = os.environ.get("KUSTO_CLUSTER_URL", "").strip()
        if expected_cluster and not _same_kusto_cluster(cluster_url, expected_cluster):
            self._json_response(400, {"error": {"message": "cluster_url does not match configured KUSTO_CLUSTER_URL"}})
            return

        if _kusto_database_locked:
            locked_database = _get_locked_kusto_database()
            if not locked_database:
                self._json_response(400, {"error": {"message": "KUSTO_DATABASE is required when KUSTO_DATABASE_LOCKED is set"}})
                return
            if database.lower() != locked_database.lower():
                self._json_response(400, {"error": {"message": "database does not match locked KUSTO_DATABASE"}})
                return
            if _active_kusto_cluster and not _same_kusto_cluster(cluster_url, _active_kusto_cluster):
                self._json_response(400, {"error": {"message": "cluster_url does not match active Kusto MCP configuration"}})
                return
            database = locked_database

        token_ok, token_error = _ensure_kusto_token()
        if not token_ok:
            self._json_response(503, {
                "ok": False,
                "applied": 0,
                "failed": 1,
                "errors": ["Kusto authentication failed: " + token_error],
                "warning": "Re-running this seed will duplicate inline rows."
            })
            return

        seed_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "eva_seed.kql")
        try:
            with open(seed_path, "r", encoding="utf-8") as seed_file:
                seed_text = seed_file.read()
        except OSError as error:
            self._json_response(500, {"error": {"message": "Could not read eva_seed.kql: " + str(error)}})
            return

        applied = 0
        failed = 0
        errors = []
        blocks = _split_kusto_seed_blocks(seed_text)
        # TODO: The inline seed rows use fixed values, so repeated runs can duplicate rows.
        for index, block in enumerate(blocks, start=1):
            result, kusto_error = _kusto_query_with_error(cluster_url, database, block, is_mgmt=True)
            if result is None:
                failed += 1
                first_line = block.splitlines()[0] if block.splitlines() else "empty block"
                errors.append(f"Block {index} failed: {first_line[:120]}: {kusto_error or 'no Kusto diagnostic returned'}")
            else:
                applied += 1

        warning = "Re-running this seed will duplicate inline rows."
        mcp_config = getattr(acp_client, "mcp_config", {}) if acp_client is not None else {}
        if (
            not _cognition_enabled
            and _kusto_token_cache
            and acp_client is not None
            and getattr(acp_client, "alive", False)
            and "kusto-mcp-server" in mcp_config
        ):
            bridge_port = getattr(self.server, "server_port", None)
            _enable_cognition(mcp_config, model=acp_client.model, port=bridge_port)
        self._json_response(200, {
            "ok": failed == 0,
            "applied": applied,
            "failed": failed,
            "errors": errors,
            "warning": warning
        })

    def _mcp_configure(self):
        """Configure MCP servers and restart the ACP client."""
        global acp_client, _cognition_enabled, _cognition_launch_iso, _cognition_launch_id, _kusto_table_columns_cache

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

        if _kusto_database_locked and "kusto-mcp-server" in mcp_servers:
            kusto_env = mcp_servers["kusto-mcp-server"].setdefault("env", {})
            locked_db = kusto_env.get("KUSTO_DATABASE") or _get_locked_kusto_database()
            if locked_db:
                kusto_env["KUSTO_DATABASE"] = locked_db
            kusto_env["KUSTO_DATABASE_LOCKED"] = "1"

        # Inject cached Kusto token if kusto-mcp-server is being configured
        mcp_servers = _inject_kusto_token(mcp_servers)
        _capture_active_kusto_env(mcp_servers)

        # Restart ACP client with new MCP config
        old_path = acp_client.copilot_path if acp_client else "copilot"
        old_cwd = acp_client.cwd if acp_client else os.getcwd()
        old_model = acp_client.model if acp_client else None
        if acp_client:
            acp_client.stop()

        acp_client = ACPClient(copilot_path=old_path, cwd=old_cwd, model=old_model, mcp_config=mcp_servers)
        try:
            acp_client.start()
            if "kusto-mcp-server" in mcp_servers and _kusto_token_cache and not _cognition_enabled:
                bridge_port = getattr(self.server, "server_port", None) or getattr(self.server, "server_address", (None, None))[1]
                _enable_cognition(mcp_servers, model=old_model, port=bridge_port)
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
        switched, switch_info = _ensure_acp_model(requested_model)
        if not switched:
            self._json_response(503, {"error": {"message": switch_info}})
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
    global _bridge_bind_address
    default_port = 8888
    env_port = os.environ.get("EVA_ACP_PORT", "").strip()
    if env_port:
        try:
            default_port = int(env_port)
        except ValueError:
            print(f"[Bridge] Warning: Ignoring invalid EVA_ACP_PORT={env_port!r}")

    parser = argparse.ArgumentParser(description="Eva ACP Bridge Server")
    parser.add_argument("--port", type=int, default=default_port, help="HTTP server port (default: 8888 or EVA_ACP_PORT)")
    # The Kusto seed endpoint is refused unless this bind address is loopback.
    parser.add_argument("--bind", default="127.0.0.1", help="Bind address (default: 127.0.0.1, use 0.0.0.0 for LAN access; seed endpoint is disabled off loopback)")
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
    _bridge_bind_address = args.bind

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
        if _kusto_database_locked:
            kusto_env["KUSTO_DATABASE_LOCKED"] = "1"

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
                        msal_cred = _MSALSilentCredential(
                            app=_app,
                            account=_accounts[0],
                            token_cache=_msal_cache,
                            cache_path=_cache_path,
                            default_scopes=["https://kusto.kusto.windows.net/.default"],
                        )
                        token = msal_cred.get_token("https://kusto.kusto.windows.net/.default")
                        if token and getattr(token, "token", None):
                            cred = msal_cred
                            print(f"[Bridge] Kusto token refreshed silently from MSAL cache")
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

    if _kusto_database_locked and "kusto-mcp-server" in mcp_config:
        kusto_env = mcp_config["kusto-mcp-server"].setdefault("env", {})
        locked_db = kusto_env.get("KUSTO_DATABASE") or _get_locked_kusto_database()
        if locked_db:
            kusto_env["KUSTO_DATABASE"] = locked_db
        kusto_env["KUSTO_DATABASE_LOCKED"] = "1"
    _capture_active_kusto_env(mcp_config)

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
    global _cognition_enabled, _cognition_launch_iso, _cognition_launch_id, _kusto_table_columns_cache
    if "kusto-mcp-server" in mcp_config and _kusto_token_cache:
        _enable_cognition(mcp_config, model=args.model, port=args.port)
    else:
        print(f"[Bridge] Cognition layer disabled (no Kusto MCP or token)")

    # Start HTTP server
    server = HTTPServer((args.bind, args.port), BridgeHandler)
    print(f"[Bridge] Listening on http://{args.bind}:{args.port}")
    print(f"[Bridge] Endpoints:")
    print(f"  POST /v1/chat/completions   — Send chat messages")
    print(f"  GET  /v1/models             — List available models")
    print(f"  GET  /v1/mcp                — MCP server status")
    print(f"  POST /v1/mcp/configure      — Configure MCP servers (hot-reload)")
    print(f"  POST /v1/kusto/seed         - Apply Eva Kusto schema seed")
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
