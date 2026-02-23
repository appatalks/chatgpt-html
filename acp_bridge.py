#!/usr/bin/env python3
"""
ACP Bridge Server for Eva
Bridges GitHub Copilot CLI's ACP (Agent Client Protocol) to HTTP
so the browser-based Eva UI can use Copilot models.

Requirements:
  - GitHub Copilot CLI installed and authenticated (`copilot auth login`)
  - Python 3.7+

Usage:
  python3 acp_bridge.py                    # default port 8888
  python3 acp_bridge.py --port 9999        # custom port
  python3 acp_bridge.py --copilot-path /usr/local/bin/copilot

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

    def __init__(self, copilot_path="copilot", cwd=None):
        self.copilot_path = copilot_path
        self.cwd = cwd or os.getcwd()
        self.process = None
        self.request_id = 0
        self.lock = threading.Lock()
        self.pending = {}           # id -> {"event": Event, "result": None, "error": None}
        self.session_id = None
        self.response_chunks = {}   # prompt_id -> accumulated text
        self.reader_thread = None
        self.agent_info = {}
        self.alive = False

    # --- Lifecycle ---

    def start(self):
        """Spawn copilot subprocess, initialize ACP, create session."""
        try:
            self.process = subprocess.Popen(
                [self.copilot_path, "--acp", "--stdio"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=0
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
            "clientCapabilities": {},
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

        # Create session
        session_result = self._send_request("session/new", {
            "cwd": self.cwd,
            "mcpServers": []
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

        # Server-initiated requests for fs/terminal (decline since we're a chat bridge)
        if "id" in msg and msg.get("method", "").startswith(("fs/", "terminal/")):
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
# HTTP Server — exposes the ACP client as an OpenAI-compatible endpoint
# ---------------------------------------------------------------------------

acp_client = None  # Global ACP client instance


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
        else:
            self.send_error(404, "Not Found")

    def do_POST(self):
        if self.path == "/v1/chat/completions":
            self._chat_completions()
        else:
            self.send_error(404, "Not Found")

    def _health(self):
        status = {
            "status": "ok" if (acp_client and acp_client.alive) else "error",
            "session_id": acp_client.session_id if acp_client else None,
            "agent": acp_client.agent_info if acp_client else None
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
            "model": "copilot-acp",
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

    def _json_response(self, status, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self._cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        # Quieter logging
        sys.stderr.write(f"[Bridge] {args[0]} {args[1]} {args[2]}\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Eva ACP Bridge Server")
    parser.add_argument("--port", type=int, default=8888, help="HTTP server port (default: 8888)")
    parser.add_argument("--copilot-path", default="copilot", help="Path to copilot CLI binary")
    parser.add_argument("--cwd", default=os.getcwd(), help="Working directory for ACP session")
    args = parser.parse_args()

    global acp_client
    print(f"[Bridge] Starting ACP bridge on port {args.port}...")
    print(f"[Bridge] Copilot CLI: {args.copilot_path}")
    print(f"[Bridge] Working directory: {args.cwd}")

    # Start ACP client
    acp_client = ACPClient(copilot_path=args.copilot_path, cwd=args.cwd)
    try:
        acp_client.start()
    except RuntimeError as e:
        print(f"[Bridge] ERROR: {e}")
        sys.exit(1)

    # Start HTTP server
    server = HTTPServer(("0.0.0.0", args.port), BridgeHandler)
    print(f"[Bridge] Listening on http://0.0.0.0:{args.port}")
    print(f"[Bridge] Endpoints:")
    print(f"  POST /v1/chat/completions  — Send chat messages")
    print(f"  GET  /v1/models            — List available models")
    print(f"  GET  /health               — Health check")
    print()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[Bridge] Shutting down...")
        acp_client.stop()
        server.server_close()


if __name__ == "__main__":
    main()
