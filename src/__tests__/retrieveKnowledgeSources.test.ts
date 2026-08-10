import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Attachment, Collection, KnowledgeFile, Source } from "../types";

const mocks = vi.hoisted(() => ({
  queryRAG: vi.fn(),
  readPersistedKnowledgeContent: vi.fn(),
  logDevError: vi.fn(),
}));

vi.mock("../services/api/ragService", () => ({
  queryRAG: mocks.queryRAG,
}));

vi.mock("../lib/global-search/browserAdapter", () => ({
  readPersistedKnowledgeContent: mocks.readPersistedKnowledgeContent,
}));

vi.mock("../lib/utils/devLogger", () => ({
  logDevError: mocks.logDevError,
}));

import {
  retrieveKnowledgeSources,
  type KnowledgeLexicalIndexCache,
} from "../lib/knowledge/retrieveKnowledgeSources";
import {
  KNOWLEDGE_COLLECTION_MIME,
  KNOWLEDGE_FILE_MIME,
} from "../lib/utils/knowledgeAttachments";

const localOnlyRagConfig = { enabled: false };
const vectorRagConfig = {
  enabled: true,
  useDefaultVectorStore: true,
  serverVectorStoreAvailable: true,
  topK: 10,
};

function createCollection(
  id: string,
  files: Array<{ id: string; indexed?: boolean }>,
): Collection {
  const chunkingRevision = `revision:${id}`;
  return {
    id,
    name: `${id} docs`,
    description: "",
    icon: "Folder",
    color: "blue",
    updatedAt: 10,
    chunking: {
      strategy: "markdown",
      chunkSize: 128,
      overlapPercent: 10,
    },
    chunkingRevision,
    files: files.map(({ id: fileId, indexed = false }): KnowledgeFile => ({
      id: fileId,
      name: `${fileId}.md`,
      size: 100,
      type: "text/markdown",
      uploadedAt: 10,
      status: indexed ? "indexed" : "saved",
      storageStatus: "saved",
      indexStatus: indexed ? "indexed" : "not_indexed",
      ...(indexed
        ? {
            ragId: `rag-${fileId}`,
            indexedChunkingRevision: chunkingRevision,
          }
        : {}),
    })),
  };
}

function collectionAttachment(collection: Collection): Attachment {
  return {
    id: `attachment-${collection.id}`,
    mimeType: KNOWLEDGE_COLLECTION_MIME,
    data: collection.id,
    fileName: collection.name,
  };
}

function fileAttachment(
  collection: Collection,
  file: KnowledgeFile,
): Attachment {
  return {
    id: `attachment-${collection.id}-${file.id}`,
    mimeType: KNOWLEDGE_FILE_MIME,
    data: JSON.stringify({
      collectionId: collection.id,
      fileId: file.id,
    }),
    fileName: file.name,
  };
}

function vectorSource(
  collection: Collection,
  file: KnowledgeFile,
  content = "Vector result",
): Source {
  return {
    title: file.name,
    url: "",
    content,
    metadata: {
      collectionId: collection.id,
      fileId: file.ragId,
      chunkingRevision: collection.chunkingRevision,
      chunkIndex: 0,
    },
  };
}

