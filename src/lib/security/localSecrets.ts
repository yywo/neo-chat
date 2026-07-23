import { gcm } from "@noble/ciphers/aes";
import { base64UrlToBytes, bytesToBase64Url } from "../byok/encoding";

export const LOCAL_SECRET_ALG = "A256GCM" as const;

export interface LocalEncryptedSecretEnvelope {
  v: 1;
  alg: typeof LOCAL_SECRET_ALG;
  keyId: string;
  iv: string;
  ciphertext: string;
  context: string;
}

export const LOCAL_SECRET_CONTEXTS = {
  providerApiKey: (providerId: string) =>
    `local:provider:${providerId}:api-key`,
  searchApiKey: (provider: string) => `local:search:${provider}:api-key`,
  ragToken: "local:rag:token",
  mineruApiToken: "local:docs:mineru:api-token",
  llamaParseApiKey: "local:docs:llama-parse:api-key",
  elevenLabsApiKey: "local:voice:elevenlabs:api-key",
  mimoApiKey: "local:voice:mimo:api-key",
  pluginAuth: (pluginId: string) => `local:plugin:${pluginId}:auth`,
} as const;

const DB_NAME = "neo-chat-local-secrets";
const DB_VERSION = 1;
const STORE_NAME = "crypto_keys";
const MASTER_KEY_RECORD_ID = "default";
const FALLBACK_KEY_RECORD_ID = "http_fallback";
const RAW_KEY_LENGTH = 32;

type KeySlot = typeof MASTER_KEY_RECORD_ID | typeof FALLBACK_KEY_RECORD_ID;

type WebCryptoKeyMaterial = {
  id: string;
  kind: "webcrypto";
  key: CryptoKey;
};

type RawKeyMaterial = {
  id: string;
  kind: "raw";
  key: Uint8Array;
};

type LocalKeyMaterial = WebCryptoKeyMaterial | RawKeyMaterial;

type StoredKeyRecord = {
  id: string;
  keyId: string;
  key?: CryptoKey;
  rawKey?: Uint8Array;
};

declare global {
  // Used only when IndexedDB is unavailable, such as SSR or unit tests.
  var __neoChatLocalSecretKeyMaterial: LocalKeyMaterial | undefined;
  var __neoChatLocalSecretFallbackKeyMaterial: LocalKeyMaterial | undefined;
}

const keyMaterialPromises = new Map<KeySlot, Promise<LocalKeyMaterial>>();

function getCrypto(): Crypto {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error(
      "Cryptographically secure randomness is required for local secrets.",
    );
  }
  return globalThis.crypto;
}

function getPreferredKeySlot(): KeySlot {
  return globalThis.crypto?.subtle
    ? MASTER_KEY_RECORD_ID
    : FALLBACK_KEY_RECORD_ID;
}

function getMemoryKey(slot: KeySlot): LocalKeyMaterial | undefined {
  return slot === MASTER_KEY_RECORD_ID
    ? globalThis.__neoChatLocalSecretKeyMaterial
    : globalThis.__neoChatLocalSecretFallbackKeyMaterial;
}

function setMemoryKey(
  slot: KeySlot,
  material: LocalKeyMaterial | undefined,
): void {
  if (slot === MASTER_KEY_RECORD_ID) {
    globalThis.__neoChatLocalSecretKeyMaterial = material;
  } else {
    globalThis.__neoChatLocalSecretFallbackKeyMaterial = material;
  }
}

function getIndexedDb(): IDBFactory | undefined {
  return typeof indexedDB !== "undefined" ? indexedDB : undefined;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("IndexedDB failed"));
  });
}

function openDb(): Promise<IDBDatabase> {
  const dbFactory = getIndexedDb();
  if (!dbFactory) {
    return Promise.reject(new Error("IndexedDB is unavailable"));
  }

  return new Promise((resolve, reject) => {
    const request = dbFactory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("IndexedDB failed"));
  });
}

async function readStoredKey(slot: KeySlot): Promise<LocalKeyMaterial | null> {
  if (!getIndexedDb()) return null;

  const db = await openDb();
  try {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const record = await requestToPromise<StoredKeyRecord | undefined>(
      store.get(slot),
    );
    if (!record) return null;
    if (record.rawKey?.byteLength === RAW_KEY_LENGTH) {
      return {
        id: record.keyId,
        kind: "raw",
        key: new Uint8Array(record.rawKey),
      };
    }
    return record.key
      ? { id: record.keyId, kind: "webcrypto", key: record.key }
      : null;
  } finally {
    db.close();
  }
}

async function writeStoredKey(
  slot: KeySlot,
  material: LocalKeyMaterial,
): Promise<void> {
  if (!getIndexedDb()) {
    setMemoryKey(slot, material);
    return;
  }

  const db = await openDb();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const record: StoredKeyRecord = {
      id: slot,
      keyId: material.id,
      ...(material.kind === "raw"
        ? { rawKey: material.key }
        : { key: material.key }),
    };
    await requestToPromise(store.put(record));
  } finally {
    db.close();
  }
}

