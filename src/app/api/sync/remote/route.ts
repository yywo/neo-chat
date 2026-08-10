import { NextRequest, NextResponse } from "next/server";
import {
  createApiErrorResponse,
  readJsonRequestBody,
} from "@/lib/api/middleware";
import { decryptSecretEnvelope } from "@/lib/byok/server";
import { BYOK_CONTEXTS } from "@/lib/byok/shared";
import {
  parseSyncProviderCredentials,
  runS3Operation,
  runWebDavOperation,
} from "@/lib/sync/remoteAdapters";
import { SyncRemoteRequestSchema } from "@/lib/sync/remoteSchema";
import { safeServerLogError } from "@/lib/utils/safeServerLog";

export async function POST(request: NextRequest) {
  try {
    const body = SyncRemoteRequestSchema.parse(
      await readJsonRequestBody(request),
    );
    const plaintext = await decryptSecretEnvelope(
      body.credentialSecret,
      BYOK_CONTEXTS.syncRemote,
    );
    const credentials = parseSyncProviderCredentials(body.provider, plaintext);
    const result =
      body.provider.kind === "webdav" && credentials.kind === "webdav"
        ? await runWebDavOperation(body, credentials)
        : body.provider.kind === "s3" && credentials.kind === "s3"
          ? await runS3Operation(body, credentials)
          : (() => {
              throw new Error(
                "Remote sync credentials do not match the provider.",
              );
            })();
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    safeServerLogError("Encrypted sync proxy error:", error);
    return createApiErrorResponse(error, "Encrypted sync request failed");
  }
}
