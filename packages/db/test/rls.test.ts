/**
 * Clinic isolation tests against a real Postgres (design doc §6, §10.1).
 * Needs DATABASE_URL pointing at a superuser connection; each run creates and
 * drops its own throwaway database. In CI this runs against a Postgres service.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { migrate } from "../src/migrate.ts";

const ADMIN_URL = process.env.DATABASE_URL;
const dbName = `emb_test_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
let db: pg.Client;

// Fixed ids so failures are readable.
const ids = {
  org1: randomUUID(), org2: randomUUID(),
  clinic1: randomUUID(), clinic2: randomUUID(),
  therapistA: randomUUID(), therapistB: randomUUID(), managerM: randomUUID(), outsider: randomUUID(),
  admin: randomUUID(),
  p1: randomUUID(), p2: randomUUID(), p3: randomUUID(),
};

/** Run `fn` as the application role with app.user_id set, inside a rolled-back transaction. */
async function asUser<T>(userId: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  await db.query("BEGIN");
  try {
    await db.query("SET LOCAL ROLE emb_app");
    await db.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    return await fn(db);
  } finally {
    await db.query("ROLLBACK");
  }
}

const patientIds = async (c: pg.Client) =>
  (await c.query<{ id: string }>("SELECT id FROM app.patient ORDER BY id")).rows.map((r) => r.id).sort();

