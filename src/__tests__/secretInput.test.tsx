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

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("SecretInput", () => {
  afterEach(() => cleanup());

  it("shows an error and retains the key after a failed save", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("IndexedDB denied"));

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
        "secretSaveFailed",
      ),
    );
    expect((input as HTMLInputElement).value).toBe("test-secret");
    expect(onSave).toHaveBeenCalledWith("test-secret");
  });

  it("clears the input after a successful save", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
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

    await waitFor(() => expect((input as HTMLInputElement).value).toBe(""));
    expect(onSave).toHaveBeenCalledWith("test-secret");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
