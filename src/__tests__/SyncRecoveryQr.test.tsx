/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SyncRecoveryQr from "@/components/sync/SyncRecoveryQr";

afterEach(cleanup);

describe("SyncRecoveryQr", () => {
  it("renders the generated image with an accessible name", async () => {
    const renderQr = vi
      .fn()
      .mockResolvedValue("data:image/png;base64,cWItcGF5bG9hZA==");

    render(
      <SyncRecoveryQr
        payload="neo-sync-v1.payload.checksum"
        alt="Recovery QR code"
        loadingLabel="Creating QR code"
        errorLabel="QR code failed"
        renderQr={renderQr}
      />,
    );

    expect(screen.getByRole("status").textContent).toBe("Creating QR code");
    const image = await screen.findByRole("img", {
      name: "Recovery QR code",
    });
    expect(renderQr).toHaveBeenCalledWith("neo-sync-v1.payload.checksum");
    expect(image.getAttribute("src")).toBe(
      "data:image/png;base64,cWItcGF5bG9hZA==",
    );
  });
});
