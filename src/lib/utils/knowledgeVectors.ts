import {
  SimpleRecursiveSplitter,
  splitMarkdownWithHeadings,
} from "@/utils/textSplitter";
import type { KnowledgeChunkingConfig } from "@/types";

export interface KnowledgeVectorItem {
  id: string;
  data: string;
  metadata: {
    fileId: string;
    fileName: string;
    collectionId: string;
    chunkIndex: number;
    headingPath?: string[];
    chunkingRevision: string;
    retrieval: "vector" | "keyword" | "both";
  };
}

interface BuildKnowledgeVectorItemsOptions {
  collectionId: string;
  fileName: string;
  ragFileId: string;
  textContent: string;
  chunking: KnowledgeChunkingConfig;
  chunkingRevision: string;
}

export function buildKnowledgeVectorItems({
  collectionId,
  fileName,
  ragFileId,
  textContent,
  chunking,
  chunkingRevision,
}: BuildKnowledgeVectorItemsOptions): KnowledgeVectorItem[] {
  const chunkOverlap = Math.floor(
    chunking.chunkSize * (chunking.overlapPercent / 100),
  );
  const useMarkdown =
    chunking.strategy === "markdown" ||
    (chunking.strategy === "auto" &&
      (/\.md(?:own)?$/i.test(fileName) || /^#{1,6}\s/m.test(textContent)));
  const chunks = useMarkdown
    ? splitMarkdownWithHeadings({
        text: textContent,
        chunkSize: chunking.chunkSize,
        chunkOverlap,
      })
    : new SimpleRecursiveSplitter({
        chunkSize: chunking.chunkSize,
        chunkOverlap,
      })
        .splitText(textContent)
        .map((text) => ({ text, headingPath: [] as string[] }));

  return chunks.map((chunk, index) => ({
    id: `${ragFileId}_${index}`,
    data: chunk.text,
    metadata: {
      fileId: ragFileId,
      fileName,
      collectionId,
      chunkIndex: index,
      ...(chunk.headingPath.length > 0
        ? { headingPath: chunk.headingPath }
        : {}),
      chunkingRevision,
      retrieval: "vector",
    },
  }));
}

export function previewKnowledgeChunks(
  options: BuildKnowledgeVectorItemsOptions,
  limit = 3,
): KnowledgeVectorItem[] {
  return buildKnowledgeVectorItems(options).slice(0, Math.max(0, limit));
}

export function buildKnowledgeVectorIds(
  ragId: string,
  chunkCount: number,
): string[] {
  if (chunkCount <= 0) return [];

  return Array.from({ length: chunkCount }, (_, index) => `${ragId}_${index}`);
}
