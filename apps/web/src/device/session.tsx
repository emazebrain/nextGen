/**
 * The device's sign-in state on a shared tablet (offline devices spec §7.3–7.5; ADR 0019).
 *
 * Online: after a normal sign-in the therapist's space opens with the server's space secret, and the device outbox's
 * private key is unwrapped with the outbox secret (kept in memory only). The first time on a device, they set up
 * offline use: an offline password (and a passkey where the platform has PRF), which creates their space.
 * Offline: they pick themselves from this device's therapists and unlock with the password or passkey.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { DeviceSecrets, DeviceSpace } from "@emb/contracts";
import type { Me } from "../api/queries.ts";
import { apiGet, apiSend } from "../api/http.ts";
import { encoding, generateOutboxKeyPair, unwrapOutboxKey, wrapOutboxPrivate, type Wrapped } from "./crypto.ts";
import { getMeta, setMeta } from "./db.ts";
import { getPrf } from "./passkey.ts";
import { setPinStorage } from "../session/kidmode.ts";
import {
  createSpace, listSpaces, removeSpace, unlockWithPassword, unlockWithPrf, unlockWithSecret,
  type OpenSpace, type SpaceInfo, type UnlockResult,
} from "./spaces.ts";

interface OutboxMeta {
  publicKey: string;
  wrappedPrivate: Wrapped;
}

/** Creates a passkey for a new space (it needs the space id) and returns its PRF output, or null. */
export type MakePrf = (spaceId: string) => Promise<{ output: Uint8Array; credentialId: string } | null>;

export type OpenOnlineResult = "opened" | "needs_setup" | "skipped" | "unavailable";

export interface DeviceState {
  ready: boolean;
  deviceId: string | null;
  online: boolean;
  spaces: SpaceInfo[];
  space: OpenSpace | null;
  /** The signed-in therapist as last seen online (for the offline shell). */
  offlineMe: Me | null;
  outboxPublicKey: string | null;
  outboxKey: CryptoKey | null;
  refreshSpaces(): Promise<void>;
  openOnline(me: Me, clinicId: string): Promise<OpenOnlineResult>;
  setupOffline(me: Me, clinic: { id: string; name: string }, cred: { password: string; makePrf?: MakePrf }): Promise<void>;
  skipSetup(userId: string): Promise<void>;
  openOffline(id: string, cred: { password: string } | { prf: true }): Promise<UnlockResult>;
  lock(): void;
  /** Explicit sign-out: ends and removes this therapist's own space (nothing else on the device). */
  signOut(): Promise<void>;
}

const Ctx = createContext<DeviceState | null>(null);

export function useDevice(): DeviceState {
  const d = useContext(Ctx);
  if (!d) throw new Error("useDevice outside DeviceProvider");
  return d;
}
/** For components that may render without the provider (demo, tests of other screens). */
export function useOptionalDevice(): DeviceState | null {
  return useContext(Ctx);
}

const b64 = (s: string) => encoding.unb64(s);

/** Running as an installed app (home-screen icon), not in a browser tab. */
export function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  const standalone = typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches;
  return standalone || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
const supported = () => typeof indexedDB !== "undefined" && typeof crypto?.subtle !== "undefined" && import.meta.env.MODE !== "demo";

async function attachPin(space: OpenSpace | null) {
  if (!space) return setPinStorage(null);
  const pin = (await space.read<Record<string, unknown>>("kidpin")) ?? {};
  setPinStorage({ initial: pin, save: (v) => void space.write("kidpin", v) });
}

