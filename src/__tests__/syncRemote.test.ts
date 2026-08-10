import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  safeFetch: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/security/safeFetch", () => ({
  safeFetch: mocks.safeFetch,
}));

import {
  parseSyncProviderCredentials,
  runS3Operation,
  runWebDavOperation,
} from "@/lib/sync/remoteAdapters";
import { SyncRemoteRequestSchema } from "@/lib/sync/remoteSchema";
import { BYOK_ALG } from "@/lib/byok/shared";

const encryptedCredential = {
  v: 1 as const,
  kid: "kid",
  alg: BYOK_ALG,
  iv: "a",
  wrappedKey: "b",
  ciphertext: "c",
  context: "sync:remote-credentials",
};

describe("remote encrypted sync adapters", () => {
  beforeEach(() => {
    mocks.safeFetch.mockReset();
  });

  it("rejects unsafe paths and plaintext credential fields", () => {
    expect(() =>
      SyncRemoteRequestSchema.parse({
        operation: "get",
        provider: {
          kind: "webdav",
          baseUrl: "https://dav.example.com",
          rootPath: "sync",
        },
        credentialSecret: encryptedCredential,
        path: "../secret",
      }),
    ).toThrow();
    expect(() =>
      SyncRemoteRequestSchema.parse({
        operation: "test",
        provider: {
          kind: "webdav",
          baseUrl: "https://dav.example.com",
          rootPath: "sync",
        },
        credentialSecret: encryptedCredential,
        password: "plaintext",
      }),
    ).toThrow();
  });

  it("keeps WebDAV credentials in an Authorization header and creates parent collections", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, {
        status: init?.method === "PUT" ? 201 : 405,
        headers: { ETag: '"etag"' },
      });
    });
    await runWebDavOperation(
      {
        operation: "put",
        provider: {
          kind: "webdav",
          baseUrl: "https://dav.example.com/home",
          rootPath: "neo-chat",
        },
        credentialSecret: encryptedCredential,
        path: "docs/one/object.json",
        body: "aGVsbG8",
      },
      { kind: "webdav", username: "alice", password: "secret" },
      fetcher,
    );

    expect(calls.map((call) => call.init?.method)).toEqual([
      "MKCOL",
      "MKCOL",
      "MKCOL",
      "PUT",
    ]);
    expect(calls.every((call) => !call.url.includes("alice"))).toBe(true);
    expect(
      new Headers(calls.at(-1)?.init?.headers).get("authorization"),
    ).toMatch(/^Basic /);
  });

  it.each([302, 400, 429])(
    "rejects WebDAV connection-test HTTP %s responses",
    async (status) => {
      const fetcher = vi.fn(async () => new Response(null, { status }));

      await expect(
        runWebDavOperation(
          {
            operation: "test",
            provider: {
              kind: "webdav",
              baseUrl: "https://dav.example.com/home",
              rootPath: "neo-chat",
            },
            credentialSecret: encryptedCredential,
          },
          { kind: "webdav", username: "alice", password: "secret" },
          fetcher,
        ),
      ).rejects.toThrow(`HTTP ${status}`);
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  it("uses a read-only WebDAV probe when HEAD is unsupported", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, {
        status: init?.method === "HEAD" ? 405 : 207,
      });
    });

    await expect(
      runWebDavOperation(
        {
          operation: "test",
          provider: {
            kind: "webdav",
            baseUrl: "https://dav.example.com/home",
            rootPath: "neo-chat",
          },
          credentialSecret: encryptedCredential,
        },
        { kind: "webdav", username: "alice", password: "secret" },
        fetcher,
      ),
    ).resolves.toEqual({ ok: true });
    expect(calls.map((call) => call.init?.method)).toEqual([
      "HEAD",
      "PROPFIND",
    ]);
    expect(calls[1].url).toBe("https://dav.example.com/home");
    expect(new Headers(calls[1].init?.headers).get("depth")).toBe("0");
  });

  it("validates credentials against the selected provider", () => {
    expect(
      parseSyncProviderCredentials(
        {
          kind: "s3",
          endpoint: "https://s3.example.com",
          region: "us-east-1",
          bucket: "vault",
          prefix: "sync",
          forcePathStyle: true,
        },
        JSON.stringify({
          kind: "s3",
          accessKeyId: "key",
          secretAccessKey: "secret",
        }),
      ),
    ).toMatchObject({ kind: "s3", accessKeyId: "key" });
  });

  it("does not parse S3 KeyCount as an object key", async () => {
    mocks.safeFetch.mockResolvedValue(
      new Response(
        '<?xml version="1.0"?><ListBucketResult>' +
          "<KeyCount>1</KeyCount><MaxKeys>1000</MaxKeys>" +
          "<Contents><Key>neo-chat/objects/object.bin</Key></Contents>" +
          "</ListBucketResult>",
        { status: 200, headers: { "content-type": "application/xml" } },
      ),
    );

    await expect(
      runS3Operation(
        {
          operation: "list",
          provider: {
            kind: "s3",
            endpoint: "https://s3.example.com",
            region: "us-east-1",
            bucket: "vault",
            prefix: "neo-chat",
            forcePathStyle: true,
          },
          credentialSecret: encryptedCredential,
          path: "objects",
        },
        {
          kind: "s3",
          accessKeyId: "key",
          secretAccessKey: "secret",
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      objects: [{ path: "objects/object.bin" }],
    });
  });
});
