import "server-only";

import { AwsClient } from "aws4fetch";
import { bytesToBase64Url } from "@/lib/byok/encoding";
import { safeFetch } from "@/lib/security/safeFetch";
import { getSafeUrlPolicy } from "@/lib/security/urlPolicy";
import type {
  SyncProviderConfig,
  SyncProviderCredentials,
  SyncRemoteObjectMetadata,
  SyncRemoteRequest,
  SyncRemoteResponse,
} from "./types";

const MAX_REMOTE_OBJECT_BYTES = 8 * 1024 * 1024;
const MAX_LIST_BYTES = 2 * 1024 * 1024;

type RemoteFetch = (url: string, init?: RequestInit) => Promise<Response>;

function syncFetch(maxResponseBytes: number): RemoteFetch {
  return (url, init) =>
    safeFetch(url, init, {
      policy: { ...getSafeUrlPolicy("sync"), maxRedirects: 0 },
      timeoutMs: 30_000,
      maxResponseBytes,
      enforceResponseLimits: true,
      signal: init?.signal ?? undefined,
    });
}

function normalizeRelativePath(value = ""): string {
  const normalized = value.replace(/^\/+|\/+$/g, "");
  if (
    normalized.includes("\\") ||
    normalized.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("Invalid remote sync path.");
  }
  return normalized;
}

function appendUrlPath(url: URL, ...parts: string[]): URL {
  const path = [url.pathname, ...parts]
    .map(normalizeRelativePath)
    .filter(Boolean)
    .flatMap((part) => part.split("/"))
    .map(encodeURIComponent)
    .join("/");
  url.pathname = `/${path}`;
  url.search = "";
  url.hash = "";
  return url;
}

function basicAuthorization(username: string, password: string): string {
  const value = `${username}:${password}`;
  const encoded =
    typeof Buffer !== "undefined"
      ? Buffer.from(value, "utf8").toString("base64")
      : btoa(unescape(encodeURIComponent(value)));
  return `Basic ${encoded}`;
}

