"use client";

import React, { useRef } from "react";
import { createPortal } from "react-dom";

import {
  trapModalFocus,
  useModalLifecycle,
} from "@/components/ui/useModalLifecycle";

export interface GlobalSearchModalFrameProps {
  labelledBy: string;
  initialFocusRef: React.RefObject<HTMLElement | null>;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: React.ReactNode;
}

export function GlobalSearchModalFrame({
  labelledBy,
  initialFocusRef,
  returnFocusRef,
  onClose,
  children,
}: GlobalSearchModalFrameProps) {
  const dialogRef = useRef<HTMLElement>(null);

  useModalLifecycle({
    open: true,
    dialogRef,
    initialFocusRef,
    returnFocusRef,
  });

  return createPortal(
    <div
      data-testid="global-search-backdrop"
      className="fixed inset-0 z-100 flex items-start justify-center overflow-hidden overscroll-contain bg-black/25 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-[2px] animate-in fade-in duration-150 motion-reduce:animate-none dark:bg-black/60 sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
            return;
          }
          trapModalFocus(event, dialogRef.current);
        }}
        className="flex h-full max-h-[52rem] w-full max-w-5xl flex-col overflow-hidden overscroll-contain rounded-2xl border border-border bg-background text-foreground shadow-2xl shadow-black/20 animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none sm:h-[min(52rem,calc(100dvh-3rem))]"
      >
        {children}
      </section>
    </div>,
    document.body,
  );
}
