import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createApiErrorResponse,
  readJsonRequestBody,
} from "@/lib/api/middleware";
import { McpBridgeDiscoveryRequestSchema } from "@/lib/api/schemas";
import { decryptOptionalSecret } from "@/lib/byok/server";
import { BYOK_CONTEXTS } from "@/lib/byok/shared";
import { ApiError, AuthenticationError, ValidationError } from "@/lib/errors";
import { getDeploymentMode } from "@/lib/security/deployment";
import { safeFetchJson } from "@/lib/security/safeFetch";
import { getSafeUrlPolicy } from "@/lib/security/urlPolicy";
import { safeServerLogError } from "@/lib/utils/safeServerLog";

const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
const BRIDGE_TIMEOUT_MS = 10_000;
const SERVER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

const BridgeManifestSchema = z
  .object({
    servers: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64).regex(SERVER_ID_PATTERN),
            label: z.string().min(1).max(128),
            source: z.literal("bridge"),
            transport: z.literal("streamable-http"),
            endpoint: z.string().min(1).max(2_048),
          })
          .strict(),
      )
      .max(32),
  })
  .strict();

function parseManifestUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ValidationError("Bridge manifest URL must be a valid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ValidationError("Bridge manifest URL must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw new ValidationError(
      "Bridge manifest URL must not contain credentials",
    );
  }
  return url;
}

function parseBridgeManifest(value: unknown, manifestUrl: URL) {
  const parsed = BridgeManifestSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(
      "MCP bridge returned an invalid server manifest",
      502,
      "INVALID_BRIDGE_MANIFEST",
    );
  }

  const seenIds = new Set<string>();
  const servers = parsed.data.servers.map((server) => {
    if (seenIds.has(server.id)) {
      throw new ApiError(
        "MCP bridge returned duplicate server identifiers",
        502,
        "INVALID_BRIDGE_MANIFEST",
      );
    }
    seenIds.add(server.id);

    let endpoint: URL;
    try {
      endpoint = new URL(server.endpoint, manifestUrl);
    } catch {
      throw new ApiError(
        "MCP bridge returned an invalid server endpoint",
        502,
        "INVALID_BRIDGE_MANIFEST",
      );
    }
    if (
      endpoint.origin !== manifestUrl.origin ||
      (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") ||
      endpoint.username ||
      endpoint.password
    ) {
      throw new ApiError(
        "MCP bridge endpoint must use the manifest origin",
        502,
        "INVALID_BRIDGE_MANIFEST",
      );
    }

    return {
      id: server.id,
      label: server.label,
      source: "bridge" as const,
      transport: "streamable-http" as const,
      serverUrl: endpoint.toString(),
    };
  });

  return { servers };
}

export async function POST(request: Request) {
  try {
    if (getDeploymentMode() !== "local") {
      throw new ApiError(
        "MCP bridge discovery is available only in local deployments",
        404,
        "BRIDGE_LOCAL_ONLY",
      );
    }

    const body = McpBridgeDiscoveryRequestSchema.parse(
      await readJsonRequestBody(request, MAX_REQUEST_BYTES),
    );
    const manifestUrl = parseManifestUrl(body.manifestUrl);
    const token = await decryptOptionalSecret(
      body.tokenSecret,
      BYOK_CONTEXTS.bridgeDiscovery,
    );
    if (
      !token ||
      token.length < 32 ||
      token.length > 4096 ||
      /\s/.test(token)
    ) {
      throw new AuthenticationError("Invalid MCP bridge bearer token");
    }

    const { response, data } = await safeFetchJson<unknown>(
      manifestUrl,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        signal: request.signal,
      },
      {
        policy: { ...getSafeUrlPolicy("mcp"), maxRedirects: 0 },
        timeoutMs: BRIDGE_TIMEOUT_MS,
        maxResponseBytes: MAX_MANIFEST_BYTES,
      },
    );
    if (!response.ok) {
      throw new ApiError(
        response.status === 401 || response.status === 403
          ? "MCP bridge rejected the bearer token"
          : "MCP bridge discovery request failed",
        response.status === 401 || response.status === 403 ? 401 : 502,
        "BRIDGE_DISCOVERY_FAILED",
      );
    }

    return NextResponse.json(parseBridgeManifest(data, manifestUrl), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (
      request.signal.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      return new Response(null, { status: 499 });
    }
    safeServerLogError("MCP bridge discovery failed", error);
    return createApiErrorResponse(error, "MCP bridge discovery failed");
  }
}
