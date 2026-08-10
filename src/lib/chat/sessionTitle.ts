export const DEFAULT_SESSION_TITLE = "New Chat";

export function getSessionDisplayTitle(
  title: string,
  localizedDefaultTitle: string,
): string {
  return title === DEFAULT_SESSION_TITLE ? localizedDefaultTitle : title;
}
