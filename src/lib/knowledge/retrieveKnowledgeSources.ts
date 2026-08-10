import type { Attachment, Collection, KnowledgeFile, Source } from "@/types";
import { GLOBAL_SEARCH_LIMITS } from "@/config/limits";
import { readPersistedKnowledgeContent } from "@/lib/global-search/browserAdapter";
import {
  buildKnowledgeLexicalIndex,
  reciprocalRankFuseKnowledgeSources,
  searchKnowledgeLexicalIndex,
  type KnowledgeLexicalIndex,
} from "@/lib/knowledge/hybridSearch";
import { hasRagVectorStore } from "@/lib/security/localSecretResolvers";
import {
  isKnowledgeCollectionAttachment,
  isKnowledgeFileAttachment,
  parseKnowledgeFileAttachmentData,
} from "@/lib/utils/knowledgeAttachments";
import { mapSettledWithConcurrency } from "@/lib/utils/concurrency";
import { logDevError } from "@/lib/utils/devLogger";
import { queryRAG } from "@/services/api/ragService";

const RAG_QUERY_CONCURRENCY = 4;
const DEFAULT_TOP_K = 10;
const MAX_TOP_K = 50;

export interface RagQueryError {
  message: string;
  code: "RAG_QUERY_FAILED" | "RAG_VECTOR_FALLBACK";
}

export interface KnowledgeRetrievalRagConfig {
  enabled: boolean;
  url?: string;
  token?: string;
  tokenSecret?: unknown;
  useDefaultVectorStore?: boolean;
  serverVectorStoreAvailable?: boolean;
  topK?: number;
}

export type KnowledgeLexicalIndexCache = Map<
  string,
  Promise<KnowledgeLexicalIndex | null>
>;

interface SelectedKnowledgeScope {
  selectedCollectionIds: Set<string>;
  lexicalFileIdsByCollectionId: Map<string, Set<string>>;
  vectorFileIdsByCollectionId: Map<string, Set<string>>;
  vectorCollectionIds: Set<string>;
}