function assertResponse(response: Response, operation: string): void {
  if (!response.ok) {
    throw new Error(`Remote ${operation} failed with HTTP ${response.status}.`);
  }
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function xmlValues(xml: string, localName: string): string[] {
  const escaped = localName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(
    `<(?:[A-Za-z0-9_-]+:)?${escaped}(?=\\s|>)[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?${escaped}\\s*>`,
    "gi",
  );
  return [...xml.matchAll(expression)].map((match) =>
    decodeXmlText(match[1].trim()),
  );
}

function webDavUrl(
  config: Extract<SyncProviderConfig, { kind: "webdav" }>,
  path = "",
): URL {
  return appendUrlPath(new URL(config.baseUrl), config.rootPath, path);
}

async function ensureWebDavDirectories(
  config: Extract<SyncProviderConfig, { kind: "webdav" }>,
  path: string,
  headers: Headers,
  fetcher: RemoteFetch,
): Promise<void> {
  const segments = [
    normalizeRelativePath(config.rootPath),
    normalizeRelativePath(path),
  ]
    .filter(Boolean)
    .join("/")
    .split("/")
    .slice(0, -1);
  let current = new URL(config.baseUrl);
  for (const segment of segments) {
    current = appendUrlPath(current, segment);
    const response = await fetcher(current.toString(), {
      method: "MKCOL",
      headers,
    });
    if (![200, 201, 204, 301, 405].includes(response.status)) {
      throw new Error(
        `WebDAV collection creation failed with HTTP ${response.status}.`,
      );
    }
    await response.body?.cancel();
  }
}

export async function runWebDavOperation(
  request: SyncRemoteRequest,
  credentials: Extract<SyncProviderCredentials, { kind: "webdav" }>,
  fetcher: RemoteFetch = syncFetch(MAX_REMOTE_OBJECT_BYTES),
): Promise<SyncRemoteResponse> {
  if (request.provider.kind !== "webdav")
    throw new Error("Expected WebDAV provider.");
  const headers = new Headers({
    Authorization: basicAuthorization(
      credentials.username,
      credentials.password,
    ),
  });
  const url = webDavUrl(request.provider, request.path);

  if (request.operation === "test") {
    const response = await fetcher(url.toString(), { method: "HEAD", headers });
    const headStatus = response.status;
    await response.body?.cancel();
    if (response.ok) return { ok: true };
    if (![404, 405, 501].includes(headStatus)) {
      throw new Error(`Remote connection test failed with HTTP ${headStatus}.`);
    }

    // Some WebDAV servers reject HEAD and a new vault folder may not exist
    // yet. Probe the configured WebDAV base itself with the protocol's
    // read-only Depth: 0 operation instead of treating arbitrary errors as a
    // successful credential test.
    const probeHeaders = new Headers(headers);
    probeHeaders.set("Depth", "0");
    const probeUrl = new URL(request.provider.baseUrl);
    probeUrl.search = "";
    probeUrl.hash = "";
    const probe = await fetcher(probeUrl.toString(), {
      method: "PROPFIND",
      headers: probeHeaders,
    });
    const probeStatus = probe.status;
    await probe.body?.cancel();
    if (!probe.ok) {
      throw new Error(
        `Remote connection test failed with HTTP ${probeStatus}.`,
      );
    }
    return { ok: true };
  }
  if (request.operation === "list") {
    headers.set("Depth", "1");
    const response = await fetcher(url.toString(), {
      method: "PROPFIND",
      headers,
    });
    if (response.status === 404) return { ok: true, objects: [] };
    assertResponse(response, "list");
    const xml = await response.text();
    const root = webDavUrl(request.provider).pathname.replace(/\/+$/, "");
    const requested = normalizeRelativePath(request.path);
    const objects: SyncRemoteObjectMetadata[] = [];
    for (const href of xmlValues(xml, "href")) {
      let pathname: string;
      try {
        pathname = new URL(href, url).pathname;
      } catch {
        continue;
      }
      if (!pathname.startsWith(`${root}/`)) continue;
      const relative = decodeURIComponent(
        pathname.slice(root.length + 1),
      ).replace(/\/+$/, "");
      if (!relative || relative === requested || relative.endsWith("/"))
        continue;
      objects.push({ path: relative });
    }
    return { ok: true, objects };
  }
  if (request.operation === "head") {
    const response = await fetcher(url.toString(), { method: "HEAD", headers });
    if (response.status === 404) return { ok: true, exists: false };
    assertResponse(response, "head");
    await response.body?.cancel();
    return {
      ok: true,
      exists: true,
      size: Number(response.headers.get("content-length")) || undefined,
      etag: response.headers.get("etag") || undefined,
      contentType: response.headers.get("content-type") || undefined,
    };
  }
  if (request.operation === "get") {
    const response = await fetcher(url.toString(), { method: "GET", headers });
    assertResponse(response, "get");
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      ok: true,
      body: bytesToBase64Url(bytes),
      size: bytes.byteLength,
      etag: response.headers.get("etag") || undefined,
      contentType: response.headers.get("content-type") || undefined,
    };
  }

  await ensureWebDavDirectories(
    request.provider,
    request.path || "",
    headers,
    fetcher,
  );
  headers.set(
    "Content-Type",
    request.contentType || "application/octet-stream",
  );
  const response = await fetcher(url.toString(), {
    method: "PUT",
    headers,
    body: request.body
      ? Buffer.from(
          request.body.replace(/-/g, "+").replace(/_/g, "/"),
          "base64",
        )
      : new Uint8Array(),
  });
  assertResponse(response, "put");
  await response.body?.cancel();
  return { ok: true, etag: response.headers.get("etag") || undefined };
}

function s3BaseUrl(config: Extract<SyncProviderConfig, { kind: "s3" }>): URL {
  const endpoint = new URL(config.endpoint);
  if (config.forcePathStyle) return appendUrlPath(endpoint, config.bucket);
  endpoint.hostname = `${config.bucket}.${endpoint.hostname}`;
  return endpoint;
}

function s3ObjectUrl(
  config: Extract<SyncProviderConfig, { kind: "s3" }>,
  path = "",
): URL {
  return appendUrlPath(s3BaseUrl(config), config.prefix, path);
}

async function signedS3Fetch(
  client: AwsClient,
  url: URL,
  init: RequestInit,
  maxResponseBytes: number,
): Promise<Response> {
  const signed = await client.sign(url, { ...init, redirect: "manual" });
  const body = init.body;
  return syncFetch(maxResponseBytes)(signed.url, {
    method: signed.method,
    headers: signed.headers,
    body,
    signal: init.signal,
  });
}

