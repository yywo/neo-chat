// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SecretInput } from "../components/settings/SettingsUI";
import {
  LOCAL_SECRET_ERROR_CODES,
  LocalSecretError,
} from "../lib/security/localSecrets";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("SecretInput", () => {
  afterEach(() => cleanup());

  it("shows the secure-context error and retains the key after a failed save", async () => {
    const onSave = vi
      .fn()
      .mockRejectedValue(
        new LocalSecretError(
          LOCAL_SECRET_ERROR_CODES.secureContextRequired,
          "secure context required",
        ),
      );

    render(
      <SecretInput
        id="api-key"
        name="apiKey"
        placeholder="enter key"
        hasSecret={false}
        onSave={onSave}
      />,
    );

    const input = screen.getByPlaceholderText("enter key");
    fireEvent.change(input, { target: { value: "test-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "saveSecret" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "secretSaveRequiresSecureContext",
      ),
    );
    expect((input as HTMLInputElement).value).toBe("test-secret");
    expect(onSave).toHaveBeenCalledWith("test-secret");
  });

  it("shows a generic storage error for other save failures", async () => {
    render(
      <SecretInput
        id="api-key"
        name="apiKey"
        placeholder="enter key"
        hasSecret={false}
        onSave={() => Promise.reject(new Error("IndexedDB denied"))}
      />,
    );

    const input = screen.getByPlaceholderText("enter key");
    fireEvent.change(input, { target: { value: "test-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "saveSecret" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "secretSaveFailed",
      ),
    );
  });
});
