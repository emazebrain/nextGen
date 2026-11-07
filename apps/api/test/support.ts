/**
 * Shared test setup: a fresh database, the API, and staff users who are
 * signed in with two-step verification, exactly as in production.
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { vi } from "vitest";
import { migrate } from "../../../packages/db/src/migrate.ts";
import { createApp } from "../src/app.ts";
import { authPool, createAuth } from "../src/auth.ts";
import { localFileStore } from "../src/files.ts";
import { deviceKey, type DeviceKey } from "../src/device-crypto.ts";
import { ticketSigner, type TicketSigner } from "../src/tickets.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const ADMIN_URL = process.env.DATABASE_URL;
export const BASE = "http://localhost:8787";

export function totp(secretB32: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secretB32.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  return ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

export type App = ReturnType<typeof createApp>;
export type Api = ((path: string, init?: { method?: string; body?: unknown }) => Promise<{ status: number; body: any }>) & {
  /** A raw request with the same cookies (uploads, byte ranges). */
  raw: (path: string, init?: RequestInit) => Promise<Response>;
};

/** A tiny cookie-keeping client around app.request(). */
export function client(app: App): Api {
  const jar = new Map<string, string>();
  const api = (async (path: string, init: { method?: string; body?: unknown } = {}) => {
    const headers = new Headers({ origin: BASE });
    if (init.body !== undefined) headers.set("content-type", "application/json");
    if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const res = await app.request(`${BASE}${path}`, {
      method: init.method ?? "GET",
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const [k, ...v] = pair!.split("=");
      const value = v.join("=");
      if (/max-age=0/i.test(c) || value === "") jar.delete(k!.trim());
      else jar.set(k!.trim(), value);
    }
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }) as Api;
  api.raw = (path, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("origin", BASE);
    if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    return Promise.resolve(app.request(`${BASE}${path}`, { ...init, headers }));
  };
  return api;
}

export interface TestEnv {
  app: App;
  db: pg.Client;
  pool: pg.Pool;
  /** Moves the clock one 30-second step forward (codes are single-use). */
  nextStep: () => void;
  /** The key the app seals device and space secrets with. */
  deviceKey: DeviceKey;
  /** The app's launch ticket signer (tests sign offline tickets with it). */
  tickets: TicketSigner;
  close: () => Promise<void>;
}

export async function setupApi(): Promise<TestEnv> {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  const name = `emb_api_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = new URL(ADMIN_URL!);
  url.pathname = `/${name}`;
  const db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  await migrate(db);
  const pool = new pg.Pool({ connectionString: url.toString(), max: 4 });
  const authDb = authPool(url.toString());
  const auth = createAuth({ databaseUrl: url.toString(), secret: randomUUID() + randomUUID(), baseURL: BASE, pool: authDb, rateLimit: false }, pool);
  const fileDir = mkdtempSync(join(tmpdir(), "emb-files-"));
  const key = deviceKey(randomBytes(32).toString("base64"));
  const tickets = ticketSigner();
  const app = createApp({ cell: "test", version: "test" }, { pool, auth, files: localFileStore(fileDir), deviceKey: key, tickets });
  return {
    app,
    db,
    pool,
    nextStep: () => vi.setSystemTime(Date.now() + 30_000),
    deviceKey: key,
    tickets,
    close: async () => {
      vi.useRealTimers();
      await pool.end();
      await authDb.end();
      await db.end();
      rmSync(fileDir, { recursive: true, force: true });
      const a = new pg.Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.end();
    },
  };
}

/** Signs a staff member up, turns on two-step sign-in and returns a signed-in client. */
export async function staffClient(env: TestEnv, email: string, name: string): Promise<{ api: Api; userId: string }> {
  const api = client(env.app);
  const password = "correct horse battery staple";
  const up = await api("/api/auth/sign-up/email", { method: "POST", body: { email, password, name } });
  if (up.status !== 200) throw new Error(`sign-up failed: ${up.status}`);
  const enable = await api("/api/auth/two-factor/enable", { method: "POST", body: { password } });
  const secret = new URL(enable.body.totpURI).searchParams.get("secret")!;
  env.nextStep();
  const ok = await api("/api/auth/two-factor/verify-totp", { method: "POST", body: { code: totp(secret) } });
  if (ok.status !== 200) throw new Error(`enrolment failed: ${ok.status}`);
  return { api, userId: up.body.user.id };
}

/** One organization, two clinics. Returns their ids. */
export async function seedClinics(db: pg.Client) {
  const org = randomUUID();
  const clinic = randomUUID();
  const other = randomUUID();
  await db.query(`INSERT INTO app.organization (id, name, region) VALUES ($1,'Org','il')`, [org]);
  await db.query(
    `INSERT INTO app.clinic (id, organization_id, name, country_code, timezone) VALUES ($1,$3,'Tel Aviv','IL','Asia/Jerusalem'), ($2,$3,'Haifa','IL','Asia/Jerusalem')`,
    [clinic, other, org],
  );
  return { org, clinic, other };
}

export async function addMember(db: pg.Client, userId: string, org: string, clinic: string, role: string) {
  await db.query(`INSERT INTO app.membership (user_id, organization_id, clinic_id, role) VALUES ($1,$2,$3,$4)`, [userId, org, clinic, role]);
}

/** A platform admin in the eMazeBrain organization (manages the content library). */
export async function platformAdmin(env: TestEnv, email = "admin@synthetic.test"): Promise<{ api: Api; userId: string }> {
  const a = await staffClient(env, email, "Content Admin");
  const org = randomUUID();
  await env.db.query(`INSERT INTO app.organization (id, name, region) VALUES ($1,'eMazeBrain','il')`, [org]);
  await env.db.query(`INSERT INTO app.membership (user_id, organization_id, clinic_id, role) VALUES ($1,$2,NULL,'platform_admin')`, [a.userId, org]);
  return a;
}
