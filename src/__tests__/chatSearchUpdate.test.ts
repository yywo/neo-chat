import { describe, expect, it } from "vitest";
import { createMessageOutputBlockBuilder } from "../lib/chat/messageOutputBlocks";
import { buildSearchUpdate } from "../lib/chat/searchUpdate";
import type { Message } from "../types";

describe("chat search updates", () => {
  it("merges search sources and images without duplicating existing entries", () => {
    const message = {
      searchSources: [{ title: "A", url: "https://a.test", content: "same" }],
      searchImages: [{ url: "https://image.test/a.png", description: "same" }],
      ragSources: [
        {
          title: "Local",
          url: "knowledge://collection/file/0",
          content: "local",
          metadata: { collectionId: "collection", fileId: "file" },
        },
      ],
    } as unknown as Message;

    const update = buildSearchUpdate(message, false, {
      sources: [
        { title: "A", url: "https://a.test", content: "same" },
        { title: "B", url: "https://b.test", content: "new" },
      ],
      images: [
        { url: "https://image.test/a.png", description: "same" },
        { url: "https://image.test/b.png", description: "new" },
      ],
    });

    expect(update).toMatchObject({
      isSearching: false,
      searchSources: [
        { title: "A", url: "https://a.test", content: "same" },
        { title: "B", url: "https://b.test", content: "new" },
      ],
      searchImages: [
        { url: "https://image.test/a.png", description: "same" },
        { url: "https://image.test/b.png", description: "new" },
      ],
    });
    expect(update.citations).toHaveLength(3);
    expect(update.citations?.map((citation) => citation.kind)).toEqual([
      "web",
      "web",
      "knowledge",
    ]);
  });

  it("keeps a failed search block visible with a sanitized error", () => {
    const builder = createMessageOutputBlockBuilder({
      createId: () => "search-1",
    });

    builder.upsertSearch({
      isSearching: false,
      results: { sources: [], images: [] },
      error: "Search provider failed",
    });

    expect(builder.getBlocks()).toEqual([
      {
        id: "search-1",
        type: "search",
        isSearching: false,
        sources: [],
        images: [],
        error: "Search provider failed",
      },
    ]);
  });

  it("replaces Agent search snapshots so provider order wins over completion order", () => {
    const message = {
      searchSources: [
        {
          title: "Second",
          url: "https://second.test",
          content: "completed first",
        },
      ],
      searchImages: [
        {
          url: "https://images.test/second.png",
          description: "completed first",
        },
      ],
      ragSources: [
        {
          title: "Knowledge",
          url: "knowledge://collection/file/0",
          content: "local",
        },
      ],
    } as Message;

    const update = buildSearchUpdate(
      message,
      false,
      {
        sources: [
          {
            title: "First",
            url: "https://first.test",
            content: "provider first",
          },
          {
            title: "Second",
            url: "https://second.test",
            content: "completed first",
          },
        ],
        images: [
          {
            url: "https://images.test/first.png",
            description: "provider first",
          },
          {
            url: "https://images.test/second.png",
            description: "completed first",
          },
        ],
      },
      { replaceResults: true },
    );

    expect(update.searchSources?.map((source) => source.title)).toEqual([
      "First",
      "Second",
    ]);
    expect(update.searchImages?.map((image) => image.description)).toEqual([
      "provider first",
      "completed first",
    ]);
    expect(update.citations?.map((citation) => citation.title)).toEqual([
      "First",
      "Second",
      "Knowledge",
    ]);
  });
});
