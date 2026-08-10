import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "bridge-fixture", version: "1.0.0" });

process.stderr.write(
  "Authorization: Basic dXNlcjpwYXNz\nAWS_SECRET_ACCESS_KEY=fixture-secret\n",
);

server.registerTool(
  "echo",
  {
    description: "Echo text for bridge tests",
    inputSchema: { text: z.string() },
  },
  async ({ text }) => ({ content: [{ type: "text", text }] }),
);

server.registerTool(
  "large-output",
  {
    description: "Return a deliberately oversized result",
    inputSchema: {},
  },
  async () => ({ content: [{ type: "text", text: "x".repeat(4096) }] }),
);

server.registerTool(
  "pid",
  {
    description: "Return the fixture process id",
    inputSchema: {},
  },
  async () => ({
    content: [{ type: "text", text: String(process.pid) }],
  }),
);

server.registerTool(
  "sleep",
  {
    description: "Wait long enough to exercise bridge timeouts",
    inputSchema: { milliseconds: z.number().int().min(0).max(10_000) },
  },
  async ({ milliseconds }) => {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
    return { content: [{ type: "text", text: "awake" }] };
  },
);

server.registerTool(
  "environment",
  {
    description: "Return selected environment values for isolation tests",
    inputSchema: {},
  },
  async () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          path: process.env.PATH ?? null,
          home: process.env.HOME ?? null,
          user: process.env.USER ?? null,
          allowed: process.env.BRIDGE_ALLOWED_TEST ?? null,
          forbidden: process.env.BRIDGE_FORBIDDEN_TEST ?? null,
        }),
      },
    ],
  }),
);

server.registerTool(
  "unterminated-output",
  {
    description: "Write an oversized raw stdout frame without a newline",
    inputSchema: {},
  },
  async () => {
    process.stdout.write("x".repeat(128 * 1024));
    return { content: [{ type: "text", text: "unreachable" }] };
  },
);

await server.connect(new StdioServerTransport());
