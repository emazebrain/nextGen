#!/usr/bin/env node
/**
 * Apply migration 0020 statements one-by-one, reporting which succeed/fail.
 * Run on Railway shell:
 *   eval "$(mise activate bash)"
 *   node --experimental-strip-types /app/packages/db/scripts/apply-0020.ts
 */
import pg from "pg";

const steps: Array<{ label: string; sql: string }> = [
  {
    label: "1. Drop over-permissive self-activate policy",
    sql: `DROP POLICY IF EXISTS user_self_activate ON app.app_user;`,
  },
  {
    label: "2. Create user_read_self policy",
    sql: `DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'app' AND tablename = 'app_user' AND policyname = 'user_read_self'
  ) THEN
    EXECUTE $p$
      CREATE POLICY user_read_self ON app.app_user FOR SELECT
        USING (id = app.current_user_id())
    $p$;
  END IF;
END $$;`,
  },
  {
    label: "3. Create app.self_activate() function",
    sql: `CREATE OR REPLACE FUNCTION app.self_activate()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = app, pg_temp
AS $$
DECLARE
  _uid uuid := app.current_user_id();
  _status text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'no authenticated user';
  END IF;
  SELECT status INTO _status FROM app.app_user WHERE id = _uid FOR UPDATE;
  IF _status IS NULL THEN
    RAISE EXCEPTION 'user not found';
  END IF;
  IF _status <> 'invited' THEN
    RAISE EXCEPTION 'only invited users may self-activate (current: %)', _status;
  END IF;
  UPDATE app.app_user SET status = 'active' WHERE id = _uid;
END;
$$;`,
  },
  {
    label: "4. Grant SELECT, UPDATE on app_user to emb_rls_helper",
    sql: `GRANT SELECT, UPDATE ON app.app_user TO emb_rls_helper;`,
  },
  {
    label: "5. Change function owner to emb_rls_helper",
    sql: `ALTER FUNCTION app.self_activate() OWNER TO emb_rls_helper;`,
  },
  {
    label: "6. Grant execute to emb_app",
    sql: `GRANT EXECUTE ON FUNCTION app.self_activate() TO emb_app;`,
  },
  {
    label: "7. Create audit trigger on app_user",
    sql: `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='audit_app_user' AND tgrelid='app.app_user'::regclass) THEN
    CREATE TRIGGER audit_app_user AFTER INSERT OR UPDATE OR DELETE ON app.app_user FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
  END IF;
END $$;`,
  },
  {
    label: "8. Create audit trigger on organization",
    sql: `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='audit_organization' AND tgrelid='app.organization'::regclass) THEN
    CREATE TRIGGER audit_organization AFTER INSERT OR UPDATE OR DELETE ON app.organization FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
  END IF;
END $$;`,
  },
  {
    label: "9. Record migration as applied",
    sql: `INSERT INTO public.schema_migrations (name) VALUES ('0020_tighten_self_activate.sql') ON CONFLICT (name) DO NOTHING;`,
  },
];

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const results: Array<{ label: string; ok: boolean; error?: string }> = [];
  let stopAt: number | null = null;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    // Skip recording if any step failed
    if (stopAt !== null && i === steps.length - 1) {
      console.log(`\n⏭  Skipping "${step.label}" — earlier step failed.`);
      break;
    }
    // Skip steps that depend on a failed step
    if (stopAt !== null && i > stopAt) {
      // Steps 4-6 depend on step 3 (the function)
      if (stopAt === 2 && i >= 3 && i <= 5) {
        console.log(`⏭  Skipping "${step.label}" — depends on step 3.`);
        results.push({ label: step.label, ok: false, error: "skipped (depends on failed step)" });
        continue;
      }
    }

    try {
      await client.query(step.sql);
      console.log(`✅ ${step.label}`);
      results.push({ label: step.label, ok: true });
    } catch (err: any) {
      console.log(`❌ ${step.label}`);
      console.log(`   Error: ${err.message}`);
      results.push({ label: step.label, ok: false, error: err.message });
      if (stopAt === null) stopAt = i;
    }
  }

  console.log("\n--- Summary ---");
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.log("\nFailed steps:");
    for (const r of results.filter((r) => !r.ok)) {
      console.log(`  - ${r.label}: ${r.error}`);
    }
  }

  await client.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
