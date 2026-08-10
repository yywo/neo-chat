import { describe, expect, it } from "vitest";
import {
  decryptSyncBytes,
  deriveOpaqueObjectName,
  deriveVaultId,
  encryptSyncBytes,
  generateRecoveryCode,
  parseRecoveryCode,
  splitSyncChunks,
} from "@/lib/sync/crypto";

describe("encrypted sync cryptography", () => {
  it("generates and validates a 256-bit checksummed recovery code", async () => {
    const { rootKey, recoveryCode } = await generateRecoveryCode();

    expect(rootKey).toHaveLength(32);
    expect(recoveryCode).toMatch(
      /^neo-sync-v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{7}$/,
    );
    expect(await parseRecoveryCode(recoveryCode)).toEqual(rootKey);

    const tampered = `${recoveryCode.slice(0, -1)}${
      recoveryCode.endsWith("A") ? "B" : "A"
    }`;
    await expect(parseRecoveryCode(tampered)).rejects.toThrow(/checksum/i);
  });

  it("binds ciphertext to its object type and logical id", async () => {
    const { rootKey } = await generateRecoveryCode();
    const plaintext = new TextEncoder().encode("local-first secret");
    const encrypted = await encryptSyncBytes(
      rootKey,
      plaintext,
      "crdt-document",
      "session:one",
    );

    expect(
      await decryptSyncBytes(
        rootKey,
        encrypted,
        "crdt-document",
        "session:one",
      ),
    ).toEqual(plaintext);
    await expect(
      decryptSyncBytes(rootKey, encrypted, "crdt-document", "session:two"),
    ).rejects.toThrow(/metadata/i);
  });

  it("derives stable opaque names without exposing logical identifiers", async () => {
    const { rootKey } = await generateRecoveryCode();
    const first = await deriveOpaqueObjectName(
      rootKey,
      "session:private-title",
    );
    const second = await deriveOpaqueObjectName(
      rootKey,
      "session:private-title",
    );
    const other = await deriveOpaqueObjectName(rootKey, "session:other");

    expect(first).toBe(second);
    expect(first).not.toBe(other);
    expect(first).not.toContain("private-title");
    expect(await deriveVaultId(rootKey)).toHaveLength(32);
  });

  it("splits large files into deterministic bounded chunks", () => {
    const bytes = new Uint8Array(10).map((_, index) => index);
    expect(splitSyncChunks(bytes, 4).map((chunk) => [...chunk])).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [8, 9],
    ]);
  });
});
