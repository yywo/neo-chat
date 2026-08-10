import type { Message, Session, SessionMessageTree } from "@/types";
import {
  normalizeMessages,
  normalizeMessageTreeMessages,
} from "@/store/storage/migrations";
import {
  getActiveMessagePath,
  isSessionMessageTree,
  normalizeSessionMessageTree,
} from "./messageTree";

export interface SessionExportPayload extends Session {
  messages: Message[];
  messageTree?: SessionMessageTree;
}

export async function createSessionExportPayload({
  session,
  currentSessionId,
  activeMessages,
  activeMessageTree,
  loadMessages,
}: {
  session: Session;
  currentSessionId: string | null;
  activeMessages: Message[];
  activeMessageTree?: SessionMessageTree;
  loadMessages: (
    sessionId: string,
  ) => Promise<Message[] | SessionMessageTree | null | undefined>;
}): Promise<SessionExportPayload> {
  if (session.id === currentSessionId && activeMessageTree) {
    const messageTree = normalizeMessageTreeMessages(
      normalizeSessionMessageTree(activeMessageTree),
    );
    return {
      ...session,
      messages: normalizeMessages(activeMessages),
      messageTree,
    };
  }

  const storedMessages =
    session.id === currentSessionId
      ? activeMessages
      : await loadMessages(session.id);
  const messageTree = isSessionMessageTree(storedMessages)
    ? normalizeMessageTreeMessages(normalizeSessionMessageTree(storedMessages))
    : undefined;
  const legacyMessages = Array.isArray(storedMessages)
    ? storedMessages
    : undefined;

  return {
    ...session,
    messages: messageTree
      ? getActiveMessagePath(messageTree)
      : normalizeMessages(legacyMessages),
    ...(messageTree ? { messageTree } : {}),
  };
}
