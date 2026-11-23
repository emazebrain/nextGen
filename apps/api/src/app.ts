import { Hono } from "hono";
import type pg from "pg";
import type { Auth } from "./auth.ts";
import { requireActiveUser, requireParentSession, requireStaffSession, type Env } from "./context.ts";
import { meRoutes } from "./modules/me/routes.ts";
import { patientRoutes } from "./modules/patients/routes.ts";
import { clinicRoutes } from "./modules/clinics/routes.ts";
import { protocolRoutes } from "./modules/protocols/routes.ts";
import { sessionRoutes } from "./modules/sessions/routes.ts";
import { videoRoutes } from "./modules/videos/routes.ts";
import { deviceRoutes } from "./modules/devices/routes.ts";
import { offlineRoutes } from "./modules/offline/routes.ts";
import { parentProgressReportRoutes, progressReportRoutes } from "./modules/patients/progress-reports.ts";
import { reportRoutes } from "./modules/sessions/reports.ts";
import { adminAppearanceRoutes, publicAppearanceRoutes } from "./modules/appearance/routes.ts";
import { adminRoutes } from "./modules/admin/routes.ts";
import { orgAdminRoutes } from "./modules/org/routes.ts";
import { publicConsentRoutes } from "./modules/consent/public-routes.ts";
import { parentRoutes } from "./modules/parent/routes.ts";
import { publicParentPortalRoutes } from "./modules/parent/public-routes.ts";
import { messagingRoutes, parentMessagingRoutes } from "./modules/messaging/routes.ts";
import { calendarRoutes } from "./modules/calendar/routes.ts";
import { searchRoutes } from "./modules/search/routes.ts";
import { deviceKey, type DeviceKey } from "./device-crypto.ts";
import { localFileStore, type FileStore } from "./files.ts";
import { createMailer, type Mailer } from "./email.ts";
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
  /** Seals device and space secrets. Defaults to a random key per process (dev and tests only). */
  deviceKey?: DeviceKey;
  /** Invitation mailer. Defaults to a no-op mailer (dev and tests). */
  mailer?: Mailer;
  /** Public URL of the web app, used for invitation login links (I4: not from Origin header). */
  publicAppUrl?: string | undefined;
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
  app.get("/version", (c) => c.json({ version: info.version }));

  // Diagnostic: which migrations have been applied, and try to run pending ones
  if (deps) {
    app.get("/health/migrations", async (c) => {
      const client = await deps.pool.connect();
      try {
        const { rows } = await client.query<{ name: string; applied_at: string }>(
          "SELECT name, applied_at::text FROM public.schema_migrations ORDER BY name",
        );
        return c.json({ migrations: rows });
      } finally {
        client.release();
      }
    });

    app.get("/health/schema", async (c) => {
      const client = await deps.pool.connect();
      try {
        const { rows } = await client.query(`
          SELECT current_user AS connected_as,
                 session_user AS session_user,
                 (SELECT nspowner::regrole::text FROM pg_namespace WHERE nspname = 'app') AS app_schema_owner,
                 has_schema_privilege(current_user, 'app', 'USAGE') AS has_usage,
                 has_schema_privilege(current_user, 'app', 'CREATE') AS has_create
        `);
        return c.json(rows[0] ?? {});
      } finally {
        client.release();
      }
    });

    app.post("/health/migrate", async (c) => {
      const pg = await import("pg");
      const { migrate } = await import("@emb/db");
      const client = new pg.default.Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      try {
        const applied = await migrate(client);
        return c.json({ ok: true, applied });
      } catch (err) {
        return c.json({ ok: false, error: String(err), message: (err as Error).message }, 500);
      } finally {
        await client.end();
      }
    });
  }

  if (deps) {
    app.on(["GET", "POST"], "/api/auth/*", (c) => deps.auth.handler(c.req.raw));

    const v1 = new Hono<Env>();
    v1.use("*", requireStaffSession(deps.auth));
    v1.use("*", requireActiveUser(deps.pool));
    v1.route("/me", meRoutes(deps.pool, deps.auth));
    const mailer = deps.mailer ?? createMailer({});
    v1.route("/patients", patientRoutes(deps.pool, mailer, deps.publicAppUrl));
    v1.route("/clinics", clinicRoutes(deps.pool));
    v1.route("/", protocolRoutes(deps.pool));
    v1.route("/", sessionRoutes(deps.pool, deps.tickets ?? ticketSigner()));
    v1.route("/", reportRoutes(deps.pool));
    v1.route("/", progressReportRoutes(deps.pool));
    v1.route("/", videoRoutes(deps.pool, deps.files ?? localFileStore(process.env.FILE_STORE_DIR ?? ".data/files")));
    v1.route("/", deviceRoutes(deps.pool, deps.deviceKey ?? deviceKey(undefined)));
    v1.route("/", offlineRoutes(deps.pool, deps.tickets ?? ticketSigner()));
    // Before the general admin router, so its own gate answers for these paths.
    v1.route("/admin/appearance", adminAppearanceRoutes(deps.pool));
    v1.route("/admin", adminRoutes(deps.pool, deps.auth, mailer, deps.publicAppUrl));
    v1.route("/org", orgAdminRoutes(deps.pool, deps.auth, mailer, deps.publicAppUrl));
    v1.route("/messages", messagingRoutes(deps.pool));
    v1.route("/calendar", calendarRoutes(deps.pool));
    v1.route("/search", searchRoutes(deps.pool));
    app.route("/v1", v1);

    // Parent portal — authenticated but no MFA requirement (§5.10)
    const parentV1 = new Hono<Env>();
    parentV1.use("*", requireParentSession(deps.auth));
    parentV1.route("/parent", parentRoutes(deps.pool, deps.tickets ?? ticketSigner()));
    parentV1.route("/parent/messages", parentMessagingRoutes(deps.pool));
    parentV1.route("/parent", parentProgressReportRoutes(deps.pool));
    app.route("/v1", parentV1);

    // Public consent endpoints — outside /v1 (no auth required).
    // Mounted at /api/consent so the Vercel proxy (/api/:path*) forwards them,
    // and also at /consent for backward-compat with any already-sent emails.
    const consentRouter = publicConsentRoutes(deps.pool);
    app.route("/api/consent", consentRouter);
    app.route("/consent", consentRouter);

    // The app background: read by every screen, including sign-in (no session needed).
    app.route("/api/appearance", publicAppearanceRoutes(deps.pool));

    // Public parent portal registration — outside /v1 (no auth required)
    const portalRouter = publicParentPortalRoutes(deps.pool, deps.auth);
    app.route("/api/parent-portal", portalRouter);
    app.route("/parent-portal", portalRouter);
  }

  app.notFound((c) => {
    return c.json({ error: "not_found" }, 404);
  });
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