describe("retrieveKnowledgeSources", () => {
  let fileContents: Map<string, string | null>;

  beforeEach(() => {
    mocks.queryRAG.mockReset();
    mocks.readPersistedKnowledgeContent.mockReset();
    mocks.logDevError.mockReset();
    fileContents = new Map();
    mocks.queryRAG.mockResolvedValue([]);
    mocks.readPersistedKnowledgeContent.mockImplementation(
      async (_collection: Collection, file: KnowledgeFile) => {
        const content = fileContents.get(file.id);
        return content ? { content, truncated: false } : null;
      },
    );
  });

  it("searches every local file in a selected collection", async () => {
    const collection = createCollection("guides", [
      { id: "indexed", indexed: true },
      { id: "draft" },
    ]);
    fileContents.set("indexed", "Published material");
    fileContents.set("draft", "An unindexed lunar handbook");

    const result = await retrieveKnowledgeSources({
      queries: ["lunar handbook"],
      scopeAttachments: [collectionAttachment(collection)],
      collections: [collection],
      ragConfig: localOnlyRagConfig,
    });

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.metadata).toMatchObject({
      collectionId: collection.id,
      localFileId: "draft",
      retrieval: "keyword",
    });
    expect(mocks.queryRAG).not.toHaveBeenCalled();
  });

  it("keeps an explicit unindexed file lexical-only and file-scoped", async () => {
    const collection = createCollection("notes", [
      { id: "selected-draft" },
      { id: "other-draft" },
    ]);
    fileContents.set("selected-draft", "Scoped nebula marker");
    fileContents.set("other-draft", "Scoped nebula marker");

    const result = await retrieveKnowledgeSources({
      queries: ["nebula marker"],
      scopeAttachments: [fileAttachment(collection, collection.files[0])],
      collections: [collection],
      ragConfig: vectorRagConfig,
    });

    expect(
      result.sources.map((source) => source.metadata?.localFileId),
    ).toEqual(["selected-draft"]);
    expect(mocks.queryRAG).not.toHaveBeenCalled();
  });

  it("limits an indexed file selector to its legal vector identity", async () => {
    const collection = createCollection("manuals", [
      { id: "selected", indexed: true },
      { id: "other", indexed: true },
      { id: "unindexed" },
    ]);
    const selected = collection.files[0];
    const other = collection.files[1];
    const unindexed = collection.files[2];
    mocks.queryRAG.mockResolvedValue([
      vectorSource(collection, selected, "Selected vector"),
      vectorSource(collection, other, "Other vector"),
      {
        ...vectorSource(collection, unindexed, "Illegal vector"),
        metadata: {
          collectionId: collection.id,
          fileId: unindexed.id,
          chunkingRevision: collection.chunkingRevision,
          chunkIndex: 0,
        },
      },
    ]);

    const signal = new AbortController().signal;
    const result = await retrieveKnowledgeSources({
      queries: ["vector"],
      scopeAttachments: [fileAttachment(collection, selected)],
      collections: [collection],
      ragConfig: vectorRagConfig,
      signal,
    });

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.content).toBe("Selected vector");
    expect(mocks.queryRAG).toHaveBeenCalledWith(
      "vector",
      collection.id,
      signal,
    );
  });

  it("filters collection vector results to current indexed files", async () => {
    const collection = createCollection("current", [
      { id: "current", indexed: true },
      { id: "stale", indexed: true },
      { id: "unindexed" },
    ]);
    const current = collection.files[0];
    const stale = collection.files[1];
    const unindexed = collection.files[2];
    stale.indexedChunkingRevision = "older-revision";
    mocks.queryRAG.mockResolvedValue([
      vectorSource(collection, current, "Current vector"),
      vectorSource(collection, stale, "Stale vector"),
      {
        ...vectorSource(collection, unindexed, "Unindexed vector"),
        metadata: {
          collectionId: collection.id,
          fileId: unindexed.id,
          chunkingRevision: collection.chunkingRevision,
          chunkIndex: 0,
        },
      },
    ]);

    const result = await retrieveKnowledgeSources({
      queries: ["vector"],
      scopeAttachments: [collectionAttachment(collection)],
      collections: [collection],
      ragConfig: vectorRagConfig,
    });

    expect(result.sources.map((source) => source.content)).toEqual([
      "Current vector",
    ]);
  });

  it("preserves successful vector results when another collection fails", async () => {
    const first = createCollection("first", [
      { id: "first-file", indexed: true },
    ]);
    const second = createCollection("second", [
      { id: "second-file", indexed: true },
    ]);
    const vectorFailure = new Error("second collection unavailable");
    mocks.queryRAG.mockImplementation(
      async (_query: string, collectionId: string) => {
        if (collectionId === second.id) throw vectorFailure;
        return [vectorSource(first, first.files[0])];
      },
    );

    const result = await retrieveKnowledgeSources({
      queries: ["answer"],
      scopeAttachments: [
        collectionAttachment(first),
        collectionAttachment(second),
      ],
      collections: [first, second],
      ragConfig: vectorRagConfig,
    });

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.metadata?.collectionId).toBe(first.id);
    expect(result.ragError).toBeUndefined();
    expect(mocks.logDevError).toHaveBeenCalledWith(
      "RAG query failed; preserving partial results",
      vectorFailure,
    );
  });

  it("reports vector fallback when keyword results survive total vector failure", async () => {
    const collection = createCollection("fallback", [
      { id: "guide", indexed: true },
    ]);
    fileContents.set("guide", "Local recovery compass");
    mocks.queryRAG.mockRejectedValue(new Error("vector unavailable"));

    const result = await retrieveKnowledgeSources({
      queries: ["recovery compass"],
      scopeAttachments: [collectionAttachment(collection)],
      collections: [collection],
      ragConfig: vectorRagConfig,
    });

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.metadata?.retrieval).toBe("keyword");
    expect(result.ragError).toEqual({
      code: "RAG_VECTOR_FALLBACK",
      message:
        "Vector retrieval was unavailable; local keyword results were used.",
    });
  });

  it("throws when all vector requests fail and no keyword result exists", async () => {
    const collection = createCollection("empty", [
      { id: "indexed", indexed: true },
    ]);
    const vectorFailure = new Error("vector unavailable");
    mocks.queryRAG.mockRejectedValue(vectorFailure);

    await expect(
      retrieveKnowledgeSources({
        queries: ["missing"],
        scopeAttachments: [collectionAttachment(collection)],
        collections: [collection],
        ragConfig: vectorRagConfig,
      }),
    ).rejects.toBe(vectorFailure);
  });

  it("propagates aborts before starting local or vector work", async () => {
    const collection = createCollection("abort", [
      { id: "indexed", indexed: true },
    ]);
    const controller = new AbortController();
    controller.abort();

    await expect(
      retrieveKnowledgeSources({
        queries: ["cancelled"],
        scopeAttachments: [collectionAttachment(collection)],
        collections: [collection],
        ragConfig: vectorRagConfig,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.readPersistedKnowledgeContent).not.toHaveBeenCalled();
    expect(mocks.queryRAG).not.toHaveBeenCalled();
  });

  it("reuses a request-scoped lexical index cache", async () => {
    const collection = createCollection("cached", [{ id: "guide" }]);
    fileContents.set("guide", "Reusable lexical cache marker");
    const lexicalCache: KnowledgeLexicalIndexCache = new Map();
    const input = {
      queries: ["cache marker"],
      scopeAttachments: [collectionAttachment(collection)],
      collections: [collection],
      ragConfig: localOnlyRagConfig,
      lexicalCache,
    };

    await retrieveKnowledgeSources(input);
    await retrieveKnowledgeSources(input);

    expect(mocks.readPersistedKnowledgeContent).toHaveBeenCalledTimes(1);
  });
});
