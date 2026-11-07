/**
 * Passkey unlock (offline devices spec §7.3): Face ID, Touch ID, Windows Hello or Android biometrics, through the
 * WebAuthn PRF extension. The authenticator returns 32 secret bytes for a fixed input; they wrap the space key, and
 * never leave this device. Nothing is sent to a server: the credential is used only to derive that key.
 */
import { encoding } from "./crypto.ts";

const salt = async (spaceId: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`emb space passkey ${spaceId}`)));

type PrfResults = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };

/** True where the browser says it can evaluate PRF on a platform authenticator. */
export async function prfSupported(): Promise<boolean> {
  const PKC = (globalThis as { PublicKeyCredential?: { getClientCapabilities?: () => Promise<Record<string, boolean>>; isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean> } }).PublicKeyCredential;
  if (!PKC?.getClientCapabilities) return false;
  const caps = await PKC.getClientCapabilities().catch(() => ({}) as Record<string, boolean>);
  const platform = (await PKC.isUserVerifyingPlatformAuthenticatorAvailable?.().catch(() => false)) ?? false;
  return !!caps["extension:prf"] && platform;
}

/** Creates a device-bound passkey for this space and returns its id and PRF output (null if PRF didn't work). */
export async function createPrfCredential(user: { id: string; name: string }, spaceId: string): Promise<{ credentialId: string; output: Uint8Array } | null> {
  const input = await salt(spaceId);
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: "eMazeBrain", id: location.hostname },
      user: { id: new TextEncoder().encode(`${user.id}:${spaceId}`).slice(0, 64), name: user.name, displayName: user.name },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "discouraged", userVerification: "required" },
      timeout: 60_000,
      extensions: { prf: { eval: { first: input } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) return null;
  const credentialId = encoding.b64(new Uint8Array(cred.rawId));
  const ext = cred.getClientExtensionResults() as PrfResults;
  const first = ext.prf?.results?.first ?? (ext.prf?.enabled ? await getPrf(credentialId, spaceId).then((u) => u.buffer as ArrayBuffer) : undefined);
  return first ? { credentialId, output: new Uint8Array(first) } : null;
}

/** Asks the authenticator (Face ID / fingerprint) for this space's PRF output. */
export async function getPrf(credentialId: string, spaceId: string): Promise<Uint8Array> {
  const input = await salt(spaceId);
  const got = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: "public-key", id: encoding.unb64(credentialId) }],
      userVerification: "required",
      timeout: 60_000,
      extensions: { prf: { eval: { first: input } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  const first = (got?.getClientExtensionResults() as PrfResults | undefined)?.prf?.results?.first;
  if (!first) throw new Error("passkey_failed");
  return new Uint8Array(first);
}
