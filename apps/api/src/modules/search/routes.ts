/**
 * Unified search API (design doc §4.3).
 *
 * GET /search?q=<term>&clinic=<uuid>
 *
 * Searches across patients (name, ID), protocol templates, staff members,
 * and returns static quick-action entries. Results are grouped by category.
 * RLS ensures therapists only see their own patients; managers see the clinic.
 *
 * Hebrew and Arabic search uses ILIKE which is accent-insensitive in PostgreSQL
 * when the collation supports it. For now we do simple case-insensitive matching.
 */
import { Hono, type Context } from "hono";
import type pg from "pg";
import { withUser, type Env } from "../../context.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SearchResult {
  id: string;
  kind: "patient" | "protocol" | "staff" | "action" | "page";
  title: string;
  subtitle?: string | undefined;
  url: string;
  icon?: string | undefined;
}

export function searchRoutes(pool: pg.Pool) {
  const app = new Hono<Env>();

  const run = <T>(c: Context<Env>, fn: (db: pg.PoolClient) => Promise<T>) =>
    withUser(pool, c.get("user").id, c.get("requestId"), fn);

  /**
   * GET / — unified search.
   * Runs up to 3 parallel queries (patients, protocols, staff) and merges results.
   */
  app.get("/", async (c) => {
    const q = (c.req.query("q") ?? "").trim();
    const clinicId = c.req.query("clinic");

    if (!clinicId || !UUID_RE.test(clinicId)) {
      return c.json({ error: "clinic_required" }, 400);
    }

    // Empty query → return quick actions only
    if (!q) {
      return c.json({ results: quickActions(clinicId) });
    }

    const results = await run(c, async (db) => {
      const like = `%${q}%`;
      const limit = 8;

      // Run searches in parallel for speed
      const [patients, protocols, staff] = await Promise.all([
        // Patients: name or family name match
        db.query<{
          id: string;
          given_name: string;
          family_name: string;
          dob: string | null;
        }>(
          `SELECT p.id, p.given_name, p.family_name, p.date_of_birth::text AS dob
             FROM app.patient p
            WHERE p.clinic_id = $1
              AND p.deleted_at IS NULL
              AND (p.given_name ILIKE $2 OR p.family_name ILIKE $2
                   OR (p.given_name || ' ' || p.family_name) ILIKE $2)
            ORDER BY p.family_name, p.given_name
            LIMIT $3`,
          [clinicId, like, limit],
        ),

        // Protocol templates
        db.query<{ id: string; name: string; description: string | null }>(
          `SELECT pt.id, pt.name, pt.description
             FROM app.protocol_template pt
            WHERE pt.clinic_id = $1
              AND pt.deleted_at IS NULL
              AND (pt.name ILIKE $2 OR COALESCE(pt.description, '') ILIKE $2)
            ORDER BY pt.name
            LIMIT $3`,
          [clinicId, like, limit],
        ),

        // Staff members (via membership → auth.user)
        db.query<{ id: string; name: string; email: string; role: string }>(
          `SELECT u.id, u.name, u.email, m.role
             FROM app.membership m
             JOIN auth."user" u ON u.id = m.user_id
            WHERE m.clinic_id = $1
              AND m.deleted_at IS NULL
              AND (u.name ILIKE $2 OR u.email ILIKE $2)
            ORDER BY u.name
            LIMIT $3`,
          [clinicId, like, limit],
        ),
      ]);

      const out: SearchResult[] = [];

      for (const p of patients.rows) {
        out.push({
          id: p.id,
          kind: "patient",
          title: `${p.given_name} ${p.family_name}`,
          subtitle: p.dob ?? undefined,
          url: `/patients/${p.id}`,
          icon: "user",
        });
      }

      for (const pt of protocols.rows) {
        out.push({
          id: pt.id,
          kind: "protocol",
          title: pt.name,
          subtitle: pt.description ?? undefined,
          url: `/protocols/${pt.id}/edit`,
          icon: "route",
        });
      }

      for (const s of staff.rows) {
        out.push({
          id: s.id,
          kind: "staff",
          title: s.name,
          subtitle: s.role,
          url: `/team`,
          icon: "users",
        });
      }

      return out;
    });

    // Add matching quick actions
    const actions = quickActions(clinicId).filter(
      (a) => a.title.toLowerCase().includes(q.toLowerCase()),
    );

    return c.json({ results: [...results, ...actions] });
  });

  return app;
}

/** Static quick-action entries for the command palette. */
function quickActions(_clinicId: string): SearchResult[] {
  return [
    { id: "action:new-patient", kind: "action", title: "New patient", url: "/patients/new", icon: "user-plus" },
    { id: "action:new-protocol", kind: "action", title: "New protocol", url: "/protocols/new", icon: "route" },
    { id: "page:calendar", kind: "page", title: "Calendar", url: "/calendar", icon: "calendar" },
    { id: "page:messages", kind: "page", title: "Messages", url: "/messages", icon: "message-square" },
    { id: "page:reports", kind: "page", title: "Reports", url: "/reports", icon: "bar-chart" },
    { id: "page:settings", kind: "page", title: "Settings", url: "/settings", icon: "settings" },
    { id: "page:team", kind: "page", title: "Team", url: "/team", icon: "users" },
    { id: "page:library", kind: "page", title: "Game library", url: "/library", icon: "book-open" },
  ];
}
