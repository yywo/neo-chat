import type { Message, ToolCall } from "@/types";

export const STREAM_CHECKPOINT_INTERVAL_MS = 750;
export const STREAM_CHECKPOINT_CHARACTER_DELTA = 2 * 1024;
export const STREAM_CONTINUATION_OVERLAP_WINDOW = 512;
export const STREAM_RETRY_DELAYS_MS = [500, 1500] as const;

const retryableErrorCodes = new Set([
  "INCOMPLETE_CHAT_STREAM",
  "CHAT_STREAM_ERROR",
  "RESPONSE_TIMEOUT",
]);

const terminalToolStatuses = new Set<ToolCall["status"]>([
  "success",
  "error",
  "skipped",
  "denied",
]);

const getErrorCode = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "";

export function isRetryablePreOutputError(error: unknown): boolean {
  if (!(error instanceof Error) || error.name === "AbortError") return false;
  if (retryableErrorCodes.has(getErrorCode(error))) return true;
  if (error instanceof TypeError) return true;

  return /network|fetch|connection|stream ended|temporar|timeout|\b5\d\d\b/i.test(
    error.message,
  );
}

function createAbortError(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  if (typeof DOMException !== "undefined") {
    return new DOMException("The operation was aborted", "AbortError");
  }
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

const waitForRetry = (delayMs: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError(signal));
      return;
    }

    const jitter = Math.floor(Math.random() * 151);
    const onAbort = () => {
      clearTimeout(timer);
      reject(createAbortError(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs + jitter);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

export async function runWithPreOutputRetry<T>({
  run,
  hasVisibleOutput,
  hasToolActivity,
  signal,
  onAttempt,
}: {
  run: (attempt: number) => Promise<T>;
  hasVisibleOutput: () => boolean;
  hasToolActivity: () => boolean;
  signal?: AbortSignal;
  onAttempt?: (attempt: number) => void;
}): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    onAttempt?.(attempt);
    try {
      return await run(attempt);
    } catch (error) {
      const retryDelay = STREAM_RETRY_DELAYS_MS[attempt];
      if (
        retryDelay === undefined ||
        hasVisibleOutput() ||
        hasToolActivity() ||
        !isRetryablePreOutputError(error)
      ) {
        throw error;
      }
      await waitForRetry(retryDelay, signal);
    }
  }
}

export function createStreamCheckpointController({
  persist,
  now = () => Date.now(),
}: {
  persist: () => Promise<void>;
  now?: () => number;
}) {
  let lastCheckpointAt = now();
  let lastCheckpointCharacters = 0;
  let latestCharacters = 0;
  let pending: Promise<void> | null = null;
  let checkpointRequested = false;

  const flush = () => {
    checkpointRequested = true;
    if (!pending) {
      pending = (async () => {
        try {
          while (checkpointRequested) {
            checkpointRequested = false;
            lastCheckpointAt = now();
            lastCheckpointCharacters = latestCharacters;
            await persist();
          }
        } finally {
          pending = null;
        }
      })();
    }
    return pending;
  };

  const record = (characters: number) => {
    latestCharacters = characters;
    if (
      now() - lastCheckpointAt >= STREAM_CHECKPOINT_INTERVAL_MS ||
      characters - lastCheckpointCharacters >= STREAM_CHECKPOINT_CHARACTER_DELTA
    ) {
      void flush();
    }
  };

  return { record, flush };
}

export function hasUnsafeContinuationToolState(
  toolCalls: ToolCall[] | undefined,
): boolean {
  return Boolean(
    toolCalls?.some(
      (toolCall) =>
        !terminalToolStatuses.has(toolCall.status) ||
        (toolCall.risk !== undefined && toolCall.risk !== "read"),
    ),
  );
}

export function trimContinuationOverlap(
  existingText: string,
  continuationText: string,
): string {
  const existingTail = existingText.slice(-STREAM_CONTINUATION_OVERLAP_WINDOW);
  const continuationHead = continuationText.slice(
    0,
    STREAM_CONTINUATION_OVERLAP_WINDOW,
  );
  const maxOverlap = Math.min(existingTail.length, continuationHead.length);

  for (let length = maxOverlap; length >= 16; length -= 1) {
    if (existingTail.endsWith(continuationHead.slice(0, length))) {
      return continuationText.slice(length);
    }
  }
  return continuationText;
}

export function buildReplyPromptContext(replyTo: Message["replyTo"]): string {
  if (!replyTo) return "";
  const escapedExcerpt = replyTo.excerpt
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return [
    '<reply_to role="' + replyTo.role + '">',
    escapedExcerpt,
    "</reply_to>",
  ].join("\n");
}

export function getReplyExcerpt(message: Pick<Message, "content">): string {
  const compact = message.content.replace(/\s+/g, " ").trim();
  return compact.slice(0, 280);
}

export function markStaleGenerationInterrupted(
  message: Message,
  ownerDeviceId: string,
  now = Date.now(),
): Message {
  if (
    message.generation?.status !== "streaming" ||
    message.generation.ownerDeviceId === ownerDeviceId ||
    now - message.generation.checkpointAt <= 2 * 60 * 1000
  ) {
    return message;
  }

  return {
    ...message,
    generation: { ...message.generation, status: "interrupted" },
  };
}

export function recoverPersistedGeneration(
  message: Message,
  ownerDeviceId: string,
  hasActiveLocalGeneration: boolean,
  now = Date.now(),
): Message {
  if (
    message.generation?.status === "streaming" &&
    message.generation.ownerDeviceId === ownerDeviceId &&
    !hasActiveLocalGeneration
  ) {
    return {
      ...message,
      generation: { ...message.generation, status: "interrupted" },
    };
  }

  return markStaleGenerationInterrupted(message, ownerDeviceId, now);
}
