import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { buildChildEnvironment, parseBridgeConfig } from "../config.mjs";
import { createBridgeHttpServer } from "../server.mjs";
import {
  assertBoundedResult,
  isAuthorizedBearer,
  redactLogMessage,
  validateBridgeToken,
} from "../security.mjs";

const TOKEN = "test-token-".padEnd(64, "a");

describe("bridge configuration and security", () => {
  it("accepts a bounded startup allowlist and filters child environment", () => {
    const parsed = parseBridgeConfig({
      version: 1,
      servers: [
        {
          id: "local-files",
          command: "/usr/local/bin/node",
          args: ["/servers/files.mjs"],
          envAllowlist: ["ALLOWED_TOKEN"],
        },
      ],
    });
    const environment = buildChildEnvironment(parsed.servers[0], {
      PATH: "/bin",
      ALLOWED_TOKEN: "yes",
      PRIVATE_TOKEN: "no",
    });

    assert.equal(environment.PATH, "/bin");
    assert.equal(environment.ALLOWED_TOKEN, "yes");
    assert.equal(environment.HOME, "");
    assert.equal(environment.USER, "");
    assert.equal("PRIVATE_TOKEN" in environment, false);
    assert.throws(
      () =>
        parseBridgeConfig({
          version: 1,
          servers: [{ id: "bad/id", command: "node", envAllowlist: [] }],
        }),
      /unsupported characters/,
    );
  });

  it("uses constant-shape bearer checks and redacts multiline secrets", () => {
    validateBridgeToken(TOKEN);
    assert.equal(isAuthorizedBearer(`Bearer ${TOKEN}`, TOKEN), true);
    assert.equal(isAuthorizedBearer("Bearer wrong", TOKEN), false);
    assert.equal(isAuthorizedBearer(undefined, TOKEN), false);

    const payload = [
      "Authorization: Basic dXNlcjpwYXNz",
      "Authorization: Bearer bearer-value",
      "api_key = secret value",
      "X-Api-Key: abc.def-123",
      "AWS_SECRET_ACCESS_KEY=abc123",
      'secretAccessKey="secret value"',
      "https://user:pass@example.test/path?token=query-secret",
    ].join("\n");
    const redacted = redactLogMessage(payload);
    for (const secret of [
      "dXNlcjpwYXNz",
      "bearer-value",
      "secret value",
      "abc.def-123",
      "abc123",
      "user:pass",
      "query-secret",
    ]) {
      assert.equal(redacted.includes(secret), false, secret);
    }
    assert.equal(redacted.includes("\n"), false);
    assert.match(redacted, /\[redacted\]/);
  });

  it("rejects results beyond the configured output boundary", () => {
    assert.equal(assertBoundedResult({ ok: true }, 1024).ok, true);
    assert.throws(
      () => assertBoundedResult({ text: "x".repeat(2048) }, 1024),
      /byte limit/,
    );
  });
});

