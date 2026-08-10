import { describe, expect, it, vi } from "vitest";
import {
  MAX_SYNC_RECOVERY_QR_PAYLOAD_LENGTH,
  renderSyncRecoveryQrDataUrl,
  type SyncRecoveryQrLoader,
} from "@/lib/sync/recoveryQr";
import { generateRecoveryCode } from "@/lib/sync/crypto";

describe("sync recovery QR", () => {
  it("renders a validated recovery code as a local PNG data URL", async () => {
    const { recoveryCode } = await generateRecoveryCode();

    const dataUrl = await renderSyncRecoveryQrDataUrl(recoveryCode);

    expect(dataUrl).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
    expect(dataUrl.length).toBeGreaterThan(500);
  });

  it("passes the exact normalized payload to the lazy renderer", async () => {
    const { recoveryCode } = await generateRecoveryCode();
    const toDataURL = vi
      .fn()
      .mockResolvedValue("data:image/png;base64,cWItcGF5bG9hZA==");
    const loader = vi.fn(async () => ({ toDataURL }));

    await renderSyncRecoveryQrDataUrl(`  ${recoveryCode}\n`, loader);

    expect(loader).toHaveBeenCalledOnce();
    expect(toDataURL).toHaveBeenCalledWith(
      recoveryCode,
      expect.objectContaining({
        type: "image/png",
        errorCorrectionLevel: "M",
        margin: 2,
        width: 240,
      }),
    );
  });

  it("rejects malformed or oversized text before loading QR code", async () => {
    const loader = vi.fn<SyncRecoveryQrLoader>();

    await expect(
      renderSyncRecoveryQrDataUrl("not-a-recovery-code", loader),
    ).rejects.toThrow();
    await expect(
      renderSyncRecoveryQrDataUrl(
        "x".repeat(MAX_SYNC_RECOVERY_QR_PAYLOAD_LENGTH + 1),
        loader,
      ),
    ).rejects.toThrow("payload length");
    expect(loader).not.toHaveBeenCalled();
  });
});
