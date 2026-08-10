# Local MCP stdio bridge

The local bridge exposes MCP over Streamable HTTP. A local Docker deployment can
optionally run the `mcp-bridge` profile, which starts allowlisted stdio MCP
servers inside a separate container and exposes them as authenticated
Streamable HTTP endpoints.

The bridge is intentionally not available in Cloudflare Worker or hosted mode.
The browser cannot submit commands, arguments, working directories, or
environment variables to it.

## Configure the allowlist

Copy `docker/mcp-bridge/servers.example.json` and replace the example entry.
The file is read exactly once at startup and mounted read-only. Each entry
supports:

| Field            | Purpose                                              |
| ---------------- | ---------------------------------------------------- |
| `id`             | Stable URL-safe server ID.                           |
| `label`          | Non-sensitive display name returned by `/servers`.   |
| `command`        | Executable already present in the bridge container.  |
| `args`           | Fixed command arguments.                             |
| `cwd`            | Optional absolute working directory.                 |
| `envAllowlist`   | Environment variable names the child may inherit.    |
| `timeoutMs`      | Per-request limit, from 1 second to 5 minutes.       |
| `maxOutputBytes` | Maximum serialized MCP result, from 1 KiB to 10 MiB. |
| `maxSessions`    | Concurrent downstream sessions, from 1 to 128.       |

The stock image contains Node.js and the MCP SDK, but not third-party MCP
server packages. Extend the image to install a pinned server package, or mount
an audited server script and only the data directories it needs. Do not mount
the Docker socket. Prefer read-only data mounts unless the tool explicitly
needs write access.

Environment allowlisting contains names, not values. Supply values to the
bridge container with a private Compose override or secret manager; do not put
secrets in the JSON file. On Linux, the SDK also creates its default `HOME`,
`LOGNAME`, `SHELL`, `TERM`, and `USER` variable names; the bridge explicitly
sets those values to empty unless the name is allowlisted. `PATH` is always
present. Tests exercise the environment of the real spawned child, not only the
configuration helper.

This allowlist prevents accidental inheritance; it is not a sandbox for a
malicious child. The bridge and its stdio children normally share a container
UID, so a hostile process may inspect same-UID `/proc` state and recover the
bridge bearer token or other secrets injected into the container. Every
configured child is therefore part of the same trust boundary: a compromised
one may call other bridge endpoints with that token and access any mounts
visible to the shared UID. Every command and package must be fully trusted,
pinned, and audited. Do not inject unrelated secrets into the bridge container.
Stronger isolation requires one container per server, a different UID,
`/proc` isolation, and a dedicated secret broker.

## Start and connect

Generate a bearer token and start the optional profile:

```bash
export MCP_BRIDGE_TOKEN="$(openssl rand -hex 32)"
export MCP_BRIDGE_CONFIG_FILE="./docker/mcp-bridge/servers.local.json"
docker compose --profile mcp up --build
```

The host-bound discovery URL is `http://127.0.0.1:3400/servers`. From the
`neo-chat` container, configure a custom MCP server using
`http://mcp-bridge:3400/mcp/<server-id>` and an `Authorization` header whose
value is `Bearer <MCP_BRIDGE_TOKEN>`. `/servers` and every `/mcp/:id` request
require that bearer token. `/health` is unauthenticated and returns only bridge
version and configured-server count.

In a local deployment, Plugin Market -> MCP -> Custom MCP can load this list
directly. Enter `http://mcp-bridge:3400/servers` and the bridge token. The
browser encrypts the token for the request-proof-protected discovery API; the
server decrypts it only for that outbound request. The response contains only
the server id, label, ordinary Streamable HTTP endpoint, transport, and
`source: "bridge"`. Commands, arguments, working directories, and environment
configuration never enter the browser. Hosted deployments hide this flow and
the API returns not found.

The bridge forwards tools, resources, resource templates, prompts, and
completions advertised by the stdio server. Resource subscriptions, list-change
notifications, server-initiated sampling, elicitation, roots, OAuth, and
experimental task APIs are not forwarded. A timed-out or aborted child is
closed and marked unhealthy; the next request starts a fresh child after
bounded exponential backoff. Child stderr content is never logged. Bridge-owned
errors still pass through defensive redaction for authorization headers,
credential assignments, URL userinfo, quoted values, and multiline input.

`maxOutputBytes` limits a successfully parsed MCP result. Before the SDK parses
each newline-delimited JSON-RPC message, the bridge also caps the raw frame at
`maxOutputBytes` plus 64 KiB of bounded envelope overhead. Oversized or
unterminated frames clear the buffer and retire the child. A single Node stream
chunk is appended before that check runs, so the 256 MiB container memory limit
and PID limit remain defense in depth.

## Container boundary

The Compose service runs as a non-root user with a read-only root filesystem,
all Linux capabilities dropped, `no-new-privileges`, bounded memory/PIDs, and a
small no-exec `/tmp`. Port publishing defaults to host loopback. The profile is
off unless explicitly selected.
