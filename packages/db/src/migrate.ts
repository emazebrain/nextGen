/**
 * Minimal forward-only migration runner. Applies migrations/*.sql in name
 * order, once each, inside a transaction, and records them in
 * public.schema_migrations. Drizzle replaces this once the schema grows
 * (design doc §9.3); the SQL files stay the source of truth for RLS.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export async function migrate(client: pg.Client, dir = MIGRATIONS_DIR): Promise<string[]> {
  await client.query(
    "CREATE TABLE IF NOT EXISTS public.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const done = new Set(
    (await client.query<{ name: string }>("SELECT name FROM public.schema_migrations")).rows.map((r) => r.name),
  );
  // Ensure the migration runner can access the app schema.
  // On Supabase, the postgres role sometimes loses direct schema access after
  // platform updates. We SET ROLE to the schema owner, grant access to the
  // connected user, then reset.
  try {
    await client.query(`
      DO $$
      DECLARE
        v_owner text;
        v_me    text := current_user;
      BEGIN
        SELECT nspowner::regrole::text INTO v_owner
          FROM pg_namespace WHERE nspname = 'app';
        IF v_owner IS NULL THEN RETURN; END IF;
        IF v_owner = v_me THEN RETURN; END IF;
        -- Become the schema owner to grant access
        BEGIN
          EXECUTE format('SET LOCAL ROLE %I', v_owner);
          EXECUTE format('GRANT ALL ON SCHEMA app TO %I', v_me);
          EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA app TO %I', v_me);
          EXECUTE format('GRANT ALL ON ALL FUNCTIONS IN SCHEMA app TO %I', v_me);
          EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA app TO %I', v_me);
          RESET ROLE;
        EXCEPTION WHEN OTHERS THEN
          RESET ROLE;
          -- Last resort: try direct grant
          BEGIN
            EXECUTE format('GRANT ALL ON SCHEMA app TO %I', v_me);
          EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'migrate: cannot grant schema app to %: %', v_me, SQLERRM;
          END;
        END;
      END $$;
    `);
  } catch {
    // Best-effort; if we can't grant, the migration will fail with a clear error
  }

  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(join(dir, file), "utf8");
    for (let attempt = 1; ; attempt++) {
      await client.query("BEGIN");
      try {
        await client.query(sql);
        // The migration SQL may already contain its own INSERT INTO schema_migrations
        // (for manual execution in Supabase SQL Editor). Use ON CONFLICT to avoid duplicates.
        await client.query("INSERT INTO public.schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [file]);
        await client.query("COMMIT");
        applied.push(file);
        break;
      } catch (err) {
        await client.query("ROLLBACK");
        // Roles are cluster-wide. When two databases on one server migrate at the
        // same moment (parallel test runs), both can pass "IF NOT EXISTS" and one
        // CREATE ROLE loses. The transaction rolled back, so running it again is safe.
        if (attempt < 3 && isConcurrentRoleCreate(err)) continue;
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
  }
  return applied;
}

function isConcurrentRoleCreate(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string };
  return (e.code === "23505" && e.constraint === "pg_authid_rolname_index") || e.code === "42710";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const applied = await migrate(client);
    console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Up to date");
  } finally {
    await client.end();
  }
}
