import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { loadBridgeConfig } from "./config.mjs";
import { createProxyServer } from "./proxy.mjs";
import { RuntimeManager } from "./runtime.mjs";
import {
  isAuthorizedBearer,
  redactLogMessage,
  validateBridgeToken,
} from "./security.mjs";

const MAX_REQUEST_BYTES = 1024 * 1024;
const SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1000;

function writeJson(response, status, value, headers = {}) {
  if (response.headersSent) return;
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  response.end(JSON.stringify(value));
}

async function readJsonBody(request) {
  const contentLength = Number(request.headers["content-length"] || 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    const error = new Error("Request body is too large");
    error.statusCode = 413;
    throw error;
  }

  const chunks = [];
  let bytes = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_REQUEST_BYTES) {
      tooLarge = true;
      continue;
    }
    chunks.push(chunk);
  }
  if (tooLarge) {
    const error = new Error("Request body is too large");
    error.statusCode = 413;
    throw error;
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON");
    error.statusCode = 400;
    throw error;
  }
}

function mcpError(response, status, message) {
  writeJson(response, status, {
    jsonrpc: "2.0",
    error: { code: -32000, message },
    id: null,
  });
}

export function createBridgeHttpServer({ configs, token, logger = console }) {
  const validatedToken = validateBridgeToken(token);
  const configById = new Map(configs.map((config) => [config.id, config]));
  const runtimes = new RuntimeManager(configs, logger);
  const sessions = new Map();
  const pendingSessions = new Map();

  const sessionCount = (serverId) => {
    let count = pendingSessions.get(serverId) || 0;
    for (const session of sessions.values()) {
      if (session.serverId === serverId) count += 1;
    }
    return count;
  };

  const removeSession = (sessionId) => {
    sessions.delete(sessionId);
  };
  const sessionReaper = setInterval(() => {
    const expiredBefore = Date.now() - SESSION_IDLE_TIMEOUT_MS;
    for (const [sessionId, session] of sessions) {
      if (session.lastActivity >= expiredBefore) continue;
      sessions.delete(sessionId);
      void session.proxyServer.close().catch(() => {});
    }
  }, 60_000);
  sessionReaper.unref();

  const httpServer = createServer(async (request, response) => {
    const requestUrl = new URL(request.url || "/", "http://mcp-bridge.local");

    if (requestUrl.pathname === "/health") {
      if (request.method !== "GET") {
        writeJson(
          response,
          405,
          { error: "Method not allowed" },
          { allow: "GET" },
        );
        return;
      }
      writeJson(response, 200, {
        status: "ok",
        version: 1,
        configuredServers: configs.length,
      });
      return;
    }

    if (!isAuthorizedBearer(request.headers.authorization, validatedToken)) {
      writeJson(
        response,
        401,
        { error: "Unauthorized" },
        { "www-authenticate": "Bearer" },
      );
      return;
    }

    if (requestUrl.pathname === "/servers") {
      if (request.method !== "GET") {
        writeJson(
          response,
          405,
          { error: "Method not allowed" },
          { allow: "GET" },
        );
        return;
      }
      writeJson(response, 200, {
        servers: configs.map(({ id, label }) => ({
          id,
          label,
          source: "bridge",
          transport: "streamable-http",
          endpoint: `/mcp/${encodeURIComponent(id)}`,
        })),
      });
      return;
    }

    const routeMatch = requestUrl.pathname.match(/^\/mcp\/([^/]+)$/);
    if (!routeMatch) {
      writeJson(response, 404, { error: "Not found" });
      return;
    }

    let serverId;
    try {
      serverId = decodeURIComponent(routeMatch[1]);
    } catch {
      writeJson(response, 400, { error: "Invalid MCP server id" });
      return;
    }
    const config = configById.get(serverId);
    if (!config) {
      writeJson(response, 404, { error: "Unknown MCP server" });
      return;
    }
    if (!new Set(["GET", "POST", "DELETE"]).has(request.method || "")) {
      writeJson(
        response,
        405,
        { error: "Method not allowed" },
        { allow: "GET, POST, DELETE" },
      );
      return;
    }

    const sessionId = request.headers["mcp-session-id"];
    const normalizedSessionId =
      typeof sessionId === "string" ? sessionId : undefined;
    let session = normalizedSessionId
      ? sessions.get(normalizedSessionId)
      : undefined;

    if (session && session.serverId !== serverId) {
      mcpError(response, 404, "Unknown MCP session");
      return;
    }

    try {
      if (request.method === "POST") {
        const body = await readJsonBody(request);
        if (!session) {
          if (normalizedSessionId || !isInitializeRequest(body)) {
            mcpError(response, 400, "Missing or invalid MCP session");
            return;
          }
          if (sessionCount(serverId) >= config.maxSessions) {
            mcpError(response, 503, "MCP session limit reached");
            return;
          }

          pendingSessions.set(
            serverId,
            (pendingSessions.get(serverId) || 0) + 1,
          );
          let proxyServer;
          let transport;
          try {
            const runtime = runtimes.get(serverId);
            proxyServer = await createProxyServer(runtime, config);
            transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: randomUUID,
              onsessioninitialized: (initializedSessionId) => {
                sessions.set(initializedSessionId, {
                  serverId,
                  proxyServer,
                  transport,
                  lastActivity: Date.now(),
                });
              },
              onsessionclosed: removeSession,
              retryInterval: 1_000,
            });
            transport.onclose = () => {
              if (transport.sessionId) removeSession(transport.sessionId);
            };
            await proxyServer.connect(transport);
            session = {
              serverId,
              proxyServer,
              transport,
              lastActivity: Date.now(),
            };
            await transport.handleRequest(request, response, body);
          } catch (error) {
            if (!transport?.sessionId) {
              await proxyServer?.close().catch(() => {});
            }
            throw error;
          } finally {
            pendingSessions.set(
              serverId,
              Math.max(0, (pendingSessions.get(serverId) || 1) - 1),
            );
          }
          return;
        }

        session.lastActivity = Date.now();
        await session.transport.handleRequest(request, response, body);
        return;
      }

      if (!session) {
        mcpError(response, 400, "Missing or invalid MCP session");
        return;
      }
      session.lastActivity = Date.now();
      await session.transport.handleRequest(request, response);
    } catch (error) {
      logger.error(
        `[${serverId}] request failed: ${redactLogMessage(error?.message || error)}`,
      );
      if (!response.headersSent) {
        mcpError(
          response,
          Number.isInteger(error?.statusCode) ? error.statusCode : 500,
          error?.statusCode ? error.message : "MCP bridge request failed",
        );
      }
    }
  });

  httpServer.maxHeadersCount = 64;
  httpServer.headersTimeout = 10_000;
  httpServer.requestTimeout = 310_000;

  return {
    server: httpServer,
    async close() {
      clearInterval(sessionReaper);
      for (const session of sessions.values()) {
        await session.proxyServer.close().catch(() => {});
      }
      sessions.clear();
      await runtimes.close();
      if (httpServer.listening) {
        await new Promise((resolve, reject) =>
          httpServer.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  };
}

async function main() {
  const configPath = process.env.MCP_BRIDGE_CONFIG || "/config/servers.json";
  const port = Number(process.env.PORT || 3400);
  const host = process.env.HOST || "0.0.0.0";
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be a valid TCP port");
  }

  const bridgeConfig = loadBridgeConfig(configPath);
  const app = createBridgeHttpServer({
    configs: bridgeConfig.servers,
    token: process.env.MCP_BRIDGE_TOKEN,
  });
  await new Promise((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(port, host, resolve);
  });
  console.info(`Neo Chat MCP bridge listening on ${host}:${port}`);

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(
      `MCP bridge startup failed: ${redactLogMessage(error.message)}`,
    );
    process.exit(1);
  });
}