function getSourceMetadataString(source: Source, key: string): string {
  const value = source.metadata?.[key];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function getCollectionFile(
  attachment: Attachment,
  collectionsById: ReadonlyMap<string, Collection>,
): { collection: Collection; file: KnowledgeFile } | null {
  const fileData = parseKnowledgeFileAttachmentData(attachment);
  if (!fileData) return null;

  const collection = collectionsById.get(fileData.collectionId);
  const file = collection?.files.find((item) => item.id === fileData.fileId);
  return collection && file ? { collection, file } : null;
}

function isCurrentIndexedFile(
  collection: Collection,
  file: KnowledgeFile,
): boolean {
  return (
    (file.indexStatus || file.status) === "indexed" &&
    typeof file.ragId === "string" &&
    Boolean(file.ragId) &&
    (!file.indexedChunkingRevision ||
      file.indexedChunkingRevision === collection.chunkingRevision)
  );
}

export function isIndexedKnowledgeFileAttachment(
  attachment: Attachment,
  knowledgeCollections: readonly Collection[],
): boolean {
  const collectionsById = new Map(
    knowledgeCollections.map((collection) => [collection.id, collection]),
  );
  const selected = getCollectionFile(attachment, collectionsById);
  return selected
    ? isCurrentIndexedFile(selected.collection, selected.file)
    : false;
}

function addFileId(
  target: Map<string, Set<string>>,
  collectionId: string,
  fileId: string,
) {
  const fileIds = target.get(collectionId) || new Set<string>();
  fileIds.add(fileId);
  target.set(collectionId, fileIds);
}

function resolveSelectedKnowledgeScope(
  scopeAttachments: readonly Attachment[],
  knowledgeCollections: readonly Collection[],
): SelectedKnowledgeScope {
  const collectionsById = new Map(
    knowledgeCollections.map((collection) => [collection.id, collection]),
  );
  const selectedCollectionIds = new Set<string>();
  const lexicalFileIdsByCollectionId = new Map<string, Set<string>>();
  const vectorFileIdsByCollectionId = new Map<string, Set<string>>();

  for (const attachment of scopeAttachments) {
    if (isKnowledgeCollectionAttachment(attachment)) {
      const collectionId = attachment.data;
      if (collectionId && collectionsById.has(collectionId)) {
        selectedCollectionIds.add(collectionId);
      }
      continue;
    }

    if (!isKnowledgeFileAttachment(attachment)) continue;
    const selected = getCollectionFile(attachment, collectionsById);
    if (!selected) continue;

    addFileId(
      lexicalFileIdsByCollectionId,
      selected.collection.id,
      selected.file.id,
    );
    if (isCurrentIndexedFile(selected.collection, selected.file)) {
      addFileId(
        vectorFileIdsByCollectionId,
        selected.collection.id,
        selected.file.id,
      );
      addFileId(
        vectorFileIdsByCollectionId,
        selected.collection.id,
        selected.file.ragId!,
      );
    }
  }

  const vectorCollectionIds = new Set(selectedCollectionIds);
  for (const collectionId of vectorFileIdsByCollectionId.keys()) {
    vectorCollectionIds.add(collectionId);
  }

  return {
    selectedCollectionIds,
    lexicalFileIdsByCollectionId,
    vectorFileIdsByCollectionId,
    vectorCollectionIds,
  };
}

function sourceMatchesSelectedScope(
  source: Source,
  selectedCollectionIds: ReadonlySet<string>,
  selectedFileIdsByCollectionId: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  const collectionId = getSourceMetadataString(source, "collectionId");
  if (selectedCollectionIds.has(collectionId)) return true;

  const selectedFileIds = selectedFileIdsByCollectionId.get(collectionId);
  if (!selectedFileIds) return false;

  const fileId = getSourceMetadataString(source, "fileId");
  return selectedFileIds.has(fileId);
}

function sourceMatchesCurrentKnowledgeIndex(
  source: Source,
  collectionsById: ReadonlyMap<string, Collection>,
): boolean {
  if (source.metadata?.retrieval === "keyword") return true;

  const collectionId = getSourceMetadataString(source, "collectionId");
  const collection = collectionsById.get(collectionId);
  if (!collection) return false;

  const fileId = getSourceMetadataString(source, "fileId");
  const file = collection.files.find(
    (item) => item.id === fileId || item.ragId === fileId,
  );
  if (!file || !isCurrentIndexedFile(collection, file)) return false;

  const sourceRevision = getSourceMetadataString(source, "chunkingRevision");
  return (
    (!file.indexedChunkingRevision && !sourceRevision) ||
    (file.indexedChunkingRevision === collection.chunkingRevision &&
      (!sourceRevision || sourceRevision === collection.chunkingRevision))
  );
}

function serializeFileScope(
  fileIdsByCollectionId: ReadonlyMap<string, ReadonlySet<string>>,
): Array<[string, string[]]> {
  return [...fileIdsByCollectionId.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([collectionId, fileIds]) => [
      collectionId,
      [...fileIds].sort((left, right) => left.localeCompare(right)),
    ]);
}

function createLexicalCacheKey(
  scope: SelectedKnowledgeScope,
  knowledgeCollections: readonly Collection[],
): string {
  const collectionsById = new Map(
    knowledgeCollections.map((collection) => [collection.id, collection]),
  );
  const selectedCollectionIds = [...scope.selectedCollectionIds].sort(
    (left, right) => left.localeCompare(right),
  );
  const relevantCollectionIds = new Set([
    ...selectedCollectionIds,
    ...scope.lexicalFileIdsByCollectionId.keys(),
  ]);
  const revisions = [...relevantCollectionIds]
    .sort((left, right) => left.localeCompare(right))
    .map((collectionId) => {
      const collection = collectionsById.get(collectionId);
      return [
        collectionId,
        collection?.chunkingRevision || "",
        collection?.updatedAt || 0,
      ];
    });

  return JSON.stringify({
    collections: selectedCollectionIds,
    files: serializeFileScope(scope.lexicalFileIdsByCollectionId),
    revisions,
  });
}

async function buildScopedLexicalIndex({
  scope,
  knowledgeCollections,
  signal,
}: {
  scope: SelectedKnowledgeScope;
  knowledgeCollections: readonly Collection[];
  signal?: AbortSignal;
}): Promise<KnowledgeLexicalIndex | null> {
  try {
    return await buildKnowledgeLexicalIndex({
      collections: knowledgeCollections,
      collectionIds: scope.selectedCollectionIds,
      fileIdsByCollectionId: scope.lexicalFileIdsByCollectionId,
      signal,
      readContent: async (collection, file, readSignal) => {
        const result = await readPersistedKnowledgeContent(
          collection,
          file,
          readSignal,
          GLOBAL_SEARCH_LIMITS.maxSingleContentChars,
        );
        return result?.content || null;
      },
    });
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw error;
    }
    logDevError("Local knowledge index failed", error);
    return null;
  }
}

function getScopedLexicalIndex({
  scope,
  knowledgeCollections,
  signal,
  lexicalCache,
}: {
  scope: SelectedKnowledgeScope;
  knowledgeCollections: readonly Collection[];
  signal?: AbortSignal;
  lexicalCache?: KnowledgeLexicalIndexCache;
}): Promise<KnowledgeLexicalIndex | null> {
  if (!lexicalCache) {
    return buildScopedLexicalIndex({
      scope,
      knowledgeCollections,
      signal,
    });
  }

  const cacheKey = createLexicalCacheKey(scope, knowledgeCollections);
  const cached = lexicalCache.get(cacheKey);
  if (cached) return cached;

  const pending = buildScopedLexicalIndex({
    scope,
    knowledgeCollections,
    signal,
  });
  lexicalCache.set(cacheKey, pending);
  void pending.catch(() => {
    if (lexicalCache.get(cacheKey) === pending) {
      lexicalCache.delete(cacheKey);
    }
  });
  return pending;
}