function createKeyId(): string {
  const crypto = getCrypto();
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return bytesToBase64Url(bytes);
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

async function createMasterKey(slot: KeySlot): Promise<LocalKeyMaterial> {
  const crypto = getCrypto();
  if (slot === FALLBACK_KEY_RECORD_ID) {
    return {
      id: createKeyId(),
      kind: "raw",
      key: crypto.getRandomValues(new Uint8Array(RAW_KEY_LENGTH)),
    };
  }

  if (!crypto.subtle) {
    throw new Error("WebCrypto is unavailable for the secure local key slot.");
  }
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  return { id: createKeyId(), kind: "webcrypto", key };
}

async function loadKeyMaterial(slot: KeySlot): Promise<LocalKeyMaterial> {
  const memoryKey = getMemoryKey(slot);
  if (memoryKey) {
    return memoryKey;
  }

  if (!getIndexedDb()) {
    const material = await createMasterKey(slot);
    setMemoryKey(slot, material);
    return material;
  }

  const stored = await readStoredKey(slot);
  if (stored) {
    setMemoryKey(slot, stored);
    return stored;
  }

  const material = await createMasterKey(slot);
  await writeStoredKey(slot, material);
  setMemoryKey(slot, material);
  return material;
}

async function getKeyMaterial(slot: KeySlot): Promise<LocalKeyMaterial> {
  let promise = keyMaterialPromises.get(slot);
  if (!promise) {
    promise = loadKeyMaterial(slot).catch((error) => {
      keyMaterialPromises.delete(slot);
      throw error;
    });
    keyMaterialPromises.set(slot, promise);
  }

  return promise;
}

async function getKeyMaterialById(keyId: string): Promise<LocalKeyMaterial> {
  for (const slot of [MASTER_KEY_RECORD_ID, FALLBACK_KEY_RECORD_ID] as const) {
    const memoryKey = getMemoryKey(slot);
    if (memoryKey?.id === keyId) return memoryKey;
  }

  if (getIndexedDb()) {
    for (const slot of [
      MASTER_KEY_RECORD_ID,
      FALLBACK_KEY_RECORD_ID,
    ] as const) {
      const stored = await readStoredKey(slot);
      if (!stored) continue;
      setMemoryKey(slot, stored);
      if (stored.id === keyId) return stored;
    }
  }

  throw new Error("Local secret key id mismatch");
}

export function clearLocalSecretKeyCache(): void {
  keyMaterialPromises.clear();
}

export async function deleteLocalSecretMasterKey(): Promise<void> {
  keyMaterialPromises.clear();
  setMemoryKey(MASTER_KEY_RECORD_ID, undefined);
  setMemoryKey(FALLBACK_KEY_RECORD_ID, undefined);

  if (!getIndexedDb()) return;

  const db = await openDb();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    await Promise.all([
      requestToPromise(store.delete(MASTER_KEY_RECORD_ID)),
      requestToPromise(store.delete(FALLBACK_KEY_RECORD_ID)),
    ]);
  } finally {
    db.close();
  }
}

export function isLocalEncryptedSecretEnvelope(
  value: unknown,
): value is LocalEncryptedSecretEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const envelope = value as Partial<LocalEncryptedSecretEnvelope>;
  return (
    envelope.v === 1 &&
    envelope.alg === LOCAL_SECRET_ALG &&
    typeof envelope.keyId === "string" &&
    envelope.keyId.length > 0 &&
    typeof envelope.iv === "string" &&
    envelope.iv.length > 0 &&
    typeof envelope.ciphertext === "string" &&
    envelope.ciphertext.length > 0 &&
    typeof envelope.context === "string" &&
    envelope.context.length > 0
  );
}

export function hasLocalSecret(
  value: unknown,
): value is LocalEncryptedSecretEnvelope {
  return isLocalEncryptedSecretEnvelope(value);
}

export async function encryptLocalSecret(
  secret: string | undefined,
  context: string,
): Promise<LocalEncryptedSecretEnvelope | undefined> {
  const trimmed = secret?.trim();
  if (!trimmed) return undefined;

  const crypto = getCrypto();
  const { id, kind, key } = await getKeyMaterial(getPreferredKeySlot());
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const additionalData = encoder.encode(context);
  const plaintext = encoder.encode(trimmed);
  const ciphertext =
    kind === "raw"
      ? gcm(key, iv, additionalData).encrypt(plaintext)
      : new Uint8Array(
          await crypto.subtle.encrypt(
            {
              name: "AES-GCM",
              iv,
              additionalData,
            },
            key,
            plaintext,
          ),
        );

  return {
    v: 1,
    alg: LOCAL_SECRET_ALG,
    keyId: id,
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(ciphertext),
    context,
  };
}

export async function decryptLocalSecret(
  envelope: LocalEncryptedSecretEnvelope | undefined,
  expectedContext: string,
): Promise<string | undefined> {
  if (!envelope) return undefined;
  if (!isLocalEncryptedSecretEnvelope(envelope)) {
    throw new Error("Invalid local secret envelope");
  }
  if (envelope.context !== expectedContext) {
    throw new Error("Local secret context mismatch");
  }

  const crypto = getCrypto();
  const { kind, key } = await getKeyMaterialById(envelope.keyId);
  const iv = base64UrlToBytes(envelope.iv);
  const ciphertext = base64UrlToBytes(envelope.ciphertext);
  const additionalData = new TextEncoder().encode(expectedContext);
  const plaintext =
    kind === "raw"
      ? gcm(key, iv, additionalData).decrypt(ciphertext)
      : new Uint8Array(
          await crypto.subtle.decrypt(
            {
              name: "AES-GCM",
              iv: bytesToArrayBuffer(iv),
              additionalData,
            },
            key,
            bytesToArrayBuffer(ciphertext),
          ),
        );

  return new TextDecoder().decode(plaintext);
}
