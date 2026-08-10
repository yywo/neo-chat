// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GlobalSearchModalFrame } from "@/components/search/GlobalSearchModalFrame";

function ModalHarness() {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open search
      </button>
      {open && (
        <GlobalSearchModalFrame
          labelledBy="test-search-title"
          initialFocusRef={inputRef}
          onClose={() => setOpen(false)}
        >
          <h2 id="test-search-title">Search</h2>
          <input ref={inputRef} aria-label="Search input" />
          <button type="button">Last action</button>
        </GlobalSearchModalFrame>
      )}
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("global search modal", () => {
  it("portals an accessible dialog, focuses search, traps focus, and restores the opener", async () => {
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
      {} as DOMRect,
    ] as unknown as DOMRectList);
    render(<ModalHarness />);

    const opener = screen.getByRole("button", { name: "Open search" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = await screen.findByRole("dialog", { name: "Search" });
    const input = screen.getByRole("textbox", { name: "Search input" });
    const lastAction = screen.getByRole("button", { name: "Last action" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.body.contains(dialog)).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(document.body.style.overflow).toBe("hidden");

    lastAction.focus();
    fireEvent.keyDown(lastAction, { key: "Tab" });
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(document.body.contains(dialog)).toBe(false));
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe("");
  });

  it("closes only when the backdrop itself is pressed", async () => {
    render(<ModalHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Open search" }));

    const dialog = await screen.findByRole("dialog", { name: "Search" });
    fireEvent.mouseDown(dialog);
    expect(document.body.contains(dialog)).toBe(true);

    fireEvent.mouseDown(screen.getByTestId("global-search-backdrop"));
    await waitFor(() => expect(document.body.contains(dialog)).toBe(false));
  });

  it("includes reduced-motion and mobile safe-area containment", async () => {
    render(<ModalHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Open search" }));

    const backdrop = await screen.findByTestId("global-search-backdrop");
    const dialog = screen.getByRole("dialog", { name: "Search" });
    expect(backdrop.className).toContain("env(safe-area-inset-bottom)");
    expect(backdrop.className).toContain("env(safe-area-inset-top)");
    expect(backdrop.className).toContain("motion-reduce:animate-none");
    expect(dialog.className).toContain("100dvh");
    expect(dialog.className).toContain("motion-reduce:animate-none");
  });
});