function normalizeQueries(queries: readonly string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const query of queries) {
    const value = query.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

export async function retrieveKnowledgeSources({
  queries,
  scopeAttachments,
  collections,
  ragConfig,
  signal,
  lexicalCache,
}: {
  queries: readonly string[];
  scopeAttachments: readonly Attachment[];
  collections: readonly Collection[];
  ragConfig: KnowledgeRetrievalRagConfig;
  signal?: AbortSignal;
  lexicalCache?: KnowledgeLexicalIndexCache;
}): Promise<{ sources: Source[]; ragError?: RagQueryError }> {
  signal?.throwIfAborted();
  const normalizedQueries = normalizeQueries(queries);
  if (normalizedQueries.length === 0 || scopeAttachments.length === 0) {
    return { sources: [] };
  }

  const scope = resolveSelectedKnowledgeScope(scopeAttachments, collections);
  if (
    scope.selectedCollectionIds.size === 0 &&
    scope.lexicalFileIdsByCollectionId.size === 0
  ) {
    return { sources: [] };
  }

  const topK = Math.max(
    1,
    Math.min(MAX_TOP_K, ragConfig.topK || DEFAULT_TOP_K),
  );
  const lexicalIndex = await getScopedLexicalIndex({
    scope,
    knowledgeCollections: collections,
    signal,
    lexicalCache,
  });
  signal?.throwIfAborted();

  const keywordResults = lexicalIndex
    ? normalizedQueries.flatMap((query) =>
        searchKnowledgeLexicalIndex(lexicalIndex, query, topK),
      )
    : [];

  const vectorEnabled =
    ragConfig.enabled &&
    hasRagVectorStore(ragConfig) &&
    scope.vectorCollectionIds.size > 0;
  const searchRequests: Array<{ query: string; collectionId: string }> = [];
  if (vectorEnabled) {
    for (const query of normalizedQueries) {
      for (const collectionId of scope.vectorCollectionIds) {
        searchRequests.push({ query, collectionId });
      }
    }
  }

  const settledResults = vectorEnabled
    ? await mapSettledWithConcurrency<
        { query: string; collectionId: string },
        Source[]
      >(searchRequests, RAG_QUERY_CONCURRENCY, ({ query, collectionId }) => {
        signal?.throwIfAborted();
        const request = signal
          ? queryRAG(query, collectionId, signal)
          : queryRAG(query, collectionId);
        return request.then((sources) =>
          sources.map((source): Source => ({
            ...source,
            metadata: {
              ...(source.metadata || {}),
              collectionId:
                getSourceMetadataString(source, "collectionId") || collectionId,
              retrieval: "vector",
            },
          })),
        );
      })
    : [];
  signal?.throwIfAborted();

  const successfulResults = settledResults.filter(
    (result): result is PromiseFulfilledResult<Source[]> =>
      result.status === "fulfilled",
  );
  const failedResults = settledResults.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (
    successfulResults.length === 0 &&
    failedResults.length > 0 &&
    keywordResults.length === 0
  ) {
    throw failedResults[0].reason;
  }
  failedResults.forEach((result) => {
    logDevError("RAG query failed; preserving partial results", result.reason);
  });

  const collectionsById = new Map(
    collections.map((collection) => [collection.id, collection]),
  );
  const vectorResults = successfulResults
    .flatMap((result) => result.value)
    .filter((source) =>
      sourceMatchesSelectedScope(
        source,
        scope.selectedCollectionIds,
        scope.vectorFileIdsByCollectionId,
      ),
    )
    .filter((source) =>
      sourceMatchesCurrentKnowledgeIndex(source, collectionsById),
    );
  const scopedKeywordResults = keywordResults.filter((source) =>
    sourceMatchesSelectedScope(
      source,
      scope.selectedCollectionIds,
      scope.lexicalFileIdsByCollectionId,
    ),
  );
  const sources = reciprocalRankFuseKnowledgeSources({
    vector: vectorResults,
    keyword: scopedKeywordResults,
    limit: topK,
  });

  const ragError =
    failedResults.length > 0 &&
    vectorResults.length === 0 &&
    scopedKeywordResults.length > 0
      ? {
          code: "RAG_VECTOR_FALLBACK" as const,
          message:
            "Vector retrieval was unavailable; local keyword results were used.",
        }
      : undefined;

  return { sources, ragError };
}
