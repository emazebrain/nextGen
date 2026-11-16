import { setDefaultResultOrder } from "node:dns";
// Railway's network does not support IPv6 outbound; Supabase hostnames resolve
// to both v4 and v6, and Node tries v6 first → ENETUNREACH.  Force IPv4.
setDefaultResultOrder("ipv4first");

import { deviceKey } from "./device-crypto.ts";
import { serve } from "@hono/node-server";
import pg from "pg";
import { migrate } from "@emb/db";
import { createApp } from "./app.ts";
import { createAuth } from "./auth.ts";
import { ticketSigner } from "./tickets.ts";
import { localFileStore } from "./files.ts";
import { createMailer } from "./email.ts";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

const port = Number(process.env.PORT ?? 8787);
const info = { cell: process.env.CELL ?? "local", version: process.env.APP_VERSION ?? "dev" };
const databaseUrl = required("DATABASE_URL");
const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
const auth = createAuth(
  {
    databaseUrl,
    secret: required("AUTH_SECRET"),
    baseURL: process.env.BASE_URL ?? `http://localhost:${port}`,
    // Origins allowed to call the auth endpoints, e.g. the SPA's dev server (comma-separated).
    // AUTH_RATE_LIMIT=off only for automated end-to-end runs; API tests cover the limits themselves.
    ...(process.env.AUTH_RATE_LIMIT === "off" ? { rateLimit: false } : {}),
    // AUTH_SCHEMA: where the sign-in tables live when the host reserves schema `auth` (Supabase).
    ...(process.env.AUTH_SCHEMA ? { schema: process.env.AUTH_SCHEMA } : {}),
    ...(process.env.IP_HEADERS ? { ipAddressHeaders: process.env.IP_HEADERS.split(",").map((s) => s.trim()) } : {}),
    ...(process.env.TRUSTED_ORIGINS ? { trustedOrigins: process.env.TRUSTED_ORIGINS.split(",").map((s) => s.trim()) } : {}),
  },
  pool,
);
// LAUNCH_SIGNING_KEY: PKCS#8 PEM Ed25519 key. Required in production so tickets survive restarts.
if (!process.env.LAUNCH_SIGNING_KEY && process.env.NODE_ENV === "production") throw new Error("LAUNCH_SIGNING_KEY is not set");
if (!process.env.DEVICE_SECRET_KEY && process.env.NODE_ENV === "production") throw new Error("DEVICE_SECRET_KEY is not set");
const tickets = ticketSigner(process.env.LAUNCH_SIGNING_KEY?.replace(/\\n/g, "\n"));
// FILE_STORE_DIR: where uploaded videos are kept on this machine (the cloud cells switch to S3 with deployment).
const files = localFileStore(process.env.FILE_STORE_DIR ?? ".data/files");
const mailer = createMailer(process.env);
const app = createApp(info, { pool, auth, tickets, files, deviceKey: deviceKey(process.env.DEVICE_SECRET_KEY), mailer, publicAppUrl: process.env.PUBLIC_APP_URL });

// Run pending migrations before accepting traffic.
const migrationClient = new pg.Client({ connectionString: databaseUrl });
await migrationClient.connect();
try {
  const applied = await migrate(migrationClient);
  if (applied.length) console.log(`migrations applied: ${applied.join(", ")}`);
} finally {
  await migrationClient.end();
}

serve({ fetch: app.fetch, port }, (s) => {
  console.log(`api listening on :${s.port} (cell ${info.cell})`);
});
