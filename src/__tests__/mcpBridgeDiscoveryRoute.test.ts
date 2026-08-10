import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deploymentMode: "local" as "local" | "hosted",
  decryptOptionalSecret: vi.fn(),
  safeFetchJson: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/security/deployment", () => ({
  getDeploymentMode: () => mocks.deploymentMode,
}));

vi.mock("@/lib/byok/server", () => ({
  decryptOptionalSecret: mocks.decryptOptionalSecret,
}));

vi.mock("@/lib/security/safeFetch", () => ({
  safeFetchJson: mocks.safeFetchJson,
}));

vi.mock("@/lib/security/urlPolicy", () => ({
  getSafeUrlPolicy: () => ({
    context: "mcp",
    allowedProtocols: ["http:", "https:"],
  }),
}));

vi.mock("@/lib/utils/safeServerLog", () => ({
  safeServerLogError: vi.fn(),
}));

const tokenSecret = {
  v: 1,
  kid: "test-key",
  alg: "RSA-OAEP-256+A256GCM",
  iv: "iv",
  wrappedKey: "wrapped",
  ciphertext: "ciphertext",
  context: "mcp:bridge-discovery",
} as const;

function request(body: unknown) {
  return new Request("http://localhost:3000/api/plugins/mcp-bridge/discover", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("local MCP bridge discovery route", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.deploymentMode = "local";
    mocks.decryptOptionalSecret.mockReset();
    mocks.safeFetchJson.mockReset();
    mocks.decryptOptionalSecret.mockResolvedValue("b".repeat(64));
  });

  it("temporarily decrypts the token and returns only safe descriptors", async () => {
    mocks.safeFetchJson.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      data: {
        servers: [
          {
            id: "private-docs",
            label: "Private Docs",
            source: "bridge",
            transport: "streamable-http",
            endpoint: "/mcp/private-docs",
          },
        ],
      },
    });

    const { POST } =
      await import("../app/api/plugins/mcp-bridge/discover/route");
    const response = await POST(
      request({
        manifestUrl: "http://mcp-bridge:3400/servers",
        tokenSecret,
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      servers: [
        {
          id: "private-docs",
          label: "Private Docs",
          source: "bridge",
          transport: "streamable-http",
          serverUrl: "http://mcp-bridge:3400/mcp/private-docs",
        },
      ],
    });
    expect(mocks.decryptOptionalSecret).toHaveBeenCalledWith(
      tokenSecret,
      "mcp:bridge-discovery",
    );
    expect(mocks.safeFetchJson).toHaveBeenCalledWith(
      new URL("http://mcp-bridge:3400/servers"),
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: `Bearer ${"b".repeat(64)}` },
      }),
      expect.objectContaining({
        timeoutMs: 10_000,
        maxResponseBytes: 64 * 1024,
        policy: expect.objectContaining({ maxRedirects: 0 }),
      }),
    );
  });

  it("rejects command-bearing and cross-origin bridge descriptors", async () => {
    const { POST } =
      await import("../app/api/plugins/mcp-bridge/discover/route");

    mocks.safeFetchJson.mockResolvedValueOnce({
      response: new Response(null, { status: 200 }),
      data: {
        servers: [
          {
            id: "unsafe",
            label: "Unsafe",
            source: "bridge",
            transport: "streamable-http",
            endpoint: "/mcp/unsafe",
            command: "sh",
          },
        ],
      },
    });
    const commandResponse = await POST(
      request({
        manifestUrl: "http://mcp-bridge:3400/servers",
        tokenSecret,
      }),
    );
    expect(commandResponse.status).toBe(502);

    mocks.safeFetchJson.mockResolvedValueOnce({
      response: new Response(null, { status: 200 }),
      data: {
        servers: [
          {
            id: "cross-origin",
            label: "Cross origin",
            source: "bridge",
            transport: "streamable-http",
            endpoint: "https://evil.example/mcp",
          },
        ],
      },
    });
    const originResponse = await POST(
      request({
        manifestUrl: "http://mcp-bridge:3400/servers",
        tokenSecret,
      }),
    );
    expect(originResponse.status).toBe(502);
  });

  it("is unavailable in hosted mode and requires an encrypted token", async () => {
    const { POST } =
      await import("../app/api/plugins/mcp-bridge/discover/route");
    mocks.deploymentMode = "hosted";
    const hostedResponse = await POST(
      request({
        manifestUrl: "http://mcp-bridge:3400/servers",
        tokenSecret,
      }),
    );
    expect(hostedResponse.status).toBe(404);
    expect(mocks.decryptOptionalSecret).not.toHaveBeenCalled();
    expect(mocks.safeFetchJson).not.toHaveBeenCalled();

    mocks.deploymentMode = "local";
    const plaintextResponse = await POST(
      request({
        manifestUrl: "http://mcp-bridge:3400/servers",
        token: "plaintext-token",
      }),
    );
    expect(plaintextResponse.status).toBe(400);
    expect(mocks.decryptOptionalSecret).not.toHaveBeenCalled();
  });
});