export function DeviceProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [spaces, setSpaces] = useState<SpaceInfo[]>([]);
  const [space, setSpace] = useState<OpenSpace | null>(null);
  const [offlineMe, setOfflineMe] = useState<Me | null>(null);
  const [outbox, setOutbox] = useState<{ publicKey: string | null; key: CryptoKey | null }>({ publicKey: null, key: null });

  const refreshSpaces = useCallback(async () => {
    if (supported()) setSpaces(await listSpaces());
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      if (supported()) {
        const id = (await getMeta<string>("device_id")) ?? null;
        const ob = await getMeta<OutboxMeta>("outbox");
        if (!live) return;
        setDeviceId(id);
        setOutbox((o) => ({ ...o, publicKey: ob?.publicKey ?? null }));
        setSpaces(await listSpaces());
      }
      if (live) setReady(true);
    })();
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      live = false;
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  const opened = useCallback(async (s: OpenSpace) => {
    setSpace(s);
    setOfflineMe((await s.read<Me>("me")) ?? null);
    await attachPin(s);
    setSpaces(await listSpaces());
  }, []);

  /** Unwraps the outbox private key once the server has handed over the outbox secret. */
  const takeOutbox = useCallback(async (secrets: DeviceSecrets) => {
    const ob = await getMeta<OutboxMeta>("outbox");
    if (!ob || !secrets.outbox_secret) return;
    const key = await unwrapOutboxKey(ob.wrappedPrivate, b64(secrets.outbox_secret)).catch(() => null);
    setOutbox({ publicKey: ob.publicKey, key });
  }, []);

  const openOnline = useCallback(
    async (me: Me, clinicId: string): Promise<OpenOnlineResult> => {
      if (!supported()) return "unavailable";
      const id = await getMeta<string>("device_id");
      const local = (await listSpaces()).find((s) => s.user_id === me.user.id && s.clinic_id === clinicId);
      const skipped = ((await getMeta<Record<string, boolean>>("setup_skipped")) ?? {})[me.user.id];
      if (!id) return skipped ? "skipped" : "needs_setup";
      let secrets: DeviceSecrets;
      try {
        secrets = await apiGet<DeviceSecrets>(`/v1/devices/${id}/secrets`);
      } catch {
        return local ? "unavailable" : skipped ? "skipped" : "needs_setup";
      }
      await takeOutbox(secrets);
      // Spaces the server no longer has for this user (ended by a manager, or signed out elsewhere) go.
      for (const s of await listSpaces()) {
        if (s.user_id === me.user.id && !secrets.spaces.some((x) => x.space_id === s.id)) await removeSpace(s.id);
      }
      const mine = local && secrets.spaces.find((x) => x.space_id === local.id);
      if (!mine) {
        await refreshSpaces();
        return skipped ? "skipped" : "needs_setup";
      }
      const s = await unlockWithSecret(local.id, b64(mine.space_secret));
      await s.write("me", me);
      await opened(s);
      return "opened";
    },
    [opened, refreshSpaces, takeOutbox],
  );

  const setupOffline = useCallback(
    async (me: Me, clinic: { id: string; name: string }, cred: { password: string; makePrf?: MakePrf }) => {
      let id = await getMeta<string>("device_id");
      let pending: CryptoKey | null = null;
      if (!id || !(await getMeta<OutboxMeta>("outbox"))) {
        // A new device (or one whose storage was cleared): new id, new outbox key pair, registered now.
        id = crypto.randomUUID();
        const pair = await generateOutboxKeyPair();
        await apiSend("POST", "/v1/devices/register", { device_id: id, outbox_public_key: pair.publicKey });
        await setMeta("device_id", id);
        pending = pair.privateKey;
        await setMeta("outbox_public", pair.publicKey);
      }
      const created = await apiSend<DeviceSpace>("POST", `/v1/devices/${id}/spaces`, { clinic_id: clinic.id });
      const secrets = await apiGet<DeviceSecrets>(`/v1/devices/${id}/secrets`);
      if (pending && secrets.outbox_secret) {
        const publicKey = (await getMeta<string>("outbox_public"))!;
        await setMeta("outbox", { publicKey, wrappedPrivate: await wrapOutboxPrivate(pending, b64(secrets.outbox_secret)) } satisfies OutboxMeta);
      }
      await takeOutbox(secrets);
      const mine = secrets.spaces.find((x) => x.space_id === created.id);
      if (!mine) throw new Error("space_secret_missing");
      // A passkey is optional: if the platform refuses, the password still works.
      const prf = cred.makePrf ? await cred.makePrf(created.id).catch(() => null) : null;
      const s = await createSpace(
        { id: created.id, user_id: me.user.id, display_name: me.user.name, clinic_id: clinic.id, clinic_name: clinic.name, last_online_at: new Date().toISOString() },
        { password: cred.password, secret: b64(mine.space_secret), ...(prf ? { prf } : {}) },
      );
      await s.write("me", me);
      setDeviceId(id);
      await opened(s);
    },
    [opened, takeOutbox],
  );

  const skipSetup = useCallback(async (userId: string) => {
    const all = (await getMeta<Record<string, boolean>>("setup_skipped")) ?? {};
    await setMeta("setup_skipped", { ...all, [userId]: true });
  }, []);

  const openOffline = useCallback(
    async (id: string, cred: { password: string } | { prf: true }): Promise<UnlockResult> => {
      let r: UnlockResult;
      if ("password" in cred) r = await unlockWithPassword(id, cred.password);
      else {
        const info = (await listSpaces()).find((s) => s.id === id);
        if (!info?.wrapped.prf) throw new Error("no_passkey");
        r = await unlockWithPrf(id, await getPrf(info.wrapped.prf.credentialId, id));
      }
      if ("read" in r) await opened(r);
      else await refreshSpaces();
      return r;
    },
    [opened, refreshSpaces],
  );

  const lock = useCallback(() => {
    space?.lock();
    setSpace(null);
    setOfflineMe(null);
    setOutbox((o) => ({ ...o, key: null }));
    void attachPin(null);
  }, [space]);

  const signOut = useCallback(async () => {
    if (space) {
      const id = await getMeta<string>("device_id");
      if (id) await apiSend("DELETE", `/v1/devices/${id}/spaces/${space.id}`).catch(() => undefined);
      space.lock();
      await removeSpace(space.id);
    }
    setSpace(null);
    setOfflineMe(null);
    setOutbox((o) => ({ ...o, key: null }));
    await attachPin(null);
    await refreshSpaces();
  }, [space, refreshSpaces]);

  const value = useMemo<DeviceState>(
    () => ({
      ready, deviceId, online, spaces, space, offlineMe, outboxPublicKey: outbox.publicKey, outboxKey: outbox.key,
      refreshSpaces, openOnline, setupOffline, skipSetup, openOffline, lock, signOut,
    }),
    [ready, deviceId, online, spaces, space, offlineMe, outbox, refreshSpaces, openOnline, setupOffline, skipSetup, openOffline, lock, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
