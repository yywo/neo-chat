import {
  collectOrphanOpfsUrls,
  collectReferencedOpfsUrls,
  createBrowserAppExportPayload,
  isAppOwnedOpfsUrl,
} from "@/lib/data/appExport";
import { listOPFSDirectory } from "@/utils/opfs";
import { toOPFSUrl } from "@/utils/opfsReconcile";

const APP_OPFS_DIRECTORIES = [
  "knowledge-base",
  "workspaces",
  "images",
  "chat",
] as const;

export interface LocalStorageHealthSnapshot {
  quota: {
    usage: number;
    quota: number;
  } | null;
  opfs: {
    referencedCount: number;
    storedCount: number;
    orphanCount: number;
    missingCount: number;
  } | null;
}

export function summarizeLocalOpfsHealth({
  data,
  existingPaths,
}: {
  data: unknown;
  existingPaths: Iterable<string>;
}): NonNullable<LocalStorageHealthSnapshot["opfs"]> {
  const existingUrls = [...existingPaths].map(toOPFSUrl);
  const referencedUrls = collectReferencedOpfsUrls({ data });
  const appReferencedUrls = [...referencedUrls].filter(isAppOwnedOpfsUrl);
  const existingUrlSet = new Set(existingUrls);

  return {
    referencedCount: appReferencedUrls.length,
    storedCount: existingUrls.length,
    orphanCount: collectOrphanOpfsUrls({
      existingUrls,
      referencedUrls: appReferencedUrls,
    }).length,
    missingCount: appReferencedUrls.filter((url) => !existingUrlSet.has(url))
      .length,
  };
}

export async function inspectLocalStorageHealth(): Promise<LocalStorageHealthSnapshot> {
  const quotaPromise = Promise.resolve().then(() =>
    typeof navigator !== "undefined" && navigator.storage?.estimate
      ? navigator.storage.estimate()
      : null,
  );
  const opfsPromise = Promise.all([
    createBrowserAppExportPayload({ flushMessageWrites: false }),
    Promise.all(
      APP_OPFS_DIRECTORIES.map((directory) => listOPFSDirectory(directory)),
    ),
  ]);

  const [quotaResult, opfsResult] = await Promise.allSettled([
    quotaPromise,
    opfsPromise,
  ]);
  const estimate =
    quotaResult.status === "fulfilled" ? quotaResult.value : null;
  const quota =
    estimate &&
    typeof estimate.usage === "number" &&
    typeof estimate.quota === "number"
      ? { usage: estimate.usage, quota: estimate.quota }
      : null;
  const opfs =
    opfsResult.status === "fulfilled"
      ? summarizeLocalOpfsHealth({
          data: opfsResult.value[0].data,
          existingPaths: opfsResult.value[1].flat(),
        })
      : null;

  return { quota, opfs };
}
