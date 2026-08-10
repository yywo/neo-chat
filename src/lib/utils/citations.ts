import type { CitationSource, CitationSourceKind, Source } from "@/types";

export function createCitationHref(index: number): string {
  return `#citation-${index}`;
}

export function linkifyCitationReferences(
  content: string,
  sources: Source[] | undefined,
  knowledgeSources: Source[] = [],
): string {
  if (!sources?.length && knowledgeSources.length === 0) return content;

  const webSourceCount = sources?.length || 0;

  const segments = content.split(/(`+[^`]+`+)/g);
  return segments
    .map((segment, segmentIndex) => {
      if (segmentIndex % 2 === 1) return segment;

      const withWebCitations = segment.replace(
        /\[(\d+)\](?!\s*[:(])/g,
        (match, value) => {
          const sourceIndex = Number.parseInt(value, 10) - 1;
          return sources?.[sourceIndex]
            ? `[${value}](${createCitationHref(sourceIndex)})`
            : match;
        },
      );
      return withWebCitations.replace(
        /\[\^(\d+)\](?!\s*:)/g,
        (match, value) => {
          const knowledgeIndex = Number.parseInt(value, 10) - 1;
          if (!knowledgeSources[knowledgeIndex]) return match;
          const combinedIndex = webSourceCount + knowledgeIndex;
          return `[${combinedIndex + 1}](${createCitationHref(combinedIndex)})`;
        },
      );
    })
    .join("");
}

function stableCitationId(source: Source, kind: CitationSourceKind): string {
  const metadataId = source.metadata?.id;
  if (typeof metadataId === "string" && metadataId) return metadataId;
  const collectionId = String(source.metadata?.collectionId || "");
  const fileId = String(source.metadata?.fileId || "");
  const chunkIndex = String(source.metadata?.chunkIndex ?? "");
  const value = `${kind}:${collectionId}:${fileId}:${chunkIndex}:${source.url}:${source.title}:${source.content.slice(0, 240)}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${kind}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function createCitationSources({
  web = [],
  knowledge = [],
}: {
  web?: readonly Source[];
  knowledge?: readonly Source[];
}): CitationSource[] {
  const citations: CitationSource[] = [];
  const seen = new Set<string>();
  for (const [kind, sources] of [
    ["web", web],
    ["knowledge", knowledge],
  ] as const) {
    for (const source of sources) {
      const id = stableCitationId(source, kind);
      if (seen.has(id)) continue;
      seen.add(id);
      citations.push({
        ...source,
        id,
        kind,
        collectionId:
          typeof source.metadata?.collectionId === "string"
            ? source.metadata.collectionId
            : undefined,
        fileId:
          typeof source.metadata?.fileId === "string"
            ? source.metadata.fileId
            : undefined,
        chunkIndex:
          typeof source.metadata?.chunkIndex === "number"
            ? source.metadata.chunkIndex
            : undefined,
        retrieval:
          source.metadata?.retrieval === "vector" ||
          source.metadata?.retrieval === "keyword" ||
          source.metadata?.retrieval === "both"
            ? source.metadata.retrieval
            : undefined,
      });
    }
  }
  return citations;
}
