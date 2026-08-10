import type { ImageSource, Message, Source } from "@/types";
import { createCitationSources } from "@/lib/utils/citations";

export function mergeSources(
  existing: Source[] = [],
  incoming: Source[] = [],
): Source[] {
  const seen = new Set<string>();
  const merged: Source[] = [];

  for (const source of [...existing, ...incoming]) {
    const key = `${source.url}\n${source.title}\n${source.content}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(source);
  }

  return merged;
}

export function mergeImages(
  existing: ImageSource[] = [],
  incoming: ImageSource[] = [],
): ImageSource[] {
  const seen = new Set<string>();
  const merged: ImageSource[] = [];

  for (const image of [...existing, ...incoming]) {
    const key = `${image.url}\n${image.description || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(image);
  }

  return merged;
}

export function buildSearchUpdate(
  message: Message | undefined,
  isSearching: boolean,
  results?: { sources: Source[]; images: ImageSource[] },
  options: { replaceResults?: boolean } = {},
): Partial<Message> {
  const updates: Partial<Message> = { isSearching };
  if (results) {
    const searchSources = mergeSources(
      options.replaceResults ? [] : message?.searchSources,
      results.sources,
    );
    updates.searchSources = searchSources;
    updates.citations = createCitationSources({
      web: searchSources,
      knowledge: message?.ragSources,
    });
    updates.searchImages = mergeImages(
      options.replaceResults ? [] : message?.searchImages,
      results.images,
    );
  }
  return updates;
}
