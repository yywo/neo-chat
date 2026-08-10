"use client";

import dynamic from "next/dynamic";
import { memo } from "react";
import type { MarkdownRendererProps } from "./MarkdownRendererClient";

const MarkdownRendererClient = dynamic<MarkdownRendererProps>(
  () => import("./MarkdownRendererClient"),
  {
    ssr: false,
  },
);

export type { MarkdownRendererProps };

const MarkdownRenderer = memo(function MarkdownRenderer(
  props: MarkdownRendererProps,
) {
  return <MarkdownRendererClient {...props} />;
});

export default MarkdownRenderer;