describe.skipIf(!ADMIN_URL)("row-level security", () => {
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();

    const url = new URL(ADMIN_URL!);
    url.pathname = `/${dbName}`;
    db = new pg.Client({ connectionString: url.toString() });
    await db.connect();
    await migrate(db);

    // Seed as superuser (bypasses RLS).
    await db.query(
      `INSERT INTO app.organization (id, name, region) VALUES ($1,'Org One','il'), ($2,'Org Two','il')`,
      [ids.org1, ids.org2],
    );
    await db.query(
      `INSERT INTO app.clinic (id, organization_id, name, country_code, timezone)
       VALUES ($1,$2,'Clinic One','IL','Asia/Jerusalem'), ($3,$4,'Clinic Two','IL','Asia/Jerusalem')`,
      [ids.clinic1, ids.org1, ids.clinic2, ids.org2],
    );
    for (const [id, name] of [
      [ids.therapistA, "Yael"], [ids.therapistB, "Dana"], [ids.managerM, "Ronit"], [ids.outsider, "Nobody"],
    ] as const) {
      await db.query(`INSERT INTO app.app_user (id, email, full_name, kind, status) VALUES ($1,$2,$3,'staff','active')`, [
        id, `${name.toLowerCase()}@example.test`, name,
      ]);
    }
    await db.query(
      `INSERT INTO app.membership (user_id, organization_id, clinic_id, role) VALUES
        ($1,$4,$5,'therapist'), ($2,$6,$7,'therapist'), ($3,$4,$5,'clinic_manager')`,
      [ids.therapistA, ids.therapistB, ids.managerM, ids.org1, ids.clinic1, ids.org2, ids.clinic2],
    );
    await db.query(
      `INSERT INTO app.patient (id, clinic_id, given_name, family_name, date_of_birth) VALUES
        ($1,$4,'Noa','Levi','2018-03-01'), ($2,$4,'Daniel','Cohen','2016-07-12'), ($3,$5,'Omer','Mizrahi','2017-01-20')`,
      [ids.p1, ids.p2, ids.p3, ids.clinic1, ids.clinic2],
    );
    await db.query(
      `INSERT INTO app.patient_care_team (patient_id, user_id) VALUES ($1,$2), ($3,$4)`,
      [ids.p1, ids.therapistA, ids.p3, ids.therapistB],
    );
    // Platform admin: org-wide membership with no clinic.
    await db.query(
      `INSERT INTO app.app_user (id, email, full_name, kind, status) VALUES ($1,'admin@synthetic.test','Admin','staff','active')`,
      [ids.admin],
    );
    await db.query(
      `INSERT INTO app.membership (user_id, organization_id, clinic_id, role) VALUES ($1,$2,NULL,'platform_admin')`,
      [ids.admin, ids.org1],
    );
  });

  afterAll(async () => {
    if (db) await db.end();
    if (!ADMIN_URL) return;
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  });

  it("a therapist sees only patients on their care team", async () => {
    expect(await asUser(ids.therapistA, patientIds)).toEqual([ids.p1]);
  });

  it("a clinic manager sees every patient in their clinic and none elsewhere", async () => {
    expect(await asUser(ids.managerM, patientIds)).toEqual([ids.p1, ids.p2].sort());
  });

  it("a therapist in another clinic sees nothing from clinic one", async () => {
    expect(await asUser(ids.therapistB, patientIds)).toEqual([ids.p3]);
  });

  it("a user with no membership sees no patients, clinics or organizations", async () => {
    await asUser(ids.outsider, async (c) => {
      expect((await c.query("SELECT 1 FROM app.patient")).rowCount).toBe(0);
      expect((await c.query("SELECT 1 FROM app.clinic")).rowCount).toBe(0);
      expect((await c.query("SELECT 1 FROM app.organization")).rowCount).toBe(0);
    });
  });

  it("no session user means no rows at all", async () => {
    await asUser("", async (c) => {
      expect((await c.query("SELECT 1 FROM app.patient")).rowCount).toBe(0);
    });
  });

  it("a therapist cannot create a patient in another clinic", async () => {
    await expect(
      asUser(ids.therapistA, (c) =>
        c.query(
          `INSERT INTO app.patient (clinic_id, given_name, family_name, date_of_birth) VALUES ($1,'X','Y','2019-01-01')`,
          [ids.clinic2],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("a therapist cannot move a patient to another clinic", async () => {
    await expect(
      asUser(ids.therapistA, (c) => c.query(`UPDATE app.patient SET clinic_id = $1 WHERE id = $2`, [ids.clinic2, ids.p1])),
    ).rejects.toThrow(/row-level security|cannot move between clinics/);
  });

  it("a manager cannot grant a manager-level role", async () => {
    await expect(
      asUser(ids.managerM, (c) =>
        c.query(
          `INSERT INTO app.membership (user_id, organization_id, clinic_id, role) VALUES ($1,$2,$3,'clinic_manager')`,
          [ids.outsider, ids.org1, ids.clinic1],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("consent records are append-only, even for a superuser", async () => {
    await asUser(ids.therapistA, (c) =>
      c.query(
        `INSERT INTO app.consent (patient_id, purpose, decision, policy_version, method, captured_by, record_hash)
         VALUES ($1,'treatment','granted','v1','in_clinic_esign',$2,'\\x00')`,
        [ids.p1, ids.therapistA],
      ),
    );
    await db.query(
      `INSERT INTO app.consent (patient_id, purpose, decision, policy_version, method, captured_by, record_hash)
       VALUES ($1,'treatment','granted','v1','in_clinic_esign',$2,'\\x00')`,
      [ids.p1, ids.therapistA],
    );
    await expect(db.query(`UPDATE app.consent SET decision = 'withdrawn'`)).rejects.toThrow(/append-only/);
    await expect(db.query(`DELETE FROM app.consent`)).rejects.toThrow(/append-only/);
  });

  it("every table in schema app has row-level security enabled and forced", async () => {
    const { rows } = await db.query<{ relname: string; rls: boolean; forced: boolean }>(
      `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'app' AND c.relkind IN ('r', 'p')`,
    );
    expect(rows.length).toBeGreaterThan(0);
    const missing = rows.filter((r) => !r.rls || !r.forced).map((r) => r.relname);
    expect(missing, `tables without forced RLS: ${missing.join(", ")}`).toEqual([]);
  });

  // Postgres works out a policy loop when it plans a statement, whatever the data. Planning every kind of statement
  // on every table as the app role therefore proves no policy leads back to its own table (the 0025 parent-portal
  // policy did, through guardian_patient; migration 0041 removed it and this keeps it from returning).
  it("no policy loops back to its own table, for any statement on any table", async () => {
    const { rows } = await db.query<{ t: string; col: string }>(
      `SELECT c.relname AS t, (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum LIMIT 1) AS col
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'app' AND c.relkind = 'r' ORDER BY 1`,
    );
    const loops: string[] = [];
    for (const { t, col } of rows) {
      for (const sql of [
        `SELECT 1 FROM app."${t}"`,
        `INSERT INTO app."${t}" SELECT * FROM app."${t}" WHERE false`,
        `UPDATE app."${t}" SET "${col}" = "${col}" WHERE false`,
        `DELETE FROM app."${t}" WHERE false`,
      ]) {
        await asUser(ids.therapistA, async (c) => {
          await c.query("SAVEPOINT plan");
          const err = await c.query(`EXPLAIN ${sql}`).then(
            () => null,
            (e: Error) => e.message,
          );
          await c.query("ROLLBACK TO SAVEPOINT plan");
          // Not being allowed to write a table is fine here; only a loop is a defect.
          if (err && /infinite recursion/.test(err)) loops.push(`${sql.split(" ")[0]} ${t}: ${err}`);
        });
      }
    }
    expect(loops).toEqual([]);
  });

  it("the application role cannot bypass RLS", async () => {
    const { rows } = await db.query<{ rolbypassrls: boolean }>(
      `SELECT rolbypassrls FROM pg_roles WHERE rolname = 'emb_app'`,
    );
    expect(rows[0]?.rolbypassrls).toBe(false);
  });

  // --- Platform-admin policies (0019) ---

  it("platform admin can read all organizations", async () => {
    await asUser(ids.admin, async (c) => {
      const { rows } = await c.query("SELECT id FROM app.organization ORDER BY id");
      expect(rows.map(r => r.id).sort()).toEqual([ids.org1, ids.org2].sort());
    });
  });

  it("platform admin can insert an organization", async () => {
    await asUser(ids.admin, async (c) => {
      await c.query("INSERT INTO app.organization (id, name, region) VALUES ($1, 'New Org', 'us')", [randomUUID()]);
    });
  });

  it("platform admin can update any clinic", async () => {
    await asUser(ids.admin, async (c) => {
      await c.query("UPDATE app.clinic SET name = 'Renamed' WHERE id = $1", [ids.clinic2]);
      const { rows } = await c.query("SELECT name FROM app.clinic WHERE id = $1", [ids.clinic2]);
      expect(rows[0].name).toBe("Renamed");
    });
  });

  it("platform admin can read and insert memberships across orgs", async () => {
    await asUser(ids.admin, async (c) => {
      const { rows } = await c.query("SELECT id FROM app.membership");
      expect(rows.length).toBeGreaterThan(0);
      await c.query(
        "INSERT INTO app.membership (user_id, organization_id, clinic_id, role) VALUES ($1, $2, $3, 'therapist')",
        [ids.therapistA, ids.org2, ids.clinic2],
      );
    });
  });

  it("platform admin can read all app_user rows", async () => {
    await asUser(ids.admin, async (c) => {
      const { rows } = await c.query("SELECT id FROM app.app_user");
      expect(rows.length).toBeGreaterThanOrEqual(5); // therapistA, therapistB, managerM, outsider, admin
    });
  });

  it("user can self-activate from invited to active via self_activate()", async () => {
    const selfActivate = randomUUID();
    await db.query("INSERT INTO app.app_user (id, email, full_name, kind, status) VALUES ($1, 'sa@test', 'SA', 'staff', 'invited')", [selfActivate]);
    await asUser(selfActivate, async (c) => {
      await c.query("SELECT app.self_activate()");
      const { rows } = await c.query("SELECT status FROM app.app_user WHERE id = $1", [selfActivate]);
      expect(rows[0].status).toBe("active");
    });
  });

  it("self_activate() rejects disabled → active (I2)", async () => {
    const disabled = randomUUID();
    await db.query("INSERT INTO app.app_user (id, email, full_name, kind, status) VALUES ($1, 'dis@test', 'DIS', 'staff', 'disabled')", [disabled]);
    await asUser(disabled, async (c) => {
      await expect(c.query("SELECT app.self_activate()")).rejects.toThrow(/only invited/);
    });
  });

  it("self_activate() rejects already-active user", async () => {
    const active = randomUUID();
    await db.query("INSERT INTO app.app_user (id, email, full_name, kind, status) VALUES ($1, 'act@test', 'ACT', 'staff', 'active')", [active]);
    await asUser(active, async (c) => {
      await expect(c.query("SELECT app.self_activate()")).rejects.toThrow(/only invited/);
    });
  });

  it("user cannot UPDATE their own app_user row directly (I1)", async () => {
    const noUpdate = randomUUID();
    await db.query("INSERT INTO app.app_user (id, email, full_name, kind, status) VALUES ($1, 'nu@test', 'NU', 'staff', 'invited')", [noUpdate]);
    await asUser(noUpdate, async (c) => {
      // No UPDATE policy exists for non-admins now — raw UPDATE should affect 0 rows
      const res = await c.query("UPDATE app.app_user SET email = 'hacked@test' WHERE id = $1", [noUpdate]);
      expect(res.rowCount).toBe(0);
      // Verify unchanged
      const { rows } = await c.query("SELECT email FROM app.app_user WHERE id = $1", [noUpdate]);
      expect(rows[0].email).toBe("nu@test");
    });
  });

  it("non-admin cannot read orgs outside their membership", async () => {
    await asUser(ids.outsider, async (c) => {
      const { rows } = await c.query("SELECT id FROM app.organization");
      expect(rows).toHaveLength(0);
    });
  });

  it("generates time-ordered UUIDv7 keys", async () => {
    const first = await db.query<{ u: string }>(`SELECT app.uuidv7()::text AS u`);
    await db.query(`SELECT pg_sleep(0.005)`);
    const second = await db.query<{ u: string }>(`SELECT app.uuidv7()::text AS u`);
    const [a, b] = [first.rows[0]!.u, second.rows[0]!.u];
    expect(a[14]).toBe("7");
    expect(a < b).toBe(true);
  });
});