export async function runS3Operation(
  request: SyncRemoteRequest,
  credentials: Extract<SyncProviderCredentials, { kind: "s3" }>,
): Promise<SyncRemoteResponse> {
  if (request.provider.kind !== "s3") throw new Error("Expected S3 provider.");
  const client = new AwsClient({
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    sessionToken: credentials.sessionToken,
    service: "s3",
    region: request.provider.region,
    retries: 0,
  });

  if (request.operation === "list") {
    const url = s3BaseUrl(request.provider);
    url.searchParams.set("list-type", "2");
    const prefix = [
      normalizeRelativePath(request.provider.prefix),
      normalizeRelativePath(request.path),
    ]
      .filter(Boolean)
      .join("/");
    if (prefix)
      url.searchParams.set("prefix", `${prefix.replace(/\/+$/, "")}/`);
    if (request.cursor)
      url.searchParams.set("continuation-token", request.cursor);
    const response = await signedS3Fetch(
      client,
      url,
      { method: "GET" },
      MAX_LIST_BYTES,
    );
    assertResponse(response, "list");
    const xml = await response.text();
    const configuredPrefix = normalizeRelativePath(request.provider.prefix);
    const stripLength = configuredPrefix ? configuredPrefix.length + 1 : 0;
    const objects = xmlValues(xml, "Key").map((key) => ({
      path: key.slice(stripLength),
    }));
    return {
      ok: true,
      objects,
      cursor: xmlValues(xml, "NextContinuationToken")[0],
    };
  }

  const url =
    request.operation === "test"
      ? s3BaseUrl(request.provider)
      : s3ObjectUrl(request.provider, request.path);
  const method =
    request.operation === "put"
      ? "PUT"
      : request.operation === "get"
        ? "GET"
        : "HEAD";
  const body =
    request.operation === "put"
      ? Buffer.from(
          (request.body || "").replace(/-/g, "+").replace(/_/g, "/"),
          "base64",
        )
      : undefined;
  const response = await signedS3Fetch(
    client,
    url,
    {
      method,
      headers:
        request.operation === "put"
          ? {
              "Content-Type": request.contentType || "application/octet-stream",
            }
          : undefined,
      body,
    },
    MAX_REMOTE_OBJECT_BYTES,
  );
  if (request.operation === "head" && response.status === 404) {
    return { ok: true, exists: false };
  }
  assertResponse(response, request.operation);
  if (request.operation === "get") {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      ok: true,
      body: bytesToBase64Url(bytes),
      size: bytes.byteLength,
      etag: response.headers.get("etag") || undefined,
      contentType: response.headers.get("content-type") || undefined,
    };
  }
  await response.body?.cancel();
  return {
    ok: true,
    exists: request.operation === "head" ? true : undefined,
    size: Number(response.headers.get("content-length")) || undefined,
    etag: response.headers.get("etag") || undefined,
  };
}

export function parseSyncProviderCredentials(
  provider: SyncProviderConfig,
  plaintext: string,
): SyncProviderCredentials {
  let value: unknown;
  try {
    value = JSON.parse(plaintext);
  } catch {
    throw new Error("Remote sync credentials are invalid.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Remote sync credentials are invalid.");
  }
  const record = value as Record<string, unknown>;
  if (
    provider.kind === "webdav" &&
    record.kind === "webdav" &&
    typeof record.username === "string" &&
    typeof record.password === "string" &&
    record.username.length <= 1_024 &&
    record.password.length <= 16_384
  ) {
    return {
      kind: "webdav",
      username: record.username,
      password: record.password,
    };
  }
  if (
    provider.kind === "s3" &&
    record.kind === "s3" &&
    typeof record.accessKeyId === "string" &&
    record.accessKeyId.length > 0 &&
    record.accessKeyId.length <= 1_024 &&
    typeof record.secretAccessKey === "string" &&
    record.secretAccessKey.length > 0 &&
    record.secretAccessKey.length <= 16_384 &&
    (record.sessionToken === undefined ||
      (typeof record.sessionToken === "string" &&
        record.sessionToken.length <= 16_384))
  ) {
    return {
      kind: "s3",
      accessKeyId: record.accessKeyId,
      secretAccessKey: record.secretAccessKey,
      sessionToken: record.sessionToken as string | undefined,
    };
  }
  throw new Error(
    "Remote sync credentials do not match the selected provider.",
  );
}
