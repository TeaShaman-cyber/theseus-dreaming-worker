#!/usr/bin/env python3
from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: patch_mcp_gate_path.py /path/to/mcp-gate.py")

path = Path(sys.argv[1])
text = path.read_text()

config_old = 'PORT = int(os.environ.get("PORT") or 8000)\n'
config_new = config_old + 'MCP_UPSTREAM_PATH = os.environ.get("MCP_UPSTREAM_PATH", "").strip()\n'

proxy_old = '    url = UPSTREAM + request.url.path + (f"?{request.url.query}" if request.url.query else "")\n'
proxy_new = (
    '    upstream_path = MCP_UPSTREAM_PATH if MCP_UPSTREAM_PATH and request.url.path.rstrip("/") == "/mcp" else request.url.path\n'
    '    url = UPSTREAM + upstream_path + (f"?{request.url.query}" if request.url.query else "")\n'
)

if 'MCP_UPSTREAM_PATH = ' not in text:
    if config_old not in text:
        raise SystemExit("mcp-gate config insertion point not found")
    text = text.replace(config_old, config_new, 1)

if proxy_new not in text:
    if proxy_old not in text:
        raise SystemExit("mcp-gate proxy insertion point not found")
    text = text.replace(proxy_old, proxy_new, 1)

path.write_text(text)
