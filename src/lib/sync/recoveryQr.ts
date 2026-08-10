import type { QRCodeToDataURLOptions } from "qrcode";
import { parseRecoveryCode } from "./crypto";

export const MAX_SYNC_RECOVERY_QR_PAYLOAD_LENGTH = 256;

export interface SyncRecoveryQrRenderer {
  toDataURL(payload: string, options?: QRCodeToDataURLOptions): Promise<string>;
}

export type SyncRecoveryQrLoader = () => Promise<
  SyncRecoveryQrRenderer | { default: SyncRecoveryQrRenderer }
>;

const QR_OPTIONS: QRCodeToDataURLOptions = {
  type: "image/png",
  errorCorrectionLevel: "M",
  margin: 2,
  width: 240,
  color: {
    dark: "#111827ff",
    light: "#ffffffff",
  },
};

const loadLocalQrRenderer: SyncRecoveryQrLoader = () =>
  import("qrcode") as Promise<SyncRecoveryQrRenderer>;

export async function validateSyncRecoveryQrPayload(
  payload: string,
): Promise<string> {
  const normalized = payload.trim();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_SYNC_RECOVERY_QR_PAYLOAD_LENGTH
  ) {
    throw new Error("Invalid sync recovery QR payload length.");
  }
  await parseRecoveryCode(normalized);
  return normalized;
}

export async function renderSyncRecoveryQrDataUrl(
  payload: string,
  loadRenderer: SyncRecoveryQrLoader = loadLocalQrRenderer,
): Promise<string> {
  // Validate before importing the renderer. Invalid or attacker-controlled
  // text never reaches the optional QR chunk or an oversized canvas request.
  const normalized = await validateSyncRecoveryQrPayload(payload);
  const loaded = await loadRenderer();
  const directRenderer = loaded as Partial<SyncRecoveryQrRenderer>;
  const renderer =
    typeof directRenderer.toDataURL === "function"
      ? (loaded as SyncRecoveryQrRenderer)
      : (loaded as { default: SyncRecoveryQrRenderer }).default;
  const dataUrl = await renderer.toDataURL(normalized, QR_OPTIONS);
  if (!dataUrl.startsWith("data:image/png;base64,")) {
    throw new Error("The local QR renderer returned an invalid image.");
  }
  return dataUrl;
}
