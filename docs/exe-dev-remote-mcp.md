# Remote MCP on exe.dev for ChatGPT

This is the working recipe for exposing a service's **Streamable HTTP MCP** from an exe.dev VM to ChatGPT without inventing a separate OAuth service.

The key component is exe.dev's official [`mcp-gate.py`](https://exe.dev/deploy/mcp-server/mcp-gate.py). It provides the OAuth surface that ChatGPT expects, delegates human sign-in to exe.dev, restricts access to an explicit e-mail allowlist, and reverse-proxies authenticated MCP requests to the service running locally on the VM.

Official exe.dev recipe: <https://exe.dev/deploy/mcp-server>

## Architecture

```text
ChatGPT
   |
   | HTTPS + MCP OAuth
   v
https://<vm>.exe.xyz/mcp
   |
   | public exe.dev HTTP proxy, port 8000
   v
mcp-gate :8000
   |
   | authenticated reverse proxy
   v
service MCP on localhost:<service-port>/<service-prefix>/mcp
```

For ChatGPT/claude.ai the exe.dev HTTP proxy must be public because these clients connect from their own servers and do not have a field for an exe.dev VM token. `mcp-gate` becomes the authentication boundary: a public HTTP entrypoint does **not** mean unauthenticated MCP access.

Keep the actual service on a different local port, normally `8001`, and let only `mcp-gate` own port `8000`.

## Preconditions

The service must already expose MCP over **Streamable HTTP**.

Example internal endpoint:

```text
http://127.0.0.1:8001/mcp
```

If the service uses a prefix, for example Mastra:

```text
http://127.0.0.1:8001/api/mcp
```

The service should run under a persistent supervisor such as systemd and restart on failure/reboot.

## 1. Move the service off port 8000

`mcp-gate` uses port `8000`, so move the service to `8001` (or another internal port).

Prefer making the service port configurable rather than hard-coding deployment-specific values.

Example:

```ts
server: {
  host: '0.0.0.0',
  port: Number(process.env.MASTRA_PORT ?? 8000),
}
```

Then set the deployment override in its service unit:

```ini
Environment=MASTRA_PORT=8001
```

Verify:

```bash
ss -ltnp | grep -E ':8000|:8001'
```

At this point the service should answer on `8001` and nothing should yet own `8000`.

## 2. Install the official exe.dev mcp-gate

On the VM:

```bash
mkdir -p ~/mcp-gate
cd ~/mcp-gate

curl -fsSLO https://exe.dev/deploy/mcp-server/mcp-gate.py

uv init --bare --python 3.14
uv add 'mcp>=2.3,<3'
```

Do not replace this with a custom OAuth proxy unless there is a concrete requirement that `mcp-gate` cannot satisfy. exe.dev already implements the OAuth metadata, dynamic client registration, authorization-code flow, refresh tokens, consent page, and reverse proxy needed by ChatGPT.

## 3. Configure access and upstream routing

Create a private environment file:

```bash
install -m 600 /dev/null ~/mcp-gate.env
```

For a service whose MCP endpoint is directly `/mcp`:

```bash
cat > ~/mcp-gate.env <<'EOF'
ALLOWED_EMAILS=<exe-dev-login-email>
UPSTREAM=http://127.0.0.1:8001
PUBLIC_URL=https://<vm>.exe.xyz
PORT=8000
EOF
```

`ALLOWED_EMAILS` is a comma-separated list of exe.dev account e-mail addresses allowed to approve clients.

### Services with a path prefix

The stock `mcp-gate` builds the upstream URL as:

```text
UPSTREAM + incoming request path
```

If the gate fronts **only MCP**, an upstream prefix is enough. For example, if the internal endpoint is `/api/mcp`:

```bash
UPSTREAM=http://127.0.0.1:8001/api
```

Then public `/mcp` becomes internal `/api/mcp`.

Do **not** use that prefix trick when the same upstream also serves a GUI or other root paths. It would rewrite every route: for example `/agent-builder` would incorrectly become `/api/agent-builder`.

For that mixed case, keep the upstream root:

```bash
UPSTREAM=http://127.0.0.1:8001
```

and add an opt-in rewrite only for the public MCP path. This repository includes a small compatibility patch:

