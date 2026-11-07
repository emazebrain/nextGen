/**
 * Device crypto (offline devices spec §7.3; ADR 0019). WebCrypto only.
 *
 * Each therapist space has a random AES-GCM data key. It is stored only wrapped: by the therapist's offline password
 * (PBKDF2), by the server's space secret (an online sign-in), and by a passkey's PRF output where the platform has one.
 * Threat model: a determined thief with a copy of the device's storage — so passwords are 8+ characters and the
 * PBKDF2 cost is high; the in-app lockout is only a usability guard.
 *
 * The device outbox is sealed to an ECDH P-256 public key, so a session can write results offline, while the private
 * key is wrapped by a secret the server hands only to a signed-in staff member on this device.
 */

export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSWORD_LENGTH = 8;

export interface Wrapped {
  /** base64 */
  iv: string;
  data: string;
  salt?: string;
  iterations?: number;
}
export interface Sealed {
  iv: string;
  data: string;
}
export interface SealedForDevice extends Sealed {
  /** the sender's ephemeral P-256 public key, raw, base64 */
  epk: string;
}

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (b: ArrayBuffer | Uint8Array) => {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (const x of u) s += String.fromCharCode(x);
  return btoa(s);
};
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const iv = () => globalThis.crypto.getRandomValues(new Uint8Array(12));
/** WebCrypto wants ArrayBuffer-backed views; callers may hand any Uint8Array. */
const buf = (u: Uint8Array): Uint8Array<ArrayBuffer> => (u.buffer instanceof ArrayBuffer ? (u as Uint8Array<ArrayBuffer>) : new Uint8Array(u));
const AES = { name: "AES-GCM", length: 256 } as const;

/** 8+ characters; a number code of 6 digits or fewer is never accepted (it would fall to a copied disk in seconds). */
export function validPassword(p: string): boolean {
  return p.length >= MIN_PASSWORD_LENGTH;
}

export function newDataKey(): Promise<CryptoKey> {
  return subtle().generateKey(AES, true, ["encrypt", "decrypt"]);
}

async function hkdfKey(material: Uint8Array, info: string, usages: KeyUsage[]): Promise<CryptoKey> {
  const base = await subtle().importKey("raw", buf(material), "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode(info) }, base, AES, false, usages);
}

async function passwordKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await subtle().importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: buf(salt), iterations }, base, AES, false, ["wrapKey", "unwrapKey"]);
}

async function wrapWith(kek: CryptoKey, key: CryptoKey, extra: Partial<Wrapped> = {}): Promise<Wrapped> {
  const i = iv();
  const data = await subtle().wrapKey("raw", key, kek, { name: "AES-GCM", iv: i });
  return { iv: b64(i), data: b64(data), ...extra };
}

function unwrapWith(kek: CryptoKey, w: Wrapped): Promise<CryptoKey> {
  return subtle().unwrapKey("raw", unb64(w.data), kek, { name: "AES-GCM", iv: unb64(w.iv) }, AES, true, ["encrypt", "decrypt"]);
}

export async function wrapWithPassword(key: CryptoKey, password: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<Wrapped> {
  return wrapWith(await passwordKey(password, salt, iterations), key, { salt: b64(salt), iterations });
}
export async function unwrapWithPassword(w: Wrapped, password: string): Promise<CryptoKey> {
  if (!w.salt || !w.iterations) throw new Error("not_a_password_wrap");
  return unwrapWith(await passwordKey(password, unb64(w.salt), w.iterations), w);
}

export async function wrapWithSecret(key: CryptoKey, secret: Uint8Array): Promise<Wrapped> {
  return wrapWith(await hkdfKey(secret, "emb space secret v1", ["wrapKey", "unwrapKey"]), key);
}
export async function unwrapWithSecret(w: Wrapped, secret: Uint8Array): Promise<CryptoKey> {
  return unwrapWith(await hkdfKey(secret, "emb space secret v1", ["wrapKey", "unwrapKey"]), w);
}

export async function wrapWithPrf(key: CryptoKey, prfOutput: Uint8Array): Promise<Wrapped> {
  return wrapWith(await hkdfKey(prfOutput, "emb space passkey v1", ["wrapKey", "unwrapKey"]), key);
}
export async function unwrapWithPrf(w: Wrapped, prfOutput: Uint8Array): Promise<CryptoKey> {
  return unwrapWith(await hkdfKey(prfOutput, "emb space passkey v1", ["wrapKey", "unwrapKey"]), w);
}

export async function seal(key: CryptoKey, value: unknown): Promise<Sealed> {
  const i = iv();
  const data = await subtle().encrypt({ name: "AES-GCM", iv: i }, key, enc.encode(JSON.stringify(value)));
  return { iv: b64(i), data: b64(data) };
}
export async function open<T>(key: CryptoKey, s: Sealed): Promise<T> {
  const plain = await subtle().decrypt({ name: "AES-GCM", iv: unb64(s.iv) }, key, unb64(s.data));
  return JSON.parse(dec.decode(plain)) as T;
}

// ---- the device outbox: sealed to a public key, opened only online -----------------------------------------------

const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

/** A new outbox key pair; the private key comes back wrapped by the device's outbox secret (from the server). */
export async function newOutboxKeyPair(secret: Uint8Array): Promise<{ publicKey: string; wrappedPrivate: Wrapped }> {
  const pair = await subtle().generateKey(ECDH, true, ["deriveBits"]);
  const pub = await subtle().exportKey("raw", pair.publicKey);
  const kek = await hkdfKey(secret, "emb outbox v1", ["wrapKey", "unwrapKey"]);
  const i = iv();
  const data = await subtle().wrapKey("pkcs8", pair.privateKey, kek, { name: "AES-GCM", iv: i });
  return { publicKey: b64(pub), wrappedPrivate: { iv: b64(i), data: b64(data) } };
}

export async function unwrapOutboxKey(w: Wrapped, secret: Uint8Array): Promise<CryptoKey> {
  const kek = await hkdfKey(secret, "emb outbox v1", ["wrapKey", "unwrapKey"]);
  return subtle().unwrapKey("pkcs8", unb64(w.data), kek, { name: "AES-GCM", iv: unb64(w.iv) }, ECDH, false, ["deriveBits"]);
}

async function sharedKey(privateKey: CryptoKey, publicKey: CryptoKey): Promise<CryptoKey> {
  const bits = await subtle().deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
  return hkdfKey(new Uint8Array(bits), "emb outbox item v1", ["encrypt", "decrypt"]);
}

export async function sealToPublic(publicKey: string, value: unknown): Promise<SealedForDevice> {
  const recipient = await subtle().importKey("raw", unb64(publicKey), ECDH, false, []);
  const eph = await subtle().generateKey(ECDH, true, ["deriveBits"]);
  const key = await sharedKey(eph.privateKey, recipient);
  const s = await seal(key, value);
  return { ...s, epk: b64(await subtle().exportKey("raw", eph.publicKey)) };
}

export async function openWithPrivate<T>(privateKey: CryptoKey, s: SealedForDevice): Promise<T> {
  const sender = await subtle().importKey("raw", unb64(s.epk), ECDH, false, []);
  return open<T>(await sharedKey(privateKey, sender), s);
}

export const encoding = { b64, unb64 };
