import { bytesToBase64Url } from "@/lib/byok/encoding";

export const SYNC_DEVICE_ID_STORAGE_KEY = "neo-chat-sync-device-id";

let fallbackDeviceId: string | undefined;

function createDeviceId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) {
    return bytesToBase64Url(
      globalThis.crypto.getRandomValues(new Uint8Array(16)),
    );
  }
  return `device-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 14)}`;
}

export function getSyncDeviceId(): string {
  if (typeof window === "undefined") {
    fallbackDeviceId ||= createDeviceId();
    return fallbackDeviceId;
  }

  const existing = window.localStorage.getItem(SYNC_DEVICE_ID_STORAGE_KEY);
  if (existing && /^[A-Za-z0-9_-]{16,100}$/.test(existing)) return existing;

  const deviceId = createDeviceId();
  window.localStorage.setItem(SYNC_DEVICE_ID_STORAGE_KEY, deviceId);
  return deviceId;
}

export function getDefaultSyncDeviceName(): string {
  if (typeof navigator === "undefined") return "This device";
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform || navigator.platform;
  return platform?.trim() || "This device";
}