```bash
python3 tools/patch_mcp_gate_path.py ~/mcp-gate/mcp-gate.py
```

Then configure:

```bash
MCP_UPSTREAM_PATH=/api/mcp
```

The result is:

```text
/mcp           -> /api/mcp
/agent-builder -> /agent-builder
/*              -> /*
```

This is the recommended layout for Mastra Agent Builder because Studio and MCP share the same server.

## 4. Run mcp-gate under systemd

Create `/etc/systemd/system/mcp-gate.service`:

```ini
[Unit]
Description=mcp-gate: OAuth sign-in with exe.dev in front of MCP
After=network-online.target <your-service>.service
Wants=network-online.target

[Service]
User=exedev
WorkingDirectory=/home/exedev/mcp-gate
EnvironmentFile=/home/exedev/mcp-gate.env
ExecStart=/home/exedev/mcp-gate/.venv/bin/python mcp-gate.py
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
```

Enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mcp-gate.service
```

Check:

```bash
systemctl --no-pager --full status mcp-gate.service
journalctl -u mcp-gate.service -n 50 --no-pager
ss -ltnp | grep -E ':8000|:8001'
```

Expected layout:

```text
8000 -> mcp-gate
8001 -> service
```

## 5. Verify OAuth metadata and proxying locally

An unauthenticated MCP call should return `401`, not `404` or `502`:

```bash
curl -i -X POST http://127.0.0.1:8000/mcp
```

Expected signal:

```text
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer ... resource_metadata="https://<vm>.exe.xyz/.well-known/oauth-protected-resource/mcp"
```

OAuth server metadata must be available:

```bash
curl -s http://127.0.0.1:8000/.well-known/oauth-authorization-server
```

It should advertise at least:

- `authorization_endpoint`
- `token_endpoint`
- `registration_endpoint`
- authorization-code + refresh-token grants
- PKCE `S256`

To test gate -> upstream locally without doing the browser flow, use an allowed address in the trusted exe.dev header:

```bash
curl -i \
  -H 'X-ExeDev-Email: <allowed-email>' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{
    "jsonrpc":"2.0",
    "id":1,
    "method":"initialize",
    "params":{
      "protocolVersion":"2025-06-18",
      "capabilities":{},
      "clientInfo":{"name":"mcp-gate-check","version":"1"}
    }
  }' \
  http://127.0.0.1:8000/mcp
```

A `200` initialization response proves the gate can reach the service.

## 6. Make only the gate-facing exe.dev proxy public

From a machine authenticated to exe.dev:

```bash
ssh exe.dev share set-public <vm>
```

Verify:

```bash
ssh exe.dev share show <vm>
```

Why public? ChatGPT's backend must be able to reach the OAuth metadata and `/mcp`. Authentication is then enforced by `mcp-gate`, not by the outer exe.dev login wall.

The upstream service remains behind the gate on its internal port.

To undo this later:

```bash
ssh exe.dev share set-private <vm>
```

## 7. Connect ChatGPT

In ChatGPT

1. Add a custom MCP/plugin.
2. Connection URL:

   ```text
   https://<vm>.exe.xyz/mcp
   ```

2. Select OAuth.
3. Leave manual **Client ID** and **Client Secret** empty.
4. Start the connection.
5. exe.dev signs the user in.
6. `mcp-gate` shows a consent page naming the requesting app.
7. Approve only when the connection was just initiated from ChatGPT.

A normal first connection can show a sequence like:

```text
POST /mcp                                        -> 401
GET  /.well-known/oauth-protected-resource/... -> 200
GET  /.well-known/oauth-authorization-server   -> 200
GET  /authorize                                  -> 302
GET  /consent                                    -> 200
POST /consent                                  -> 302
POST /token                                      -> 200
POST /mcp                                        -> 401
POST /mcp                                        -> 200
```

The first `401` is OAuth discovery, not necessarily a failure. Judge the connection by the final authenticated `/mcp` request and by an actual tool/list call.

## 8. Security and revocation

`mcp-gate` only allows:

- OAuth access tokens it issued;
- exe.dev requests carrying an allowed `X-ExeDev-Email`;
- VM-to-VM calls identified by exe.dev.

Tokens are stored hashed in `~/data/mcp-gate.db`. The official gate issues one-hour access tokens and rotating refresh tokens; exe.dev's recipe describes sign-ins as lasting 90 days of use.

To revoke an account:

1. remove the address from `ALLOWED_EMAILS`;
2. restart the gate:

```bash
sudo systemctl restart mcp-gate.service
```

Do not put provider/API secrets in this file. `mcp-gate.env` should contain only gate routing/access configuration.

## Troubleshooting

### ChatGPT says it cannot determine OAuth settings

Check externally:

```bash
curl -s https://<vm>.exe.xyz/.well-known/oauth-authorization-server
```

If that does not return the gate's metadata, check:

- the VM proxy is public;
- `mcp-gate` is listening on `8000`;
- `PUBLIC_URL` is exactly `https://<vm>.exe.xyz`;
- the outer exe.dev login wall is not intercepting OAuth discovery.

