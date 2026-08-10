export const KNOWLEDGE_SOURCE_NAVIGATE_EVENT =
  "neo-chat:navigate-knowledge-source";

export interface KnowledgeSourceNavigationDetail {
  collectionId: string;
  fileId?: string;
  chunkIndex?: number;
  excerpt?: string;
}

export function requestKnowledgeSourceNavigation(
  detail: KnowledgeSourceNavigationDetail,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<KnowledgeSourceNavigationDetail>(
      KNOWLEDGE_SOURCE_NAVIGATE_EVENT,
      { detail },
    ),
  );
}
