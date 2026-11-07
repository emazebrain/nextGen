import { Hono } from "hono";
import type pg from "pg";
import type { Auth } from "./auth.ts";
import { requireStaffSession, type Env } from "./context.ts";
import { meRoutes } from "./modules/me/routes.ts";
import { patientRoutes } from "./modules/patients/routes.ts";
import { clinicRoutes } from "./modules/clinics/routes.ts";
import { protocolRoutes } from "./modules/protocols/routes.ts";
import { sessionRoutes } from "./modules/sessions/routes.ts";
import { videoRoutes } from "./modules/videos/routes.ts";
import { localFileStore, type FileStore } from "./files.ts";
import { ticketSigner, type TicketSigner } from "./tickets.ts";

export interface AppInfo {
  cell: string;
  version: string;
}

export interface AppDeps {
  /** Service connection pool. Its user must be able to SET ROLE emb_app. */
  pool: pg.Pool;
  auth: Auth;
  /** Signs launch tickets. Defaults to a throwaway key (fine for dev and tests, not production). */
  tickets?: TicketSigner;
  /** Uploaded files (videos). Defaults to a folder on disk (FILE_STORE_DIR or .data/files). */
  files?: FileStore;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * API Service (design doc §9.1, C9). Modules live under
 * src/modules/<module>/routes.ts and only ever query through withUser().
 */
export function createApp(info: AppInfo, deps?: AppDeps) {
  const app = new Hono<Env>();

  // Every response carries a request id; it is also written to audit rows.
  app.use("*", async (c, next) => {
    const incoming = c.req.header("x-request-id");
    const requestId = incoming && UUID.test(incoming) ? incoming : crypto.randomUUID();
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);
    await next();
  });

  app.get("/health", (c) => c.json({ status: "ok", cell: info.cell, version: info.version }));

  if (deps) {
    app.on(["GET", "POST"], "/api/auth/*", (c) => deps.auth.handler(c.req.raw));

    const v1 = new Hono<Env>();
    v1.use("*", requireStaffSession(deps.auth));
    v1.route("/me", meRoutes(deps.pool));
    v1.route("/patients", patientRoutes(deps.pool));
    v1.route("/clinics", clinicRoutes(deps.pool));
    v1.route("/", protocolRoutes(deps.pool));
    v1.route("/", sessionRoutes(deps.pool, deps.tickets ?? ticketSigner()));
    v1.route("/", videoRoutes(deps.pool, deps.files ?? localFileStore(process.env.FILE_STORE_DIR ?? ".data/files")));
    app.route("/v1", v1);
  }

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    // The database said no (RLS or a guard trigger): that's a permission answer, not a crash.
    const code = (err as { code?: string }).code;
    if (code === "42501") return c.json({ error: "forbidden" }, 403);
    if (code === "23514" || code === "22007" || code === "22008") return c.json({ error: "invalid" }, 400);
    // Never echo internals; log the request id so it can be traced (no patient data in logs).
    console.error(`[${c.get("requestId")}]`, err.message);
    return c.json({ error: "internal_error", requestId: c.get("requestId") }, 500);
  });

  return app;
}