### Consent page says `Not allowed`

The exe.dev account used for login is absent from `ALLOWED_EMAILS`.

Update `~/mcp-gate.env` and restart `mcp-gate`.

### `502` from mcp-gate

The gate cannot reach the service. Check:

```bash
ss -ltnp | grep -E ':8000|:8001'
journalctl -u <your-service>.service -n 50 --no-pager
```

Also verify the routing mode.

For an MCP-only upstream, a prefix may be enough:

```text
incoming /mcp
UPSTREAM=http://127.0.0.1:8001/api
result=http://127.0.0.1:8001/api/mcp
```

For Mastra Agent Builder, where the same server also serves the GUI, use the root upstream plus the MCP-only rewrite:

```text
UPSTREAM=http://127.0.0.1:8001
MCP_UPSTREAM_PATH=/api/mcp
/mcp           -> /api/mcp
/agent-builder -> /agent-builder
```

If `/mcp` works but the GUI returns 404, check that `UPSTREAM` was not incorrectly set to `.../api`.

### systemd shows `203/EXEC`

`ExecStart` points to a binary that systemd cannot execute. Resolve the actual absolute path with `command -v <binary>` and use that path in the unit.

### The service works directly but ChatGPT still errors

Read the gate log while reconnecting:

```bash
journalctl -u mcp-gate.service -f
```

Distinguish OAuth discovery failures from actual post-auth failures. A first `401` followed by `/http 200` and `/mcp 200` is a successful flow.

## Working Theseus / Mastra example

Current development layout:

```text
Public MCP:
  https://theseus-exe-shell-probe.exe.xyz/mcp

mcp-gate:
  0.0.0.0:8000

Mastra:
  0.0.0.0:8001
  internal MCP route: /api/mcp

mcp-gate routing:
  UPSTREAM=http://127.0.0.1:8001
  MCP_UPSTREAM_PATH=/api/mcp
  incoming /mcp -> http://127.0.0.1:8001/api/mcp
  incoming /agent-builder -> http://127.0.0.1:8001/agent-builder

Services:
  mcp-gate.service
  theseus-dreaming-builder.service
```

Mastra keeps `8000` as its code default and receives `MASTRA_PORT=8001` only from the deployment service. This avoids baking exe.dev/gate topology into application semantics.

The gate uses the repository's `tools/patch_mcp_gate_path.py` compatibility patch so the public ChatGPT URL can remain `/mcp` while the Mastra built-in MCP stays at its native `/api/mcp`. Other paths are not rewritten, so the existing Agent Builder GUI URL continues to work.

Verification performed on 2026-11-21:

- OAuth metadata returned successfully.
- unauthenticated `/mcp` returned the expected `401`;
- MCP `initialize` through `mcp-gate` returned `200`;
- ChatGPT completed exe.dev sign-in and consent;
- `/token` returned `200`;
- subsequent MCP requests returned `200`;
- native ChatGPT calls to Mastra Builder successfully listed agents, stored agents, and available models.

## Sources

- exe.dev remote MCP recipe: <https://exe.dev/deploy/mcp-server>
- official `mcp-gate.py`: <https://exe.dev/deploy/mcp-server/mcp-gate.py>
- exe.dev sharing: <https://exe.dev/docs/sharing>
