// @vitest-environment node
/** Device crypto (offline devices spec §7.3): keys wrapped by password, server secret or passkey; a sealed outbox. */
import { describe, expect, it } from "vitest";
import {
  MIN_PASSWORD_LENGTH, PBKDF2_ITERATIONS, newDataKey, newOutboxKeyPair, open, openWithPrivate, seal, sealToPublic,
  unwrapOutboxKey, unwrapWithPassword, unwrapWithPrf, unwrapWithSecret, validPassword, wrapWithPassword, wrapWithPrf, wrapWithSecret,
} from "../src/device/crypto.ts";

const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill);

describe("device crypto", () => {
  it("pins the spec's password rules", () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
    expect(MIN_PASSWORD_LENGTH).toBe(8);
  });

  it("short digit codes are refused as passwords", () => {
    expect(validPassword("123456")).toBe(false);
    expect(validPassword("1234")).toBe(false);
    expect(validPassword("abc123")).toBe(false); // too short
    expect(validPassword("tablet42!")).toBe(true);
    // Digits only fall to a copied disk in hours even at 8+ (review finding): letters or symbols are required.
    expect(validPassword("12345678")).toBe(false);
    expect(validPassword("20180301")).toBe(false);
    expect(validPassword("noa-2018")).toBe(true);
  });

  it("a data key round-trips through password, secret and passkey wraps", async () => {
    const key = await newDataKey();
    const sealed = await seal(key, { name: "Noa" });
    const pw = await wrapWithPassword(key, "tablet42!", bytes(16, 1), 1000);
    const sec = await wrapWithSecret(key, bytes(32, 2));
    const prf = await wrapWithPrf(key, bytes(32, 3));
    for (const k of [await unwrapWithPassword(pw, "tablet42!"), await unwrapWithSecret(sec, bytes(32, 2)), await unwrapWithPrf(prf, bytes(32, 3))]) {
      expect(await open(k, sealed)).toEqual({ name: "Noa" });
    }
    await expect(unwrapWithPassword(pw, "wrong-pass")).rejects.toThrow();
    await expect(unwrapWithSecret(sec, bytes(32, 9))).rejects.toThrow();
  });

  it("the outbox can be sealed with only the public key and opened only with the private key", async () => {
    const pair = await newOutboxKeyPair(bytes(32, 4));
    const s = await sealToPublic(pair.publicKey, { session_id: "x", accuracy: 0.8 });
    expect(JSON.stringify(s)).not.toContain("accuracy");
    const priv = await unwrapOutboxKey(pair.wrappedPrivate, bytes(32, 4));
    expect(await openWithPrivate(priv, s)).toEqual({ session_id: "x", accuracy: 0.8 });
    const other = await newOutboxKeyPair(bytes(32, 5));
    await expect(openWithPrivate(await unwrapOutboxKey(other.wrappedPrivate, bytes(32, 5)), s)).rejects.toThrow();
    await expect(unwrapOutboxKey(pair.wrappedPrivate, bytes(32, 6))).rejects.toThrow();
  });
});
