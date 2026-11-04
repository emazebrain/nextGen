/**
 * Local development seed. Synthetic data only (CLAUDE.md invariant 1).
 *
 *   DATABASE_URL=postgres://… AUTH_SECRET=… node --experimental-strip-types scripts/seed-dev.ts
 *
 * Creates one organization with two clinics; Yael (therapist in both), Dana
 * (therapist) and Ronit (clinic manager) in Tel Aviv; synthetic patients on
 * Yael's caseload, each with a synthetic parent, and consent where the
 * patient is active. Safe to re-run: it stops if the
 * therapist already exists. Two-step sign-in is set up in the app on first
 * sign-in, exactly as a real therapist would.
 */
import pg from "pg";
import { migrate } from "../../../packages/db/src/migrate.ts";
import { SYNTHETIC_EMAIL_DOMAIN, syntheticGuardian, syntheticPatients } from "../../../packages/db/src/synthetic.ts";
import { scheduleDates } from "../../../packages/contracts/src/protocols.ts";
import { authPool, createAuth } from "../src/auth.ts";
import { uuidv7 } from "../src/ids.ts";

const url = process.env.DATABASE_URL;
const secret = process.env.AUTH_SECRET;
if (!url || !secret) throw new Error("DATABASE_URL and AUTH_SECRET are required");

export const SEED = {
  email: process.env.SEED_EMAIL ?? `yael@${SYNTHETIC_EMAIL_DOMAIN}`,
  password: process.env.SEED_PASSWORD ?? "correct horse battery staple",
  name: "Yael Bar",
};

const admin = new pg.Client({ connectionString: url });
await admin.connect();
await migrate(admin);

