import { base64UrlToBytes, bytesToBase64Url } from "@/lib/byok/encoding";
import {
  SYNC_CHUNK_BYTES,
  SYNC_FORMAT_VERSION,
  type EncryptedSyncObject,
} from "./types";

const RECOVERY_PREFIX = "neo-sync-v1";
const HKDF_SALT = new TextEncoder().encode("neo-chat-sync-format-v1");

function getCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error("WebCrypto is required for encrypted sync.");
  }
  return globalThis.crypto;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const output = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(output).set(bytes);
  return output;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await getCrypto().subtle.digest("SHA-256", toArrayBuffer(bytes)),
  );
}

export async function sha256Base64Url(bytes: Uint8Array): Promise<string> {
  return bytesToBase64Url(await sha256(bytes));
}

async function recoveryChecksum(payload: string): Promise<string> {
  const digest = await sha256(
    new TextEncoder().encode(`${RECOVERY_PREFIX}:${payload}`),
  );
  return bytesToBase64Url(digest.subarray(0, 5));
}

export async function formatRecoveryCode(rootKey: Uint8Array): Promise<string> {
  if (rootKey.byteLength !== 32) {
    throw new Error("A sync recovery key must contain exactly 256 bits.");
  }
  const payload = bytesToBase64Url(rootKey);
  return `${RECOVERY_PREFIX}.${payload}.${await recoveryChecksum(payload)}`;
}

export async function generateRecoveryCode(): Promise<{
  rootKey: Uint8Array;
  recoveryCode: string;
}> {
  const rootKey = getCrypto().getRandomValues(new Uint8Array(32));
  return { rootKey, recoveryCode: await formatRecoveryCode(rootKey) };
}

export async function parseRecoveryCode(code: string): Promise<Uint8Array> {
  const normalized = code.trim();
  const [prefix, payload, checksum, extra] = normalized.split(".");
  if (prefix !== RECOVERY_PREFIX || !payload || !checksum || extra) {
    throw new Error("Invalid sync recovery code.");
  }
  if ((await recoveryChecksum(payload)) !== checksum) {
    throw new Error("Sync recovery code checksum does not match.");
  }
  const bytes = base64UrlToBytes(payload);
  if (bytes.byteLength !== 32) {
    throw new Error("Sync recovery code must contain a 256-bit key.");
  }
  return bytes;
}

async function importHkdfRoot(rootKey: Uint8Array): Promise<CryptoKey> {
  if (rootKey.byteLength !== 32) throw new Error("Invalid sync root key.");
  return getCrypto().subtle.importKey(
    "raw",
    toArrayBuffer(rootKey),
    "HKDF",
    false,
    ["deriveKey"],
  );
}

async function deriveAesKey(
  rootKey: Uint8Array,
  purpose: string,
): Promise<CryptoKey> {
  return getCrypto().subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: HKDF_SALT,
      info: new TextEncoder().encode(`aes:${purpose}`),
    },
    await importHkdfRoot(rootKey),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function deriveHmacKey(rootKey: Uint8Array): Promise<CryptoKey> {
  return getCrypto().subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: HKDF_SALT,
      info: new TextEncoder().encode("hmac:object-name"),
    },
    await importHkdfRoot(rootKey),
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
}

export async function deriveOpaqueObjectName(
  rootKey: Uint8Array,
  logicalName: string,
): Promise<string> {
  const signature = await getCrypto().subtle.sign(
    "HMAC",
    await deriveHmacKey(rootKey),
    new TextEncoder().encode(logicalName),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function deriveVaultId(rootKey: Uint8Array): Promise<string> {
  return (await deriveOpaqueObjectName(rootKey, "vault-id")).slice(0, 32);
}

export async function encryptSyncBytes(
  rootKey: Uint8Array,
  plaintext: Uint8Array,
  objectType: string,
  logicalId: string,
): Promise<EncryptedSyncObject> {
  const iv = getCrypto().getRandomValues(new Uint8Array(12));
  const aad = `neo-chat-sync:${SYNC_FORMAT_VERSION}:${objectType}:${logicalId}`;
  const ciphertext = await getCrypto().subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(aad),
    },
    await deriveAesKey(rootKey, objectType),
    toArrayBuffer(plaintext),
  );
  return {
    formatVersion: SYNC_FORMAT_VERSION,
    algorithm: "A256GCM",
    iv: bytesToBase64Url(iv),
    aad,
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    plaintextBytes: plaintext.byteLength,
  };
}

export async function decryptSyncBytes(
  rootKey: Uint8Array,
  envelope: EncryptedSyncObject,
  objectType: string,
  logicalId: string,
): Promise<Uint8Array> {
  const expectedAad = `neo-chat-sync:${SYNC_FORMAT_VERSION}:${objectType}:${logicalId}`;
  if (
    envelope.formatVersion !== SYNC_FORMAT_VERSION ||
    envelope.algorithm !== "A256GCM" ||
    envelope.aad !== expectedAad
  ) {
    throw new Error("Encrypted sync object metadata does not match.");
  }
  const plaintext = await getCrypto().subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(base64UrlToBytes(envelope.iv)),
      additionalData: new TextEncoder().encode(expectedAad),
    },
    await deriveAesKey(rootKey, objectType),
    toArrayBuffer(base64UrlToBytes(envelope.ciphertext)),
  );
  const bytes = new Uint8Array(plaintext);
  if (bytes.byteLength !== envelope.plaintextBytes) {
    throw new Error("Encrypted sync object length does not match.");
  }
  return bytes;
}

export function splitSyncChunks(
  bytes: Uint8Array,
  chunkBytes = SYNC_CHUNK_BYTES,
): Uint8Array[] {
  if (!Number.isInteger(chunkBytes) || chunkBytes <= 0) {
    throw new Error("Sync chunk size must be a positive integer.");
  }
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += chunkBytes) {
    chunks.push(
      bytes.slice(offset, Math.min(bytes.byteLength, offset + chunkBytes)),
    );
  }
  return chunks.length ? chunks : [new Uint8Array()];
}
