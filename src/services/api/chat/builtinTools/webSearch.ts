import { SEARCH_CONFIG_LIMITS, SEARCH_RESULT_LIMITS } from "@/config/limits";
import {
  normalizeImageSources,
  normalizeSearchSources,
} from "@/lib/search/results";
import { createSearchProvider } from "@/services/api/searchService";

import type { BuiltinToolBinding } from "./types";

const WEB_SEARCH_QUERY_MAX_CHARS = 4_000;

function errorResult(code: string, message: string) {
  return {
    error: {
      code,
      message,
      recoverable: true,
    },
  };
}

export function createWebSearchBinding(): BuiltinToolBinding {
  return {
    definition: {
      type: "function",
      function: {
        name: "web_search",
        description:
          "Search the public web with the configured external search provider. Use focused queries and refine them when needed.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            query: {
              type: "string",
              minLength: 1,
              maxLength: WEB_SEARCH_QUERY_MAX_CHARS,
              description: "Focused web search query.",
            },
            max_results: {
              type: "integer",
              minimum: SEARCH_CONFIG_LIMITS.minResultsLimit,
              maximum: SEARCH_CONFIG_LIMITS.maxResultsLimit,
              description: "Maximum number of results to return.",
            },
          },
          required: ["query"],
        },
      },
    },
    risk: "read",
    displayKey: "webSearch",
    agentOnly: true,
    async execute(args, context) {
      context.signal?.throwIfAborted();
      const input =
        args && typeof args === "object" && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {};
      const query =
        typeof input.query === "string"
          ? input.query.trim().slice(0, WEB_SEARCH_QUERY_MAX_CHARS)
          : "";
      if (!query) {
        return errorResult(
          "WEB_SEARCH_INVALID_QUERY",
          "web_search requires a non-empty query.",
        );
      }

      const requestedMax =
        typeof input.max_results === "number" &&
        Number.isFinite(input.max_results)
          ? Math.round(input.max_results)
          : undefined;
      const maxResults =
        requestedMax === undefined
          ? undefined
          : Math.min(
              SEARCH_CONFIG_LIMITS.maxResultsLimit,
              Math.max(SEARCH_CONFIG_LIMITS.minResultsLimit, requestedMax),
            );

      context.emit.search?.({ phase: "start" });
      try {
        const result = await createSearchProvider(
          { query, maxResults },
          context.signal,
        );
        context.signal?.throwIfAborted();
        const sources = normalizeSearchSources(result.sources, {
          maxSources: Math.min(
            maxResults ?? SEARCH_RESULT_LIMITS.maxSources,
            SEARCH_RESULT_LIMITS.maxSources,
          ),
        });
        const images = normalizeImageSources(
          result.images,
          Math.min(
            maxResults ?? SEARCH_RESULT_LIMITS.maxImages,
            SEARCH_RESULT_LIMITS.maxImages,
          ),
        );
        context.emit.search?.({ phase: "complete", sources, images });
        return { query, sources, images };
      } catch (error) {
        if (
          context.signal?.aborted ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          context.emit.search?.({ phase: "cancel" });
          if (context.signal?.aborted) context.signal.throwIfAborted();
          throw error;
        }
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Web search failed.";
        context.emit.search?.({ phase: "error", message });
        return errorResult("WEB_SEARCH_FAILED", message);
      }
    },
  };
}
