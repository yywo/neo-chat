import { describe, expect, it } from "vitest";
import {
  buildKnowledgeLexicalIndex,
  reciprocalRankFuseKnowledgeSources,
  searchKnowledgeLexicalIndex,
} from "../lib/knowledge/hybridSearch";
import type { Collection, Source } from "../types";

const collection: Collection = {
  id: "docs",
  name: "Product docs",
  description: "",
  icon: "Folder",
  color: "blue",
  updatedAt: 10,
  chunking: { strategy: "markdown", chunkSize: 128, overlapPercent: 10 },
  chunkingRevision: "markdown:128:10",
  files: [
    {
      id: "guide",
      name: "guide.md",
      size: 100,
      type: "text/markdown",
      uploadedAt: 10,
      status: "saved",
      storageStatus: "saved",
      indexStatus: "not_indexed",
    },
  ],
};

describe("knowledge hybrid search", () => {
  it("reuses the local search ranking over collection chunks", async () => {
    const index = await buildKnowledgeLexicalIndex({
      collections: [collection],
      collectionIds: new Set([collection.id]),
      readContent: async () =>
        "# Deployment\n\nUse a private bucket.\n\n## Recovery\n\nKeep the recovery key offline.",
    });

    const results = searchKnowledgeLexicalIndex(index, "recovery key", 5);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: "guide.md · Deployment › Recovery",
      metadata: {
        collectionId: "docs",
        localFileId: "guide",
        retrieval: "keyword",
      },
    });
  });

  it("fuses matching vector and lexical sources deterministically", () => {
    const vector: Source = {
      title: "Guide",
      url: "",
      content: "Recovery key",
      metadata: { collectionId: "docs", fileId: "guide", chunkIndex: 0 },
    };
    const keyword: Source = {
      ...vector,
      metadata: { ...vector.metadata, retrieval: "keyword" },
    };

    expect(
      reciprocalRankFuseKnowledgeSources({
        vector: [vector],
        keyword: [keyword],
        limit: 5,
      }),
    ).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({ retrieval: "both" }),
      }),
    ]);
  });
});
