/**
 * Per-therapist spaces on a shared device (offline devices spec §7.3–7.5). A space opens with the therapist's offline
 * password or passkey (offline, for 30 days after the last online sign-in) or with the server's space secret (online).
 */
import { deleteDB } from "idb";
import {
  PBKDF2_ITERATIONS, newDataKey, open, seal, unwrapWithPassword, unwrapWithPrf, unwrapWithSecret, wrapWithPassword, wrapWithPrf, wrapWithSecret,
} from "./crypto.ts";
import { closeSpaceDb, deviceDb, spaceDb, spaceDbName, type SpaceInfo } from "./db.ts";

export type { SpaceInfo };
export const OFFLINE_DAYS = 30;
export const MAX_TRIES = 5;
export const LOCK_MS = 60_000;

export interface OpenSpace {
  id: string;
  info: SpaceInfo;
  read<T>(name: string): Promise<T | undefined>;
  write(name: string, value: unknown): Promise<void>;
  lock(): void;
}
export type UnlockResult = OpenSpace | { locked_ms: number; tries_left: number } | { expired: true };

export async function listSpaces(): Promise<SpaceInfo[]> {
  const all = await (await deviceDb()).getAll("spaces");
  return all.sort((a, b) => a.display_name.localeCompare(b.display_name));
}

export function canUnlockOffline(info: Pick<SpaceInfo, "last_online_at">, now = Date.now()): boolean {
  return now - Date.parse(info.last_online_at) <= OFFLINE_DAYS * 86_400_000;
}

export async function createSpace(
  info: Omit<SpaceInfo, "wrapped" | "tries">,
  cred: { password: string; secret: Uint8Array; prf?: { output: Uint8Array; credentialId: string }; iterations?: number },
): Promise<OpenSpace> {
  const key = await newDataKey();
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const wrapped: SpaceInfo["wrapped"] = {
    password: await wrapWithPassword(key, cred.password, salt, cred.iterations ?? PBKDF2_ITERATIONS),
    secret: await wrapWithSecret(key, cred.secret),
    ...(cred.prf ? { prf: { ...(await wrapWithPrf(key, cred.prf.output)), credentialId: cred.prf.credentialId } } : {}),
  };
  const full: SpaceInfo = { ...info, wrapped, tries: { count: 0, locked_until: 0 } };
  await (await deviceDb()).put("spaces", full);
  return openSpace(full, key);
}

async function info(id: string): Promise<SpaceInfo> {
  const s = await (await deviceDb()).get("spaces", id);
  if (!s) throw new Error("no_such_space");
  return s;
}

function openSpace(s: SpaceInfo, key: CryptoKey): OpenSpace {
  let k: CryptoKey | null = key;
  const need = () => {
    if (!k) throw new Error("space_locked");
    return k;
  };
  return {
    id: s.id,
    info: s,
    async read<T>(name: string) {
      const v = await (await spaceDb(s.id)).get("records", name);
      return v ? open<T>(need(), v) : undefined;
    },
    async write(name: string, value: unknown) {
      const sealed = await seal(need(), value);
      await (await spaceDb(s.id)).put("records", sealed, name);
    },
    lock() {
      k = null;
    },
  };
}

/** Offline unlock by password: 5 wrong tries lock for a minute, doubling after each further 5. */
export async function unlockWithPassword(id: string, password: string, now = Date.now()): Promise<UnlockResult> {
  const s = await info(id);
  if (!canUnlockOffline(s, now)) return { expired: true };
  if (s.tries.locked_until > now) return { locked_ms: s.tries.locked_until - now, tries_left: 0 };
  try {
    const key = await unwrapWithPassword(s.wrapped.password, password);
    const ok = { ...s, tries: { count: 0, locked_until: 0 } };
    await (await deviceDb()).put("spaces", ok);
    return openSpace(ok, key);
  } catch {
    const count = s.tries.count + 1;
    const lockedFor = count % MAX_TRIES === 0 ? LOCK_MS * 2 ** (count / MAX_TRIES - 1) : 0;
    await (await deviceDb()).put("spaces", { ...s, tries: { count, locked_until: lockedFor ? now + lockedFor : 0 } });
    return { locked_ms: lockedFor, tries_left: lockedFor ? 0 : MAX_TRIES - (count % MAX_TRIES) };
  }
}

export async function unlockWithPrf(id: string, prfOutput: Uint8Array, now = Date.now()): Promise<UnlockResult> {
  const s = await info(id);
  if (!canUnlockOffline(s, now)) return { expired: true };
  if (!s.wrapped.prf) throw new Error("no_passkey");
  return openSpace(s, await unwrapWithPrf(s.wrapped.prf, prfOutput));
}

/** Online: the server's space secret opens the space without the password, and resets the offline clock. */
export async function unlockWithSecret(id: string, secret: Uint8Array, now = Date.now()): Promise<OpenSpace> {
  const s = await info(id);
  const key = await unwrapWithSecret(s.wrapped.secret, secret);
  const fresh = { ...s, last_online_at: new Date(now).toISOString(), tries: { count: 0, locked_until: 0 } };
  await (await deviceDb()).put("spaces", fresh);
  return openSpace(fresh, key);
}

export async function removeSpace(id: string): Promise<void> {
  await (await deviceDb()).delete("spaces", id);
  await closeSpaceDb(id);
  await deleteDB(spaceDbName(id));
}
