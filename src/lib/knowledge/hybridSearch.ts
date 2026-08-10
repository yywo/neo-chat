import type { Collection, Source } from "@/types";
import type {
  GlobalSearchDocument,
  GlobalSearchIndex,
} from "@/lib/global-search/types";
import { searchGlobalIndex } from "@/lib/global-search/search";
import { buildKnowledgeVectorItems } from "@/lib/utils/knowledgeVectors";

export interface KnowledgeLexicalIndex {
  searchIndex: GlobalSearchIndex;
  sources: Map<string, Source>;
}

function sourceKey(source: Source): string {
  const metadata = source.metadata || {};
  const collectionId = String(metadata.collectionId || "");
  const fileId = String(metadata.fileId || "");
  const chunkIndex = String(metadata.chunkIndex ?? "");
  if (collectionId || fileId || chunkIndex) {
    return `${collectionId}:${fileId}:${chunkIndex}`;
  }
  return `${source.title}:${source.content.slice(0, 240)}`;
}

function hashSourceKey(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export async function buildKnowledgeLexicalIndex({
  collections,
  collectionIds,
  fileIdsByCollectionId = new Map(),
  readContent,
  signal,
}: {
  collections: readonly Collection[];
  collectionIds: ReadonlySet<string>;
  fileIdsByCollectionId?: ReadonlyMap<string, ReadonlySet<string>>;
  readContent: (
    collection: Collection,
    file: Collection["files"][number],
    signal?: AbortSignal,
  ) => Promise<string | null>;
  signal?: AbortSignal;
}): Promise<KnowledgeLexicalIndex> {
  const documents: GlobalSearchDocument[] = [];
  const sources = new Map<string, Source>();

  for (const collection of collections) {
    const selectedFiles = fileIdsByCollectionId.get(collection.id);
    if (!collectionIds.has(collection.id) && !selectedFiles?.size) continue;
    for (const file of collection.files) {
      signal?.throwIfAborted();
      if (
        !collectionIds.has(collection.id) &&
        !selectedFiles?.has(file.id) &&
        !selectedFiles?.has(file.ragId || "")
      ) {
        continue;
      }
      const content = await readContent(collection, file, signal);
      if (!content?.trim()) continue;
      const chunks = buildKnowledgeVectorItems({
        collectionId: collection.id,
        fileName: file.name,
        ragFileId: file.ragId || file.id,
        textContent: content,
        chunking: collection.chunking,
        chunkingRevision: collection.chunkingRevision,
      });
      for (const chunk of chunks) {
        const headingPath = chunk.metadata.headingPath || [];
        const identity = `${collection.id}:${file.id}:${chunk.metadata.chunkIndex}:${chunk.data}`;
        const id = `knowledge:${hashSourceKey(identity)}`;
        const source: Source = {
          title:
            headingPath.length > 0
              ? `${file.name} · ${headingPath.join(" › ")}`
              : file.name,
          url: "",
          content: chunk.data,
          metadata: {
            ...chunk.metadata,
            id,
            kind: "knowledge",
            localFileId: file.id,
            retrieval: "keyword",
          },
        };
        sources.set(id, source);
        documents.push({
          id,
          source: "knowledge",
          title: source.title,
          content: source.content,
          keywords: [collection.name, file.name, ...headingPath],
          updatedAt: Math.max(collection.updatedAt, file.uploadedAt),
          target: {
            type: "knowledge",
            collectionId: collection.id,
            fileId: file.id,
          },
        });
      }
    }
  }

  return {
    searchIndex: {
      documents,
      builtAt: Date.now(),
      partial: false,
      errors: [],
      stats: {
        documents: documents.length,
        sessions: 0,
        messages: 0,
        knowledgeFiles: new Set(
          documents.map((document) =>
            document.target.type === "knowledge"
              ? `${document.target.collectionId}:${document.target.fileId}`
              : "",
          ),
        ).size,
        workspaces: 0,
        memories: 0,
        indexedContentChars: documents.reduce(
          (total, document) => total + document.content.length,
          0,
        ),
      },
    },
    sources,
  };
}

export function searchKnowledgeLexicalIndex(
  index: KnowledgeLexicalIndex,
  query: string,
  limit: number,
): Source[] {
  return searchGlobalIndex(index.searchIndex, query, {
    filters: { sources: ["knowledge"] },
    limit,
  })
    .map((result) => index.sources.get(result.document.id))
    .filter((source): source is Source => Boolean(source));
}

export function reciprocalRankFuseKnowledgeSources({
  vector,
  keyword,
  limit,
  rankConstant = 60,
}: {
  vector: readonly Source[];
  keyword: readonly Source[];
  limit: number;
  rankConstant?: number;
}): Source[] {
  const entries = new Map<
    string,
    { score: number; source: Source; kinds: Set<string> }
  >();
  for (const [kind, sources] of [
    ["vector", vector],
    ["keyword", keyword],
  ] as const) {
    const seen = new Set<string>();
    sources.forEach((source, index) => {
      const key = sourceKey(source);
      if (seen.has(key)) return;
      seen.add(key);
      const current = entries.get(key) || {
        score: 0,
        source,
        kinds: new Set<string>(),
      };
      current.score += 1 / (rankConstant + index + 1);
      current.kinds.add(kind);
      if (kind === "vector") current.source = source;
      entries.set(key, current);
    });
  }

  return [...entries.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(0, limit))
    .map(({ source, kinds }) => ({
      ...source,
      metadata: {
        ...(source.metadata || {}),
        retrieval: kinds.size > 1 ? "both" : [...kinds][0],
      },
    }));
}