const existing = await admin.query(`SELECT id FROM app.app_user WHERE email = $1`, [SEED.email]);
if (existing.rowCount) {
  console.log(`seed: ${SEED.email} already exists, nothing to do`);
} else {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const authDb = authPool(url);
  const auth = createAuth({ databaseUrl: url, secret, baseURL: "http://localhost:8787", pool: authDb, rateLimit: false }, pool);
  const signUp = async (email: string, name: string) =>
    (await auth.api.signUpEmail({ body: { email, password: SEED.password, name } })).user.id;
  const yael = await signUp(SEED.email, SEED.name);
  const dana = await signUp(`dana@${SYNTHETIC_EMAIL_DOMAIN}`, "Dana Kaplan");
  const ronit = await signUp(`ronit@${SYNTHETIC_EMAIL_DOMAIN}`, "Ronit Avraham");
  // More therapists, so each end-to-end journey can sign in as its own person.
  const extra = [
    await signUp(`gil@${SYNTHETIC_EMAIL_DOMAIN}`, "Gil Mizrahi"),
    await signUp(`tal@${SYNTHETIC_EMAIL_DOMAIN}`, "Tal Peretz"),
    await signUp(`shira@${SYNTHETIC_EMAIL_DOMAIN}`, "Shira Ben David"),
    await signUp(`noam@${SYNTHETIC_EMAIL_DOMAIN}`, "Noam Shapiro"),
    await signUp(`maya@${SYNTHETIC_EMAIL_DOMAIN}`, "Maya Levin"),
    await signUp(`ofir@${SYNTHETIC_EMAIL_DOMAIN}`, "Ofir Navon"),
  ];

  const org = uuidv7();
  const clinics = [
    { id: uuidv7(), name: "Tel Aviv Child Development Center" },
    { id: uuidv7(), name: "Haifa North Clinic" },
  ];
  await admin.query("BEGIN");
  await admin.query(`INSERT INTO app.organization (id, name, region) VALUES ($1, 'Synthetic Health Network', 'il')`, [org]);
  for (const [i, c] of clinics.entries()) {
    await admin.query(`INSERT INTO app.clinic (id, organization_id, name, country_code, timezone) VALUES ($1,$2,$3,'IL','Asia/Jerusalem')`, [c.id, org, c.name]);
    await admin.query(`INSERT INTO app.membership (user_id, organization_id, clinic_id, role) VALUES ($1,$2,$3,'therapist')`, [yael, org, c.id]);
    if (i === 0) {
      await admin.query(`INSERT INTO app.membership (user_id, organization_id, clinic_id, role) VALUES ($1,$2,$3,'therapist'), ($4,$2,$3,'clinic_manager')`, [dana, org, c.id, ronit]);
      for (const u of extra) await admin.query(`INSERT INTO app.membership (user_id, organization_id, clinic_id, role) VALUES ($1,$2,$3,'therapist')`, [u, org, c.id]);
    }
    const people = syntheticPatients(i === 0 ? 14 : 5, { seed: 7 + i, locale: i === 0 ? "mixed" : "he" });
    for (const [n, p] of people.entries()) {
      const id = uuidv7();
      await admin.query(
        `INSERT INTO app.patient (id, clinic_id, given_name, family_name, date_of_birth, preferred_locale, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, c.id, p.given_name, p.family_name, p.date_of_birth, p.preferred_locale, yael],
      );
      await admin.query(`INSERT INTO app.patient_care_team (patient_id, user_id) VALUES ($1,$2)`, [id, yael]);
      // Tal, Shira, Noam and Maya share Yael's Tel Aviv caseload as secondary therapists.
      if (i === 0) for (const u of extra.slice(1)) await admin.query(`INSERT INTO app.patient_care_team (patient_id, user_id, role) VALUES ($1,$2,'secondary')`, [id, u]);
      const g = syntheticGuardian(p, 1000 * (i + 1) + n);
      const gid = uuidv7();
      await admin.query(
        `INSERT INTO app.guardian (id, clinic_id, full_name, phone, preferred_locale, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
        [gid, c.id, g.full_name, g.phone, p.preferred_locale, yael],
      );
      await admin.query(`INSERT INTO app.guardian_patient (guardian_id, patient_id, relationship) VALUES ($1,$2,$3)`, [gid, id, g.relationship]);
      // Consent drives status: active and inactive patients have consent for clinic sessions.
      if (p.status === "active" || p.status === "inactive") {
        await admin.query(
          `INSERT INTO app.consent (patient_id, guardian_id, purpose, decision, policy_version, method, locale, signer_name, captured_by, record_hash)
           VALUES ($1,$2,'treatment','granted','draft-2026-10','in_clinic_esign',$3,$4,$5,'\\x')`,
          [id, gid, p.preferred_locale, g.full_name, yael],
        );
      }
      if (p.status === "inactive" || p.status === "consent_legacy") {
        await admin.query(`UPDATE app.patient SET status = $2 WHERE id = $1`, [id, p.status]);
      }
    }
  }
  // eMazeBrain library templates (content pipeline in production) and a running protocol for a few patients.
  const steps = {
    starter: [
      { game_id: "catch-me-if-you-can", session_mode: "timed_lives", duration_s: 180, lives: 3, difficulty_start: 2, hemisphere: "left", timer_position: "right", trial_window_ms: null },
      { game_id: "catch-me-if-you-can", session_mode: "timed", duration_s: 120, lives: null, difficulty_start: 2, hemisphere: "right", timer_position: "left", trial_window_ms: null },
    ],
    discrimination: [
      { game_id: "catch-me-if-you-can", session_mode: "lives", duration_s: null, lives: 5, difficulty_start: 3, hemisphere: "left", timer_position: "right", trial_window_ms: 8000 },
    ],
  };
  const progression = JSON.stringify({ metric: "accuracy", up_at: 0.8, up_after: 2, down_below: 0.5, down_after: 1 });
  const templates = [
    { id: uuidv7(), name: "Visual attention starter", description: "Two short rounds of Catch Me If You Can, one per hemisphere.", weeks: 4, perWeek: 2, steps: steps.starter },
    { id: uuidv7(), name: "Visual discrimination", description: "Finding smaller and smaller colour differences, with a time limit per board.", weeks: 6, perWeek: 3, steps: steps.discrimination },
  ];
  for (const t of templates) {
    await admin.query(
      `INSERT INTO app.protocol_template (id, name, description, weeks, sessions_per_week, setting, visibility) VALUES ($1,$2,$3,$4,$5,'clinic','platform')`,
      [t.id, t.name, t.description, t.weeks, t.perWeek],
    );
    for (const [i, st] of t.steps.entries()) {
      await admin.query(
        `INSERT INTO app.template_step (template_id, ordinal, game_id, session_mode, duration_s, lives, difficulty_start, hemisphere, timer_position, practice, trial_window_ms, progression)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'auto',$10,$11)`,
        [t.id, i + 1, st.game_id, st.session_mode, st.duration_s, st.lives, st.difficulty_start, st.hemisphere, st.timer_position, st.trial_window_ms, progression],
      );
    }
  }
  const telAviv = clinics[0]!.id;
  const active = await admin.query<{ id: string }>(
    `SELECT id FROM app.patient WHERE clinic_id = $1 AND status = 'active' ORDER BY family_name, given_name LIMIT 4`,
    [telAviv],
  );
  const starter = templates[0]!;
  for (const [n, row] of active.rows.entries()) {
    const start = new Date(Date.now() - (n === 3 ? 2 : 0) * 86_400_000).toLocaleDateString("en-CA");
    const aid = uuidv7();
    await admin.query(
      `INSERT INTO app.protocol_assignment (id, patient_id, clinic_id, template_id, template_version, assigned_by, name, start_date, weeks, sessions_per_week)
       VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8,$9)`,
      [aid, row.id, telAviv, starter.id, yael, starter.name, start, starter.weeks, starter.perWeek],
    );
    for (const [i, st] of starter.steps.entries()) {
      await admin.query(
        `INSERT INTO app.assignment_step (assignment_id, patient_id, ordinal, game_id, session_mode, duration_s, lives, difficulty_start, current_difficulty, hemisphere, timer_position, practice, trial_window_ms, progression)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,'auto',$11,$12)`,
        [aid, row.id, i + 1, st.game_id, st.session_mode, st.duration_s, st.lives, st.difficulty_start, st.hemisphere, st.timer_position, st.trial_window_ms, progression],
      );
    }
    for (const s of scheduleDates(start, starter.weeks, starter.perWeek)) {
      await admin.query(`INSERT INTO app.planned_session (assignment_id, patient_id, clinic_id, seq, week, planned_date) VALUES ($1,$2,$3,$4,$5,$6)`, [aid, row.id, telAviv, s.seq, s.week, s.date]);
    }
  }
  await seedHistory(admin, { clinic: telAviv, therapist: yael, shared: extra.slice(1), template: templates[1]! });
  await admin.query("COMMIT");
  await pool.end();
  await authDb.end();
  console.log(`seed: created ${SEED.email}, dana@ and ronit@${SYNTHETIC_EMAIL_DOMAIN} (password "${SEED.password}"), 2 clinics, 20 synthetic patients (one with 12 sessions of history)`);
}
await admin.end();

/**
 * One patient with a finished six-week protocol and twelve played sessions,
 * so the Progress view has a real trend to show (slice 5). Difficulty goes
 * from 3 to 4 after session 5, with the dip that usually follows a harder
 * level. Every value is invented.
 */
async function seedHistory(
  db: pg.Client,
  o: { clinic: string; therapist: string; shared: string[]; template: { id: string; name: string; steps: Array<Record<string, unknown>> } },
) {
  const DAY = 86_400_000;
  const patient = uuidv7();
  await db.query(
    `INSERT INTO app.patient (id, clinic_id, given_name, family_name, date_of_birth, preferred_locale, created_by)
     VALUES ($1,$2,'Ella','Navon',$3,'en',$4)`,
    [patient, o.clinic, new Date(Date.now() - 7.5 * 365.25 * DAY).toISOString().slice(0, 10), o.therapist],
  );
  await db.query(`INSERT INTO app.patient_care_team (patient_id, user_id) VALUES ($1,$2)`, [patient, o.therapist]);
  for (const u of o.shared) await db.query(`INSERT INTO app.patient_care_team (patient_id, user_id, role) VALUES ($1,$2,'secondary')`, [patient, u]);
  const guardian = uuidv7();
  await db.query(`INSERT INTO app.guardian (id, clinic_id, full_name, phone, preferred_locale, created_by) VALUES ($1,$2,'Dan Navon','+972500000999','en',$3)`, [guardian, o.clinic, o.therapist]);
  await db.query(`INSERT INTO app.guardian_patient (guardian_id, patient_id, relationship) VALUES ($1,$2,'father')`, [guardian, patient]);
  await db.query(
    `INSERT INTO app.consent (patient_id, guardian_id, purpose, decision, policy_version, method, locale, signer_name, captured_by, record_hash)
     VALUES ($1,$2,'treatment','granted','draft-2026-10','in_clinic_esign','en','Dan Navon',$3,'\\x')`,
    [patient, guardian, o.therapist],
  );

  const step0 = o.template.steps[0]!;
  const start = new Date(Date.now() - 45 * DAY);
  const assignment = uuidv7(start.getTime());
  await db.query(
    `INSERT INTO app.protocol_assignment (id, patient_id, clinic_id, template_id, template_version, assigned_by, name, start_date, weeks, sessions_per_week, status)
     VALUES ($1,$2,$3,$4,1,$5,$6,$7,6,2,'completed')`,
    [assignment, patient, o.clinic, o.template.id, o.therapist, o.template.name, start.toISOString().slice(0, 10)],
  );
  const step = uuidv7(start.getTime());
  await db.query(
    `INSERT INTO app.assignment_step (id, assignment_id, patient_id, ordinal, game_id, session_mode, duration_s, lives, difficulty_start, current_difficulty, hemisphere, timer_position, practice, trial_window_ms, progression, sessions_completed)
     VALUES ($1,$2,$3,1,$4,$5,$6,$7,3,4,$8,$9,'auto',$10,$11,12)`,
    [step, assignment, patient, step0.game_id, step0.session_mode, step0.duration_s, step0.lives, step0.hemisphere, step0.timer_position, step0.trial_window_ms,
      JSON.stringify({ metric: "accuracy", up_at: 0.8, up_after: 2, down_below: 0.5, down_after: 1 })],
  );

  const accuracy = [0.66, 0.7, 0.81, 0.84, 0.86, 0.68, 0.72, 0.75, 0.79, 0.83, 0.81, 0.86];
  const rt = [1450, 1400, 1320, 1260, 1200, 1380, 1330, 1300, 1250, 1210, 1230, 1180];
  const jnd = [14, 13, 11, 10, 9, 12, 11, 10.5, 9.5, 9, 9.2, 8.4];
  const anchor = [0.4, 0.45, 0.5, 0.55, 0.6, 0.5, 0.55, 0.58, 0.62, 0.66, 0.64, 0.7];
  for (let i = 0; i < 12; i++) {
    const ended = new Date(start.getTime() + (i * 3.5 + 0.4) * DAY);
    const difficulty = i < 5 ? 3 : 4;
    const planned = uuidv7(ended.getTime() - 1);
    await db.query(
      `INSERT INTO app.planned_session (id, assignment_id, patient_id, clinic_id, seq, week, planned_date, status, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'done',$8)`,
      [planned, assignment, patient, o.clinic, i + 1, Math.floor(i / 2) + 1, ended.toISOString().slice(0, 10), ended.toISOString()],
    );
    const trials = 24;
    const correct = Math.round(trials * accuracy[i]!);
    const id = uuidv7(ended.getTime());
    await db.query(
      `INSERT INTO app.game_session (id, patient_id, clinic_id, assignment_step_id, planned_session_id, recorded_by, game_id, game_version, status, end_reason,
         session_mode, difficulty, hemisphere, started_at, ended_at, active_ms, lives_start, lives_lost, lives_remaining, trials_total, correct, errors,
         accuracy, rt_median_ms, rt_mean_ms, highest_level, levels_completed, metrics, std)
       VALUES ($1,$2,$3,$4,$5,$6,'catch-me-if-you-can','2.0.0','out_of_lives','lives_depleted',
         'lives',$7,'left',$8,$9,$10,5,5,0,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [id, patient, o.clinic, step, planned, o.therapist, difficulty, new Date(ended.getTime() - 260_000).toISOString(), ended.toISOString(),
        240_000 + i * 6_000, trials, correct, trials - correct, accuracy[i], rt[i], rt[i]! + 60, difficulty + 2, difficulty + 1,
        JSON.stringify({ final_jnd: jnd[i], min_cleared_delta_e: jnd[i]! + 1.5, anchor_first_rate: anchor[i], best_streak: 4 + (i % 4), highest_level: difficulty + 2 }),
        JSON.stringify({ trials_total: trials, correct, errors: trials - correct, timeouts: 0, accuracy: accuracy[i], rt_median_ms: rt[i] })],
    );
    if (i === 4) {
      await db.query(
        `INSERT INTO app.progression_decision (assignment_step_id, patient_id, game_session_id, decided_at, action, from_difficulty, to_difficulty, inputs, reason)
         VALUES ($1,$2,$3,$4,'up',3,4,$5,'streak_up')`,
        [step, patient, id, ended.toISOString(), JSON.stringify({ accuracies: [accuracy[4], accuracy[3]] })],
      );
    }
  }
}
