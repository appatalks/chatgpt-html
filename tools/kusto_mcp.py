#!/usr/bin/env python3
"""
Kusto MCP Server for Eva
A lightweight MCP (Model Context Protocol) server for Azure Data Explorer (Kusto).
Uses Azure Identity DeviceCodeCredential for authentication — works with personal
Microsoft accounts that have no Azure subscription.

Usage:
  As a standalone MCP server (stdio):
    python3 kusto_mcp.py

  Via the ACP bridge (--additional-mcp-config):
    Configured automatically when you enable "Kusto MCP" in Eva's settings.

Environment variables:
  KUSTO_CLUSTER_URL   — Full cluster URL (e.g. https://kvc-xxx.southcentralus.kusto.windows.net)
  KUSTO_DATABASE      — Default database name (optional)
"""

import json
import os
import sys
import threading

# --- Azure Identity + Kusto SDK ---
try:
    from azure.identity import DeviceCodeCredential, SharedTokenCacheCredential
    import requests as _requests
    HAS_AZURE = True
except ImportError:
    HAS_AZURE = False

# --- MCP Protocol (NDJSON over stdio) ---

class KustoMCPServer:
    """Minimal MCP server implementing tools for Azure Data Explorer."""

    TOOLS = [
        {
            "name": "kusto_list_databases",
            "description": "List all databases in the connected Azure Data Explorer cluster.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "cluster_url": {
                        "type": "string",
                        "description": "Full Kusto cluster URL (e.g. https://kvc-xxx.region.kusto.windows.net). Uses KUSTO_CLUSTER_URL env if not provided."
                    }
                }
            }
        },
        {
            "name": "kusto_query",
            "description": "Execute a KQL (Kusto Query Language) query against an Azure Data Explorer database.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The KQL query to execute (e.g. 'StormEvents | take 10')"
                    },
                    "database": {
                        "type": "string",
                        "description": "Database name to query. Uses KUSTO_DATABASE env if not provided."
                    },
                    "cluster_url": {
                        "type": "string",
                        "description": "Full Kusto cluster URL. Uses KUSTO_CLUSTER_URL env if not provided."
                    }
                },
                "required": ["query"]
            }
        },
        {
            "name": "kusto_show_tables",
            "description": "Show all tables in a Kusto database.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "database": {
                        "type": "string",
                        "description": "Database name. Uses KUSTO_DATABASE env if not provided."
                    },
                    "cluster_url": {
                        "type": "string",
                        "description": "Full Kusto cluster URL. Uses KUSTO_CLUSTER_URL env if not provided."
                    }
                }
            }
        },
        {
            "name": "kusto_show_schema",
            "description": "Show the schema (columns and types) for a specific table in a Kusto database.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "table": {
                        "type": "string",
                        "description": "Table name to get schema for"
                    },
                    "database": {
                        "type": "string",
                        "description": "Database name. Uses KUSTO_DATABASE env if not provided."
                    },
                    "cluster_url": {
                        "type": "string",
                        "description": "Full Kusto cluster URL. Uses KUSTO_CLUSTER_URL env if not provided."
                    }
                },
                "required": ["table"]
            }
        },
        {
            "name": "kusto_sample_data",
            "description": "Get a sample of rows from a Kusto table (default 10 rows).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "table": {
                        "type": "string",
                        "description": "Table name to sample from"
                    },
                    "count": {
                        "type": "integer",
                        "description": "Number of rows to sample (default 10)"
                    },
                    "database": {
                        "type": "string",
                        "description": "Database name. Uses KUSTO_DATABASE env if not provided."
                    },
                    "cluster_url": {
                        "type": "string",
                        "description": "Full Kusto cluster URL. Uses KUSTO_CLUSTER_URL env if not provided."
                    }
                },
                "required": ["table"]
            }
        }
    ]

    def __init__(self):
        self.cluster_url = os.environ.get("KUSTO_CLUSTER_URL", "")
        self.default_database = os.environ.get("KUSTO_DATABASE", "")
        self._credential = None
        self._token = None
        self._lock = threading.Lock()

    def _get_credential(self):
        """Get or create Azure credential."""
        if self._credential:
            return self._credential
        with self._lock:
            if self._credential:
                return self._credential

            # Check for pre-fetched token from bridge (KUSTO_ACCESS_TOKEN env)
            pre_token = os.environ.get("KUSTO_ACCESS_TOKEN", "")
            if pre_token:
                self._log("Using pre-fetched access token from environment")
                # Create a simple credential wrapper
                class _StaticTokenCredential:
                    def __init__(self, token):
                        self._token = token
                    def get_token(self, *args, **kwargs):
                        import collections
                        Token = collections.namedtuple("Token", ["token", "expires_on"])
                        return Token(self._token, 0)
                self._credential = _StaticTokenCredential(pre_token)
                return self._credential

            # Try persistent token cache
            try:
                from azure.identity import TokenCachePersistenceOptions
                cred = DeviceCodeCredential(
                    cache_persistence_options=TokenCachePersistenceOptions(allow_unencrypted_storage=True)
                )
                token = cred.get_token("https://kusto.kusto.windows.net/.default")
                if token:
                    self._credential = cred
                    self._log("Using persistent token cache")
                    return self._credential
            except Exception as e:
                self._log(f"Persistent cache attempt: {e}")

            # Fall back to device code with explicit prompt
            self._log("Starting device code authentication for Kusto...")

            def device_code_callback(*args, **kwargs):
                details = args[0] if args and isinstance(args[0], dict) else (args[1] if len(args) > 1 and isinstance(args[1], dict) else kwargs)
                msg = details.get('message', str(args)) if isinstance(details, dict) else str(details)
                self._log(f"AUTH REQUIRED: {msg}")
                sys.stderr.write(f"\n{'='*60}\n")
                sys.stderr.write(f"KUSTO AUTH: {msg}\n")
                sys.stderr.write(f"{'='*60}\n\n")
                sys.stderr.flush()

            try:
                from azure.identity import TokenCachePersistenceOptions
                self._credential = DeviceCodeCredential(
                    prompt_callback=device_code_callback,
                    cache_persistence_options=TokenCachePersistenceOptions(allow_unencrypted_storage=True)
                )
            except (TypeError, ImportError):
                self._credential = DeviceCodeCredential(prompt_callback=device_code_callback)

            return self._credential

    def _get_token(self):
        """Get a valid access token for Kusto."""
        cred = self._get_credential()
        token = cred.get_token("https://kusto.kusto.windows.net/.default")
        return token.token

    def _resolve_cluster(self, args):
        """Resolve cluster URL from args or environment."""
        url = args.get("cluster_url", "") or self.cluster_url
        if not url:
            return None, "No cluster URL provided. Set KUSTO_CLUSTER_URL or pass cluster_url parameter."
        # Ensure https://
        if not url.startswith("https://"):
            url = "https://" + url
        # Ensure .kusto.windows.net suffix
        if ".kusto.windows.net" not in url and ".kusto.data.microsoft.com" not in url:
            url = url.rstrip("/") + ".kusto.windows.net"
        return url.rstrip("/"), None

    def _resolve_database(self, args):
        """Resolve database name from args or environment."""
        return args.get("database", "") or self.default_database

    def _kusto_query(self, cluster_url, database, query, is_mgmt=False):
        """Execute a Kusto query and return formatted results."""
        token = self._get_token()
        endpoint = "mgmt" if is_mgmt else "query"
        url = f"{cluster_url}/v1/rest/{endpoint}"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        body = {"csl": query}
        if database:
            body["db"] = database

        resp = _requests.post(url, json=body, headers=headers, timeout=60)

        if resp.status_code != 200:
            return f"Kusto API error {resp.status_code}: {resp.text[:500]}"

        data = resp.json()
        return self._format_kusto_response(data)

    def _format_kusto_response(self, data):
        """Format Kusto JSON response into readable text."""
        tables = data.get("Tables", [])
        if not tables:
            return "No results returned."

        result_parts = []
        for table in tables:
            columns = [c["ColumnName"] for c in table.get("Columns", [])]
            rows = table.get("Rows", [])

            if not rows:
                result_parts.append(f"Table '{table.get('TableName', '?')}': empty")
                continue

            # Format as a readable table
            lines = []
            lines.append(" | ".join(columns))
            lines.append("-" * len(lines[0]))
            for row in rows[:100]:  # Cap at 100 rows
                lines.append(" | ".join(str(v) for v in row))

            if len(rows) > 100:
                lines.append(f"... ({len(rows)} total rows, showing first 100)")

            result_parts.append("\n".join(lines))

        return "\n\n".join(result_parts)

    # --- Tool handlers ---

    def handle_tool(self, name, args):
        """Route tool call to the appropriate handler."""
        if not HAS_AZURE:
            return "Error: azure-identity package not installed. Run: pip install azure-identity requests"

        try:
            if name == "kusto_list_databases":
                return self._tool_list_databases(args)
            elif name == "kusto_query":
                return self._tool_query(args)
            elif name == "kusto_show_tables":
                return self._tool_show_tables(args)
            elif name == "kusto_show_schema":
                return self._tool_show_schema(args)
            elif name == "kusto_sample_data":
                return self._tool_sample_data(args)
            else:
                return f"Unknown tool: {name}"
        except Exception as e:
            return f"Error: {str(e)}"

    def _tool_list_databases(self, args):
        cluster_url, err = self._resolve_cluster(args)
        if err:
            return err
        return self._kusto_query(cluster_url, "", ".show databases")

    def _tool_query(self, args):
        cluster_url, err = self._resolve_cluster(args)
        if err:
            return err
        query = args.get("query", "")
        if not query:
            return "Error: 'query' parameter is required."
        database = self._resolve_database(args)
        if not database:
            return "Error: database name required. Set KUSTO_DATABASE or pass 'database' parameter."

        # Detect management commands (.show, .create, etc.)
        is_mgmt = query.strip().startswith(".")
        return self._kusto_query(cluster_url, database, query, is_mgmt=is_mgmt)

    def _tool_show_tables(self, args):
        cluster_url, err = self._resolve_cluster(args)
        if err:
            return err
        database = self._resolve_database(args)
        if not database:
            return "Error: database name required."
        return self._kusto_query(cluster_url, database, ".show tables", is_mgmt=True)

    def _tool_show_schema(self, args):
        cluster_url, err = self._resolve_cluster(args)
        if err:
            return err
        table = args.get("table", "")
        if not table:
            return "Error: 'table' parameter is required."
        database = self._resolve_database(args)
        if not database:
            return "Error: database name required."
        return self._kusto_query(cluster_url, database, f".show table {table} schema as json", is_mgmt=True)

    def _tool_sample_data(self, args):
        cluster_url, err = self._resolve_cluster(args)
        if err:
            return err
        table = args.get("table", "")
        if not table:
            return "Error: 'table' parameter is required."
        count = args.get("count", 10)
        database = self._resolve_database(args)
        if not database:
            return "Error: database name required."
        return self._kusto_query(cluster_url, database, f"{table} | take {count}")

    # --- MCP Protocol (JSON-RPC over NDJSON/stdio) ---

    def _log(self, msg):
        sys.stderr.write(f"[KustoMCP] {msg}\n")
        sys.stderr.flush()

    def run(self):
        """Run the MCP server on stdio (NDJSON)."""
        self._log("Kusto MCP Server starting...")
        self._log(f"Cluster: {self.cluster_url or '(not set — will use tool parameter)'}")
        self._log(f"Database: {self.default_database or '(not set — will use tool parameter)'}")

        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
                response = self._handle_message(msg)
                if response:
                    sys.stdout.write(json.dumps(response) + "\n")
                    sys.stdout.flush()
            except json.JSONDecodeError:
                self._log(f"Invalid JSON: {line[:100]}")
            except Exception as e:
                self._log(f"Error handling message: {e}")
                # Send error response if we have an id
                if isinstance(line, str):
                    try:
                        rid = json.loads(line).get("id")
                        if rid is not None:
                            err_resp = {"jsonrpc": "2.0", "id": rid, "error": {"code": -32000, "message": str(e)}}
                            sys.stdout.write(json.dumps(err_resp) + "\n")
                            sys.stdout.flush()
                    except Exception:
                        pass

    def _handle_message(self, msg):
        """Handle a JSON-RPC message."""
        method = msg.get("method", "")
        rid = msg.get("id")
        params = msg.get("params", {})

        # Initialize
        if method == "initialize":
            return {
                "jsonrpc": "2.0",
                "id": rid,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {
                        "name": "kusto-mcp-server",
                        "version": "1.0.0"
                    }
                }
            }

        # Initialized notification (no response needed)
        if method == "notifications/initialized":
            self._log("MCP initialized")
            return None

        # List tools
        if method == "tools/list":
            return {
                "jsonrpc": "2.0",
                "id": rid,
                "result": {"tools": self.TOOLS}
            }

        # Call tool
        if method == "tools/call":
            tool_name = params.get("name", "")
            tool_args = params.get("arguments", {})
            self._log(f"Tool call: {tool_name}({json.dumps(tool_args)})")

            result_text = self.handle_tool(tool_name, tool_args)

            return {
                "jsonrpc": "2.0",
                "id": rid,
                "result": {
                    "content": [{"type": "text", "text": result_text}]
                }
            }

        # Ping
        if method == "ping":
            return {"jsonrpc": "2.0", "id": rid, "result": {}}

        # Unknown method
        if rid is not None:
            return {
                "jsonrpc": "2.0",
                "id": rid,
                "error": {"code": -32601, "message": f"Method not found: {method}"}
            }

        return None


if __name__ == "__main__":
    server = KustoMCPServer()
    server.run()
