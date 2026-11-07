import { serve } from "@hono/node-server";
import pg from "pg";
import { createApp } from "./app.ts";
import { createAuth } from "./auth.ts";
import { ticketSigner } from "./tickets.ts";
import { localFileStore } from "./files.ts";

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
    ...(process.env.IP_HEADERS ? { ipAddressHeaders: process.env.IP_HEADERS.split(",").map((s) => s.trim()) } : {}),
    ...(process.env.TRUSTED_ORIGINS ? { trustedOrigins: process.env.TRUSTED_ORIGINS.split(",").map((s) => s.trim()) } : {}),
  },
  pool,
);
// LAUNCH_SIGNING_KEY: PKCS#8 PEM Ed25519 key. Required in production so tickets survive restarts.
if (!process.env.LAUNCH_SIGNING_KEY && process.env.NODE_ENV === "production") throw new Error("LAUNCH_SIGNING_KEY is not set");
const tickets = ticketSigner(process.env.LAUNCH_SIGNING_KEY?.replace(/\\n/g, "\n"));
// FILE_STORE_DIR: where uploaded videos are kept on this machine (the cloud cells switch to S3 with deployment).
const files = localFileStore(process.env.FILE_STORE_DIR ?? ".data/files");
const app = createApp(info, { pool, auth, tickets, files });

serve({ fetch: app.fetch, port }, (s) => {
  console.log(`api listening on :${s.port} (cell ${info.cell})`);
});