describe("authenticated stdio to Streamable HTTP bridge", () => {
  let app;
  let endpoint;
  const logs = [];

  before(async () => {
    process.env.BRIDGE_ALLOWED_TEST = "allowed-value";
    process.env.BRIDGE_FORBIDDEN_TEST = "forbidden-value";
    const fixturePath = fileURLToPath(
      new URL("./fixture-server.mjs", import.meta.url),
    );
    const config = parseBridgeConfig({
      version: 1,
      servers: [
        {
          id: "fixture",
          label: "Fixture",
          command: process.execPath,
          args: [fixturePath],
          envAllowlist: ["BRIDGE_ALLOWED_TEST"],
          timeoutMs: 1_000,
          maxOutputBytes: 2_048,
          maxSessions: 8,
        },
      ],
    });
    const quietLogger = {
      info(message) {
        logs.push(String(message));
      },
      warn(message) {
        logs.push(String(message));
      },
      error(message) {
        logs.push(String(message));
      },
    };
    app = createBridgeHttpServer({
      configs: config.servers,
      token: TOKEN,
      logger: quietLogger,
    });
    await new Promise((resolveListen, reject) => {
      app.server.once("error", reject);
      app.server.listen(0, "127.0.0.1", resolveListen);
    });
    const address = app.server.address();
    endpoint = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await app.close();
    delete process.env.BRIDGE_ALLOWED_TEST;
    delete process.env.BRIDGE_FORBIDDEN_TEST;
  });

  it("exposes a safe health endpoint and protects discovery", async () => {
    const health = await fetch(`${endpoint}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      status: "ok",
      version: 1,
      configuredServers: 1,
    });

    assert.equal((await fetch(`${endpoint}/servers`)).status, 401);
    const discovered = await fetch(`${endpoint}/servers`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(discovered.status, 200);
    assert.deepEqual((await discovered.json()).servers, [
      {
        id: "fixture",
        label: "Fixture",
        source: "bridge",
        transport: "streamable-http",
        endpoint: "/mcp/fixture",
      },
    ]);
  });

  it("forwards MCP tool discovery and calls without exposing commands", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`${endpoint}/mcp/fixture`),
      { requestInit: { headers: { authorization: `Bearer ${TOKEN}` } } },
    );
    const client = new Client({ name: "bridge-test", version: "1.0.0" });
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      assert.deepEqual(
        tools.tools.map((tool) => tool.name),
        [
          "echo",
          "large-output",
          "pid",
          "sleep",
          "environment",
          "unterminated-output",
        ],
      );
      const result = await client.callTool({
        name: "echo",
        arguments: { text: "hello through stdio" },
      });
      assert.equal(result.content[0].text, "hello through stdio");
      await assert.rejects(
        client.callTool({ name: "large-output", arguments: {} }),
      );

      const environmentResult = await client.callTool({
        name: "environment",
        arguments: {},
      });
      const environment = JSON.parse(environmentResult.content[0].text);
      assert.equal(environment.allowed, "allowed-value");
      assert.equal(environment.forbidden, null);
      assert.equal(environment.home, "");
      assert.equal(environment.user, "");
      assert.equal(typeof environment.path, "string");
      assert.equal(environment.path.length > 0, true);

      const joinedLogs = logs.join("\n");
      assert.equal(joinedLogs.includes("dXNlcjpwYXNz"), false);
      assert.equal(joinedLogs.includes("fixture-secret"), false);
    } finally {
      await client.close();
    }
  });

  it("retires a timed-out child and restarts it after bounded backoff", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`${endpoint}/mcp/fixture`),
      { requestInit: { headers: { authorization: `Bearer ${TOKEN}` } } },
    );
    const client = new Client({
      name: "bridge-restart-test",
      version: "1.0.0",
    });
    await client.connect(transport);
    try {
      const firstPidResult = await client.callTool({
        name: "pid",
        arguments: {},
      });
      const firstPid = firstPidResult.content[0].text;

      await assert.rejects(
        client.callTool({
          name: "sleep",
          arguments: { milliseconds: 2_000 },
        }),
      );

      const restartStartedAt = Date.now();
      const secondPidResult = await client.callTool({
        name: "pid",
        arguments: {},
      });
      const restartElapsedMs = Date.now() - restartStartedAt;
      const secondPid = secondPidResult.content[0].text;
      assert.notEqual(secondPid, firstPid);
      assert.equal(restartElapsedMs >= 400, true);
      assert.equal(restartElapsedMs < 5_000, true);
    } finally {
      await client.close();
    }
  });

  it("terminates an oversized unterminated stdout frame before parsing", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`${endpoint}/mcp/fixture`),
      { requestInit: { headers: { authorization: `Bearer ${TOKEN}` } } },
    );
    const client = new Client({ name: "bridge-frame-test", version: "1.0.0" });
    await client.connect(transport);
    try {
      const firstPidResult = await client.callTool({
        name: "pid",
        arguments: {},
      });
      const startedAt = Date.now();
      await assert.rejects(
        client.callTool({ name: "unterminated-output", arguments: {} }),
      );
      assert.equal(Date.now() - startedAt < 5_000, true);

      const secondPidResult = await client.callTool({
        name: "pid",
        arguments: {},
      });
      assert.notEqual(
        secondPidResult.content[0].text,
        firstPidResult.content[0].text,
      );
    } finally {
      await client.close();
    }
  });

  it("retires a child when the downstream request is aborted", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`${endpoint}/mcp/fixture`),
      { requestInit: { headers: { authorization: `Bearer ${TOKEN}` } } },
    );
    const client = new Client({ name: "bridge-abort-test", version: "1.0.0" });
    await client.connect(transport);
    try {
      const firstPidResult = await client.callTool({
        name: "pid",
        arguments: {},
      });
      const controller = new AbortController();
      const pending = client.callTool(
        { name: "sleep", arguments: { milliseconds: 5_000 } },
        undefined,
        { signal: controller.signal, timeout: 10_000 },
      );
      setTimeout(() => controller.abort(), 50);
      await assert.rejects(pending);

      const secondPidResult = await client.callTool({
        name: "pid",
        arguments: {},
      });
      assert.notEqual(
        secondPidResult.content[0].text,
        firstPidResult.content[0].text,
      );
    } finally {
      await client.close();
    }
  });
});
