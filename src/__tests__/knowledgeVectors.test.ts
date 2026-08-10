import { describe, expect, it } from "vitest";
import {
  buildKnowledgeVectorIds,
  buildKnowledgeVectorItems,
} from "../lib/utils/knowledgeVectors";

describe("knowledge vector helpers", () => {
  it("builds vector items with stable ids and metadata", () => {
    const items = buildKnowledgeVectorItems({
      collectionId: "collection_1",
      fileName: "notes.md",
      ragFileId: "file_1",
      textContent: Array.from(
        { length: 320 },
        (_, index) => `word${index}`,
      ).join(" "),
      chunking: {
        strategy: "recursive",
        chunkSize: 128,
        overlapPercent: 10,
      },
      chunkingRevision: "recursive:128:10",
    });

    expect(items.length).toBeGreaterThan(1);
    expect(items[0]).toMatchObject({
      id: "file_1_0",
      metadata: {
        collectionId: "collection_1",
        fileId: "file_1",
        fileName: "notes.md",
        chunkIndex: 0,
        chunkingRevision: "recursive:128:10",
        retrieval: "vector",
      },
    });
    expect(items.every((item) => item.data.trim().length > 0)).toBe(true);
  });

  it("preserves heading paths for markdown-aware chunks", () => {
    const items = buildKnowledgeVectorItems({
      collectionId: "collection_1",
      fileName: "guide.md",
      ragFileId: "file_1",
      textContent: "# Guide\n\nIntro\n\n## Setup\n\nInstall the application.",
      chunking: {
        strategy: "markdown",
        chunkSize: 128,
        overlapPercent: 0,
      },
      chunkingRevision: "markdown:128:0",
    });

    expect(items.map((item) => item.metadata.headingPath)).toEqual([
      ["Guide"],
      ["Guide", "Setup"],
    ]);
  });

  it("builds vector ids from the persisted chunk count", () => {
    expect(buildKnowledgeVectorIds("file_1", 3)).toEqual([
      "file_1_0",
      "file_1_1",
      "file_1_2",
    ]);
    expect(buildKnowledgeVectorIds("file_1", 0)).toEqual([]);
  });
});
