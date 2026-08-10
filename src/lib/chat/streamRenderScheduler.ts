export interface StreamRenderScheduler<T> {
  schedule: (payload: T) => void;
  flush: () => void;
  cancel: () => void;
}

export function createStreamRenderScheduler<T>(
  apply: (payload: T) => void,
  windowMs = 50,
): StreamRenderScheduler<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let hasPendingPayload = false;
  let pendingPayload: T;

  const clearTimer = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const flush = () => {
    clearTimer();
    if (!hasPendingPayload) return;

    const payload = pendingPayload;
    hasPendingPayload = false;
    apply(payload);
  };

  return {
    schedule(payload) {
      pendingPayload = payload;
      hasPendingPayload = true;
      timer ??= setTimeout(flush, windowMs);
    },
    flush,
    cancel() {
      clearTimer();
      hasPendingPayload = false;
    },
  };
}
