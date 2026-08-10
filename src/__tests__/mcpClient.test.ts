import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("MCP client transport safety", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("allows HTTPS MCP servers on private network addresses", async () => {
    const fetchMock = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const { createSafeMcpFetch } = await import("../lib/mcp/client");
    const safeFetch = createSafeMcpFetch({ maxResponseBytes: 64 });
    const response = await safeFetch("https://192.168.1.10/mcp");

    await expect(response.text()).resolves.toBe("ok");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://192.168.1.10/mcp",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("allows plain HTTP for private MCP servers", async () => {
    const fetchMock = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const { createSafeMcpFetch } = await import("../lib/mcp/client");
    const safeFetch = createSafeMcpFetch();

    await expect(
      (await safeFetch("http://192.168.1.10/mcp")).text(),
    ).resolves.toBe("ok");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://192.168.1.10/mcp",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("follows validated MCP redirects manually", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 307,
          headers: { location: "/mcp/" },
        }),
      )
      .mockResolvedValueOnce(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const { createSafeMcpFetch } = await import("../lib/mcp/client");
    const safeFetch = createSafeMcpFetch();
    const response = await safeFetch("https://93.184.216.34/mcp");

    await expect(response.text()).resolves.toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://93.184.216.34/mcp/",
    );
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("allows MCP redirects from HTTPS to a configured HTTP target", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "http://93.184.216.34/mcp" },
        }),
      )
      .mockResolvedValueOnce(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const { createSafeMcpFetch } = await import("../lib/mcp/client");
    const safeFetch = createSafeMcpFetch();

    const response = await safeFetch("https://93.184.216.34/mcp");

    await expect(response.text()).resolves.toBe("ok");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://93.184.216.34/mcp",
      expect.objectContaining({ redirect: "manual" }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "http://93.184.216.34/mcp",
    );
  });

  it("limits MCP response bodies before the SDK parses them", async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode("012345"));
              controller.enqueue(encoder.encode("6789"));
              controller.close();
            },
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { createSafeMcpFetch } = await import("../lib/mcp/client");
    const safeFetch = createSafeMcpFetch({ maxResponseBytes: 8 });
    const response = await safeFetch("https://93.184.216.34/mcp");

    await expect(response.text()).rejects.toThrow(/too large/i);
  });

  it("falls back to legacy SSE after a streamable HTTP 405", async () => {
    const encoder = new TextEncoder();
    let sseController:
      ReadableStreamDefaultController<Uint8Array<ArrayBufferLike>> | undefined;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" || input instanceof URL ? input : input.url,
        );
        const method = String(init?.method || "GET").toUpperCase();

        if (url.pathname === "/sse" && method === "POST") {
          return new Response("Cannot POST /sse", { status: 405 });
        }

        if (url.pathname === "/sse" && method === "GET") {
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              sseController = controller;
              controller.enqueue(
                encoder.encode("event: endpoint\ndata: /messages\n\n"),
              );
            },
          });
          return new Response(stream, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          });
        }

        if (url.pathname === "/messages" && method === "POST") {
          const message = JSON.parse(String(init?.body || "{}"));
          if (message.method === "initialize") {
            sseController?.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  jsonrpc: "2.0",
                  id: message.id,
                  result: {
                    protocolVersion: "2025-11-25",
                    capabilities: { tools: {} },
                    serverInfo: { name: "legacy-sse", version: "1.0.0" },
                  },
                })}\n\n`,
              ),
            );
          } else if (message.method === "tools/list") {
            sseController?.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  jsonrpc: "2.0",
                  id: message.id,
                  result: {
                    tools: [
                      {
                        name: "legacy-search",
                        description: "Search a legacy MCP server.",
                        inputSchema: { type: "object", properties: {} },
                      },
                    ],
                  },
                })}\n\n`,
              ),
            );
          }
          return new Response(null, { status: 202 });
        }

        return new Response("Not found", { status: 404 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { discoverMcpTools } = await import("../lib/mcp/client");
    const result = await discoverMcpTools({
      serverUrl: "https://93.184.216.34/sse",
      timeoutMs: 5_000,
    });

    expect(result).toMatchObject({
      transport: "sse",
      tools: [{ name: "legacy-search" }],
    });
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          new URL(
            typeof input === "string" || input instanceof URL
              ? input
              : input.url,
          ).pathname === "/sse" &&
          String(init?.method || "GET").toUpperCase() === "GET",
      ),
    ).toBe(true);
  });

  it("does not fall back to SSE after an authentication failure", async () => {
    const fetchMock = vi.fn(
      async () => new Response("Authentication required", { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { discoverMcpTools } = await import("../lib/mcp/client");

    await expect(
      discoverMcpTools({
        serverUrl: "https://93.184.216.34/mcp",
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow(/401|authentication/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
