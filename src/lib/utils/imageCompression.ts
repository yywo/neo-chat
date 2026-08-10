"use client";

import type { Options as BrowserImageCompressionOptions } from "browser-image-compression";
import type { Attachment, SystemSettings } from "@/types";
import { normalizeSystemSettings } from "@/lib/settings/appConfig";
import { base64ToBytes, bytesToArrayBuffer, bytesToBase64 } from "./binary";
import { logDevWarn } from "./devLogger";
import { ensureImageDisplayCache } from "./imageDisplayCache";
import { isOPFSUrl, resolveOPFSBlob } from "@/utils/opfs";

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/bmp",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const BYTES_PER_MEGABYTE = 1024 * 1024;

export interface ImageCompressionConfig {
  enabled: boolean;
  maxSizeMB: number;
  maxWidthOrHeight: number;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

export type ImageCompressor = (
  file: File,
  options: BrowserImageCompressionOptions,
) => Promise<File>;

export interface ImageCompressionRuntimeOptions {
  signal?: AbortSignal;
  readDimensions?: (file: File) => Promise<ImageDimensions>;
  compress?: ImageCompressor;
}

type ResolveOPFSBlob = (url: string) => Promise<Blob | null>;
type SaveFile = (file: File, prefix?: string) => Promise<string>;
type DeleteFile = (url?: string) => Promise<void>;

export interface PrepareImageAttachmentsOptions extends ImageCompressionRuntimeOptions {
  prefix?: string;
  resolveOPFSBlob?: ResolveOPFSBlob;
  saveFile?: SaveFile;
  deleteFile?: DeleteFile;
  now?: () => number;
}

function createAbortError(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  if (typeof DOMException !== "undefined") {
    return new DOMException("The operation was aborted", "AbortError");
  }
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (typeof signal.throwIfAborted === "function") {
    signal.throwIfAborted();
  }
  throw createAbortError(signal);
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function createFile(
  parts: BlobPart[],
  fileName: string,
  options: FilePropertyBag,
): File {
  if (typeof File !== "undefined") {
    return new File(parts, fileName, options);
  }

  const blob = new Blob(parts, { type: options.type });
  return Object.assign(blob, {
    name: fileName,
    lastModified: options.lastModified ?? Date.now(),
  }) as File;
}

async function readDimensionsWithImageElement(
  file: File,
  signal?: AbortSignal,
): Promise<ImageDimensions> {
  if (typeof Image === "undefined" || typeof URL === "undefined") {
    throw new Error("Image dimensions are unavailable");
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    return await new Promise<ImageDimensions>((resolve, reject) => {
      const image = new Image();
      let settled = false;

      const cleanup = () => {
        image.onload = null;
        image.onerror = null;
        signal?.removeEventListener("abort", onAbort);
      };
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };
      const onAbort = () => finish(() => reject(createAbortError(signal)));

      image.onload = () =>
        finish(() =>
          resolve({
            width: image.naturalWidth,
            height: image.naturalHeight,
          }),
        );
      image.onerror = () =>
        finish(() => reject(new Error("Failed to read image dimensions")));
      signal?.addEventListener("abort", onAbort, { once: true });
      image.src = objectUrl;

      if (signal?.aborted) onAbort();
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function readImageDimensions(
  file: File,
  signal?: AbortSignal,
): Promise<ImageDimensions> {
  throwIfAborted(signal);

  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      throwIfAborted(signal);
      return dimensions;
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
    }
  }

  return readDimensionsWithImageElement(file, signal);
}

function hasExtremeAspectRatio({ width, height }: ImageDimensions): boolean {
  return width > height * 5 || height > width * 5;
}

function isSupportedImage(file: File): boolean {
  return SUPPORTED_IMAGE_MIME_TYPES.has(file.type.toLowerCase());
}

function createCompressionOptions(
  file: File,
  config: ImageCompressionConfig,
  dimensions: ImageDimensions,
  signal?: AbortSignal,
): BrowserImageCompressionOptions {
  const options: BrowserImageCompressionOptions = {
    maxSizeMB: config.maxSizeMB,
    useWebWorker: false,
    preserveExif: false,
    fileType: file.type,
    ...(signal ? { signal } : {}),
  };

  if (!hasExtremeAspectRatio(dimensions)) {
    options.maxWidthOrHeight = config.maxWidthOrHeight;
  }

  return options;
}

export function getImageCompressionConfig(
  systemSettings: Partial<SystemSettings> | undefined,
): ImageCompressionConfig {
  const normalized = normalizeSystemSettings(systemSettings);
  return {
    enabled: normalized.enableAutoImageCompression,
    maxSizeMB: normalized.imageCompressionMaxSizeMB,
    maxWidthOrHeight: normalized.imageCompressionMaxWidthOrHeight,
  };
}

export async function compressImageFile(
  file: File,
  config: ImageCompressionConfig,
  runtime: ImageCompressionRuntimeOptions = {},
): Promise<File> {
  const { signal } = runtime;
  throwIfAborted(signal);

  if (!config.enabled || !isSupportedImage(file)) return file;

  try {
    const dimensions = await (
      runtime.readDimensions || ((input) => readImageDimensions(input, signal))
    )(file);
    throwIfAborted(signal);

    const extremeAspectRatio = hasExtremeAspectRatio(dimensions);
    const exceedsSize = file.size > config.maxSizeMB * BYTES_PER_MEGABYTE;
    const exceedsDimensions =
      !extremeAspectRatio &&
      Math.max(dimensions.width, dimensions.height) > config.maxWidthOrHeight;

    if (!exceedsSize && !exceedsDimensions) return file;

    const options = createCompressionOptions(file, config, dimensions, signal);
    const compressor =
      runtime.compress || (await import("browser-image-compression")).default;
    throwIfAborted(signal);

    const compressed = await compressor(file, options);
    throwIfAborted(signal);
    if (
      compressed.size >= file.size ||
      compressed.type.toLowerCase() !== file.type.toLowerCase()
    ) {
      return file;
    }

    return createFile([compressed], file.name, {
      type: file.type,
      lastModified: file.lastModified,
    });
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    logDevWarn("Failed to compress image; using the original file", error);
    return file;
  }
}

async function createAttachmentFile(
  attachment: Attachment,
  options: PrepareImageAttachmentsOptions,
): Promise<File | null> {
  if (attachment.data) {
    const bytes = base64ToBytes(attachment.data);
    return createFile([bytesToArrayBuffer(bytes)], attachment.fileName, {
      type: attachment.mimeType,
    });
  }

  if (!attachment.url || !isOPFSUrl(attachment.url)) return null;

  const blob = await (options.resolveOPFSBlob || resolveOPFSBlob)(
    attachment.url,
  );
  if (!blob) return null;

  return createFile([blob], attachment.fileName, {
    type: attachment.mimeType || blob.type,
  });
}

export async function compressImageAttachment(
  attachment: Attachment,
  config: ImageCompressionConfig,
  options: PrepareImageAttachmentsOptions = {},
): Promise<Attachment> {
  throwIfAborted(options.signal);
  if (
    !config.enabled ||
    !attachment.mimeType.toLowerCase().startsWith("image/")
  ) {
    return attachment;
  }

  try {
    const file = await createAttachmentFile(attachment, options);
    throwIfAborted(options.signal);
    if (!file) return attachment;

    const compressed = await compressImageFile(file, config, options);
    if (compressed === file) return attachment;

    const data = bytesToBase64(new Uint8Array(await compressed.arrayBuffer()));
    throwIfAborted(options.signal);

    const updated = {
      ...attachment,
      mimeType: file.type,
      fileName: file.name,
      data,
    };
    delete updated.url;
    delete updated.displayCache;
    return updated;
  } catch (error) {
    if (isAbortError(error, options.signal)) throw error;
    logDevWarn(
      "Failed to prepare image attachment; using the original attachment",
      error,
    );
    return attachment;
  }
}

async function prepareImageAttachments(
  attachments: Attachment[],
  config: ImageCompressionConfig,
  defaultPrefix: string,
  options: PrepareImageAttachmentsOptions = {},
): Promise<Attachment[]> {
  const compressedAttachments = await compressImageAttachments(
    attachments,
    config,
    options,
  );
  const prepared: Attachment[] = [];

  for (const attachment of compressedAttachments) {
    throwIfAborted(options.signal);
    const cached = await ensureImageDisplayCache(attachment, {
      prefix: options.prefix || defaultPrefix,
      saveFile: options.saveFile,
      deleteFile: options.deleteFile,
      now: options.now,
      signal: options.signal,
    });
    prepared.push(cached);
  }

  return prepared;
}

export async function compressImageAttachments(
  attachments: Attachment[],
  config: ImageCompressionConfig,
  options: PrepareImageAttachmentsOptions = {},
): Promise<Attachment[]> {
  const compressed: Attachment[] = [];

  for (const attachment of attachments) {
    throwIfAborted(options.signal);
    compressed.push(await compressImageAttachment(attachment, config, options));
  }

  return compressed;
}

export async function prepareConversationImageAttachments(
  attachments: Attachment[],
  config: ImageCompressionConfig,
  options: PrepareImageAttachmentsOptions = {},
): Promise<Attachment[]> {
  return prepareImageAttachments(attachments, config, "chat/images", options);
}

export async function prepareGeneratedImageAttachments(
  attachments: Attachment[],
  config: ImageCompressionConfig,
  options: PrepareImageAttachmentsOptions = {},
): Promise<Attachment[]> {
  return prepareImageAttachments(
    attachments,
    config,
    "images/generated",
    options,
  );
}
