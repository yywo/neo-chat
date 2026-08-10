import type { KnowledgeFile } from "./types";

export type KnowledgeFileStatusFilter =
  "all" | "ready" | "processing" | "error";

export interface KnowledgeFileBatchResult {
  fileId: string;
  fileName: string;
  status: "succeeded" | "failed";
  error?: string;
}

export function getKnowledgeFileStatusFilter(
  file: KnowledgeFile,
): Exclude<KnowledgeFileStatusFilter, "all"> {
  if (
    file.storageStatus === "error" ||
    file.indexStatus === "error" ||
    file.status === "error"
  ) {
    return "error";
  }
  if (
    file.storageStatus === "uploading" ||
    file.storageStatus === "parsing" ||
    file.indexStatus === "indexing" ||
    file.status === "uploading" ||
    file.status === "parsing" ||
    file.status === "indexing"
  ) {
    return "processing";
  }
  return "ready";
}

export function filterKnowledgeFiles(
  files: KnowledgeFile[],
  query: string,
  status: KnowledgeFileStatusFilter,
): KnowledgeFile[] {
  const normalizedQuery = query.trim().toLowerCase();
  return files.filter(
    (file) =>
      (!normalizedQuery || file.name.toLowerCase().includes(normalizedQuery)) &&
      (status === "all" || getKnowledgeFileStatusFilter(file) === status),
  );
}

export async function runKnowledgeFileBatch(
  files: KnowledgeFile[],
  operation: (file: KnowledgeFile) => Promise<void>,
  onProgress?: (results: KnowledgeFileBatchResult[]) => void,
): Promise<KnowledgeFileBatchResult[]> {
  const results: KnowledgeFileBatchResult[] = [];

  for (const file of files) {
    try {
      await operation(file);
      results.push({
        fileId: file.id,
        fileName: file.name,
        status: "succeeded",
      });
    } catch (error) {
      results.push({
        fileId: file.id,
        fileName: file.name,
        status: "failed",
        error:
          error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : undefined,
      });
    }
    onProgress?.([...results]);
  }

  return results;
}
