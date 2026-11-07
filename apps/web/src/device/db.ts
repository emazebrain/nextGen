/**
 * On-device databases (offline devices spec §7.3; ADR 0019). One shared database for things without patient data
 * (spaces list, content index, settings) and the sealed outbox; one database per therapist space, every record
 * encrypted with that space's data key.
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Sealed, SealedForDevice, Wrapped } from "./crypto.ts";

export const DEVICE_DB = "emb.device.v1";
export const spaceDbName = (spaceId: string) => `emb.space.${spaceId}.v1`;

export interface SpaceInfo {
  id: string;
  user_id: string;
  display_name: string;
  clinic_id: string;
  clinic_name: string;
  last_online_at: string;
  wrapped: { password: Wrapped; secret: Wrapped; prf?: Wrapped & { credentialId: string } };
  tries: { count: number; locked_until: number };
}

export interface OutboxRecord {
  id: string;
  kind: "result" | "view";
  created_at: string;
  sealed: SealedForDevice;
  /** set when the server refused it in a way only a person can resolve (a reused id) */
  needs_help?: boolean;
}

export interface VideoIndexRow {
  id: string;
  version: number;
  sha256: string;
  bytes: number;
  url: string;
  stored_at: string;
  last_used_at: string;
}

interface DeviceSchema extends DBSchema {
  meta: { key: string; value: unknown };
  spaces: { key: string; value: SpaceInfo };
  outbox: { key: string; value: OutboxRecord; indexes: { created_at: string } };
  videos: { key: string; value: VideoIndexRow };
}

interface SpaceSchema extends DBSchema {
  records: { key: string; value: Sealed };
}

let device: Promise<IDBPDatabase<DeviceSchema>> | null = null;

export function deviceDb(): Promise<IDBPDatabase<DeviceSchema>> {
  device ??= openDB<DeviceSchema>(DEVICE_DB, 1, {
    upgrade(db) {
      db.createObjectStore("meta");
      db.createObjectStore("spaces", { keyPath: "id" });
      db.createObjectStore("outbox", { keyPath: "id" }).createIndex("created_at", "created_at");
      db.createObjectStore("videos", { keyPath: "id" });
    },
  });
  return device;
}

const spaces = new Map<string, Promise<IDBPDatabase<SpaceSchema>>>();

/** One connection per space, closed as soon as anything asks to delete or upgrade that database. */
export function spaceDb(spaceId: string): Promise<IDBPDatabase<SpaceSchema>> {
  let p = spaces.get(spaceId);
  if (!p) {
    p = openDB<SpaceSchema>(spaceDbName(spaceId), 1, {
      upgrade(db) {
        db.createObjectStore("records");
      },
      blocking() {
        void p!.then((db) => db.close());
        spaces.delete(spaceId);
      },
    });
    spaces.set(spaceId, p);
  }
  return p;
}

export async function closeSpaceDb(spaceId: string): Promise<void> {
  const p = spaces.get(spaceId);
  spaces.delete(spaceId);
  if (p) (await p).close();
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await (await deviceDb()).get("meta", key)) as T | undefined;
}
export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await deviceDb()).put("meta", value, key);
}
