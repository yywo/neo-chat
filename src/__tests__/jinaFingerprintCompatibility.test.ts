import { afterEach, describe, expect, it, vi } from "vitest";

import { JINA_READER_PLUGIN } from "../config/plugins";
import { createPluginFunctionFingerprint } from "../lib/plugin/confirmation";

const safeFetchTextMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/security/safeFetch", () => ({
  safeFetchText: safeFetchTextMock,
}));
vi.mock("@/lib/byok/server", () => ({
  decryptOptionalSecret: vi.fn(),
}));

describe("Jina fingerprint compatibility", () => {
  afterEach(() => {
    safeFetchTextMock.mockReset();
  });

  it("executes a Jina call confirmed with a fallback fingerprint", async () => {
    const expectedFingerprint = await createPluginFunctionFingerprint(
      JINA_READER_PLUGIN,
      JINA_READER_PLUGIN.functions[0],
      true,
    );
    safeFetchTextMock.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      text: JSON.stringify({
        code: 200,
        data: { content: "# Baidu" },
      }),
    });

    const { POST } = await import("../app/api/plugins/execute/route");
    const response = await POST(
      new Request("http://localhost/api/plugins/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pluginId: JINA_READER_PLUGIN.id,
          functionName: "read_webpage",
          expectedFingerprint,
          args: { url: "https://baidu.com/" },
        }),
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: "# Baidu" });
  });
});
