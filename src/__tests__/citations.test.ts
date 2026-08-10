import { describe, expect, it } from "vitest";
import {
  createCitationHref,
  createCitationSources,
  linkifyCitationReferences,
} from "../lib/utils/citations";
import type { Source } from "../types";

describe("citation utilities", () => {
  it("creates internal citation hrefs", () => {
    expect(createCitationHref(2)).toBe("#citation-2");
  });

  it("linkifies citation references without interpolating raw source URLs", () => {
    const sources: Source[] = [
      {
        title: "Unsafe",
        url: "https://example.com/a) injected [x](javascript:alert(1)",
        content: "content",
      },
    ];

    const output = linkifyCitationReferences(
      "Use [1], but keep `[1]` as code.",
      sources,
    );

    expect(output).toBe("Use [1](#citation-0), but keep `[1]` as code.");
    expect(output).not.toContain("example.com");
    expect(output).not.toContain("javascript:");
  });

  it("leaves missing citation references untouched", () => {
    expect(linkifyCitationReferences("Use [2].", [])).toBe("Use [2].");
  });

  it("assigns stable IDs and keeps web and knowledge numbering unified", () => {
    const web: Source = {
      title: "Web result",
      url: "https://example.com/result",
      content: "web excerpt",
    };
    const knowledge: Source = {
      title: "Local note",
      url: "knowledge://collection/file/2",
      content: "local excerpt",
      metadata: {
        collectionId: "collection-1",
        fileId: "file-1",
        chunkIndex: 2,
        retrieval: "both",
      },
    };

    const first = createCitationSources({ web: [web], knowledge: [knowledge] });
    const restored = createCitationSources({
      web: [{ ...web }],
      knowledge: [{ ...knowledge, metadata: { ...knowledge.metadata } }],
    });

    expect(restored).toEqual(first);
    expect(first).toHaveLength(2);
    expect(first[0]).toMatchObject({ kind: "web" });
    expect(first[1]).toMatchObject({
      kind: "knowledge",
      collectionId: "collection-1",
      fileId: "file-1",
      chunkIndex: 2,
      retrieval: "both",
    });
    expect(
      linkifyCitationReferences("Web [1], local [^1].", [web], [knowledge]),
    ).toBe("Web [1](#citation-0), local [2](#citation-1).");
  });
});
