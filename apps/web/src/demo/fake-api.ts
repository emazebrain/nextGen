/**
 * Demo build only (vite --mode demo): an in-browser stand-in for the API, so
 * the whole clinic loop can be clicked through on a tablet with no server:
 * patients and consent → protocols → Today → a session → Progress.
 *
 * It follows the real API's rules where the UI depends on them (consent
 * unlocks sessions; a result is stored once per session id; difficulty moves
 * with the same @emb/progression rules; a planned session is done when every
 * game has a result). It is not a security boundary: no tickets are signed,
 * nothing leaves the browser, and every record is synthetic. State lives in
 * sessionStorage, so closing the tab starts over.
 *
 * Demo rules: any email and a password of 12+ characters sign in; any six
 * digits other than 000000 pass as a code.
 */
import { syntheticGuardian, syntheticPatients } from "@emb/db/synthetic";
import { decide, type Rule } from "@emb/progression";
import { isVideoStep, scheduleDates } from "@emb/contracts";
import { AREAS, HEMISPHERES, LOBES } from "@emb/db/brain-regions";
import { timerPositionFor, timerShown } from "@emb/session-rules";
import type {
  AssignmentView,
  ConsentState,
  GameSessionView,
  GuardianView,
  LaunchPackage,
  PatientDetail,
  PatientListItem,
  ProgressionDecisionView,
  BrainRegion,
  GameStepInput,
  LaunchStep,
  StepInput,
  StepItem,
  TemplateDetail,
  TodayItem,
  VideoSummary,
  VideoViewInput,
} from "@emb/contracts";
import { findGame } from "../games/registry.ts";

const KEY = "emb.demo.v3";
const DAY = 86_400_000;
const ME = "0192f3a0-0000-7000-8000-0000000000a1";
const CLINIC_A = "0192f3a0-0000-7000-8000-00000000c11a";
const CLINIC_B = "0192f3a0-0000-7000-8000-00000000c11b";

type Auth = { email: string | null; name: string; mfa: boolean; stage: "out" | "pending_2fa" | "in" };
interface Patient extends Omit<PatientDetail, "can_play" | "guardians" | "consents" | "care_team"> {
  guardianIds: string[];
  legal: Record<string, boolean>;
  relationship: Record<string, GuardianView["relationship"]>;
}
interface Guardian extends Omit<GuardianView, "relationship" | "is_legal_guardian"> {}
interface Consent extends ConsentState {
  patient_id: string;
}
interface Assignment extends Omit<AssignmentView, "steps" | "sessions"> {
  patient_id: string;
  clinic_id: string;
  steps: Array<AssignmentView["steps"][number]>;
  sessions: Array<AssignmentView["sessions"][number]>;
}
interface GameRow extends GameSessionView {
  patient_id: string;
  assignment_step_id: string | null;
}
interface Decision extends ProgressionDecisionView {
  patient_id: string;
}
interface Db {
  auth: Auth;
  patients: Patient[];
  guardians: Guardian[];
  consents: Consent[];
  templates: TemplateDetail[];
  assignments: Assignment[];
  games: GameRow[];
  decisions: Decision[];
  /** The video library (ADR 0018); file_url points at the bundled synthetic clips or an uploaded blob. */
  videos: Array<VideoSummary & { file_url: string | null }>;
  views: VideoViewInput[];
  seq: number;
}

// ------------------------------------------------------------------ ids and dates

let counter = 0;
/** UUIDv7-shaped ids (time-ordered), like the device and server use. */
function uid(at = Date.now()): string {
  counter = (counter + 1) % 0xfff;
  const ms = at.toString(16).padStart(12, "0");
  const rand = Array.from({ length: 15 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${ms.slice(0, 8)}-${ms.slice(8, 12)}-7${counter.toString(16).padStart(3, "0")}-a${rand.slice(0, 3)}-${rand.slice(3, 15)}`;
}
const isoDay = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const today = () => isoDay(Date.now());

// ------------------------------------------------------------------ seed (synthetic only)

const PROGRESSION: Rule = { metric: "accuracy", up_at: 0.8, up_after: 2, down_below: 0.5, down_after: 1 };
function step(s: Partial<GameStepInput>): GameStepInput {
  return {
    game_id: "catch-me-if-you-can",
    session_mode: "timed_lives",
    duration_s: 180,
    lives: 3,
    difficulty_start: 2,
    hemisphere: "left",
    timer_position: "right", // opposite the hemisphere (ADR 0008)
    practice: "auto",
    trial_window_ms: null,
    game_params: {},
    progression: PROGRESSION,
    ...s,
  };
}

function seed(): Db {
  const db: Db = { auth: { email: null, name: "Yael Bar", mfa: false, stage: "out" }, patients: [], guardians: [], consents: [], templates: [], assignments: [], games: [], decisions: [], videos: seedVideos(), views: [], seq: 0 };
  const add = (clinic: string, p: ReturnType<typeof syntheticPatients>[number], n: number) => {
    const id = uid(Date.now() - 400 * DAY + n * 1000);
    const g = syntheticGuardian(p, 1000 + n);
    const gid = uid(Date.now() - 400 * DAY + n * 1000 + 1);
    db.guardians.push({ id: gid, full_name: g.full_name, email: null, phone: g.phone, preferred_locale: p.preferred_locale });
    db.patients.push({
      id,
      clinic_id: clinic,
      given_name: p.given_name,
      family_name: p.family_name,
      date_of_birth: p.date_of_birth,
      preferred_locale: p.preferred_locale,
      status: p.status === "active" || p.status === "inactive" ? p.status : p.status === "consent_legacy" ? "consent_legacy" : "pending_consent",
      sex: null,
      handedness: null,
      alert: null,
      colour_vision_deficiency: false,
      archived: false,
      guardianIds: [gid],
      legal: { [gid]: true },
      relationship: { [gid]: g.relationship },
    });
    if (p.status === "active" || p.status === "inactive") {
      db.consents.push({ patient_id: id, purpose: "treatment", decision: "granted", signed_at: new Date(Date.now() - 300 * DAY).toISOString(), signer_name: g.full_name, guardian_name: g.full_name, captured_by_name: "Yael Bar" });
    }
    return id;
  };
  syntheticPatients(14, { seed: 7, locale: "mixed" }).forEach((p, n) => add(CLINIC_A, p, n));
  syntheticPatients(5, { seed: 8, locale: "he" }).forEach((p, n) => add(CLINIC_B, p, 100 + n));

  const starter: TemplateDetail = {
    id: uid(Date.now() - 200 * DAY),
    name: "Visual attention starter",
    description: "Two short rounds of Catch Me If You Can, one per hemisphere.",
    weeks: 4,
    sessions_per_week: 2,
    setting: "clinic",
    visibility: "platform",
    version: 1,
    owner_name: null,
    can_edit: false,
    games: ["catch-me-if-you-can", "catch-me-if-you-can"],
    items: [],
    clinic_id: null,
    steps: [
      { ...step({}), id: uid(), ordinal: 1 },
      { ...step({ session_mode: "timed", duration_s: 120, lives: null, hemisphere: "right", timer_position: "left" }), id: uid(), ordinal: 2 },
    ],
  };
  const discrimination: TemplateDetail = {
    id: uid(Date.now() - 199 * DAY),
    name: "Visual discrimination",
    description: "Finding smaller and smaller colour differences, with a time limit per board.",
    weeks: 6,
    sessions_per_week: 3,
    setting: "clinic",
    visibility: "platform",
    version: 1,
    owner_name: null,
    can_edit: false,
    games: ["catch-me-if-you-can"],
    items: [],
    clinic_id: null,
    steps: [{ ...step({ session_mode: "lives", duration_s: null, lives: 5, difficulty_start: 3, trial_window_ms: 8000 }), id: uid(), ordinal: 1 }],
  };
  const memory: TemplateDetail = {
    id: uid(Date.now() - 198 * DAY),
    name: "Memory and search",
    description: "Peek Peek: remember where the pictures hide, then find every copy. Hearts are set per board.",
    weeks: 6,
    sessions_per_week: 2,
    setting: "clinic",
    visibility: "platform",
    version: 1,
    owner_name: null,
    can_edit: false,
    games: ["peek-peek"],
    items: [],
    clinic_id: null,
    steps: [
      {
        ...step({ game_id: "peek-peek", duration_s: 360, lives: null, lives_auto: true, difficulty_start: 3, game_params: { pack: "marine", control_trials: true, hidden_count: false, study_time_s: 0 } }),
        id: uid(),
        ordinal: 1,
      },
    ],
  };
  const sequencing: TemplateDetail = {
    id: uid(Date.now() - 197 * DAY),
    name: "Order and rules",
    description: "Orbital Order: tap the planets in order, skip one colour, and keep up when the rule changes.",
    weeks: 6,
    sessions_per_week: 2,
    setting: "clinic",
    visibility: "platform",
    version: 1,
    owner_name: null,
    can_edit: false,
    games: ["orbital-order"],
    items: [],
    clinic_id: null,
    steps: [
      {
        ...step({ game_id: "orbital-order", session_mode: "lives", duration_s: null, lives: 5, difficulty_start: 2, game_params: { glyph_type: "digits", rule_visible: "on_request", motor_baseline: true, max_rule_trials: 24, neon: false } }),
        id: uid(),
        ordinal: 1,
      },
    ],
  };
  const steering: TemplateDetail = {
    id: uid(Date.now() - 196 * DAY),
    name: "Steady steering",
    description: "Tunnel Rush: steer a rolling tunnel so the objects miss the ship. Two minutes, timed.",
    weeks: 6,
    sessions_per_week: 2,
    setting: "clinic",
    visibility: "platform",
    version: 1,
    owner_name: null,
    can_edit: false,
    games: ["tunnel-rush"],
    items: [],
    clinic_id: null,
    steps: [
      {
        ...step({ game_id: "tunnel-rush", session_mode: "timed", duration_s: 120, lives: null, difficulty_start: 2, game_params: { lanes: 8, ship_mode: "fixed", object_type: "shapes", object_orientation: "upright", rotation: "none", spin_speed: 14, progressive: true } }),
        id: uid(),
        ordinal: 1,
      },
    ],
  };
  const parking: TemplateDetail = {
    id: uid(Date.now() - 195 * DAY),
    name: "Plan the way out",
    description: "Beep Beep: slide the vehicles to free the hero. Eight minutes, with a move budget per board.",
    weeks: 6,
    sessions_per_week: 2,
    setting: "clinic",
    visibility: "platform",
    version: 1,
    owner_name: null,
    can_edit: false,
    games: ["beep-beep"],
    items: [],
    clinic_id: null,
    steps: [
      {
        ...step({ game_id: "beep-beep", session_mode: "timed_lives", duration_s: 480, lives: 3, difficulty_start: 2, game_params: { hint_button: true, show_answer_on_miss: true, undo: true } }),
        id: uid(),
        ordinal: 1,
      },
    ],
  };
  const rhythm: TemplateDetail = {
    id: uid(Date.now() - 194 * DAY),
    name: "Listen and play",
    description: "Echo Keys: tap each piano key as its note arrives; spiky balls must be left alone. Five minutes, timed.",
    weeks: 6,
    sessions_per_week: 2,
    setting: "clinic",
    visibility: "platform",
    version: 1,
    owner_name: null,
    can_edit: false,
    games: ["echo-keys"],
    items: [],
    clinic_id: null,
    steps: [
      {
        ...step({ game_id: "echo-keys", session_mode: "timed", duration_s: 300, lives: null, difficulty_start: 2, game_params: { go_no_go: true, key_count: 0 } }),
        id: uid(),
        ordinal: 1,
      },
    ],
  };
  const bounce: TemplateDetail = {
    id: uid(Date.now() - 192 * DAY),
    name: "Bounce and clear",
    description: "Block Crasher: move the paddle to bounce the ball and clear the brick boards. Five minutes, timed.",
    weeks: 6,
    sessions_per_week: 2,
    setting: "clinic",
    visibility: "platform",
    version: 1,
    owner_name: null,
    can_edit: false,
    games: ["block-crasher"],
    items: [],
    clinic_id: null,
    steps: [
      {
        ...step({ game_id: "block-crasher", session_mode: "timed", duration_s: 300, lives: null, difficulty_start: 2, game_params: { specials: true, special_rate: -1, paddle_assist: 0 } }),
        id: uid(),
        ordinal: 1,
      },
    ],
  };
  const breakVideo = db.videos[0]!;
  const steerAndWatch: TemplateDetail = {
    id: uid(Date.now() - 191 * DAY),
    name: "Steer, watch, play",
    description: "Tunnel Rush, a short video, then Block Crasher. Videos are chosen from the library by brain region.",
    weeks: 4,
    sessions_per_week: 2,
    setting: "clinic",
    visibility: "platform",
    version: 1,
    owner_name: null,
    can_edit: false,
    games: ["tunnel-rush", "block-crasher"],
    items: [],
    clinic_id: null,
    steps: [
      { ...step({ game_id: "tunnel-rush", session_mode: "timed", duration_s: 120, lives: null, progression: null }), id: uid(), ordinal: 1 },
      { step_type: "video", video_id: breakVideo.id, id: uid(), ordinal: 2 },
      { ...step({ game_id: "block-crasher", session_mode: "timed", duration_s: 120, lives: null, progression: null }), id: uid(), ordinal: 3 },
    ],
  };
  db.templates.push(starter, discrimination, memory, sequencing, steering, parking, rhythm, bounce, steerAndWatch);
  for (const t of db.templates) t.items = itemsOf(db, t.steps);

  const byName = (a: Patient, b: Patient) => a.family_name.localeCompare(b.family_name) || a.given_name.localeCompare(b.given_name);
  const active = db.patients.filter((p) => p.clinic_id === CLINIC_A && p.status === "active").sort(byName);
  active.slice(0, 4).forEach((p, n) => assign(db, p, starter, isoDay(Date.now() - (n === 3 ? 2 : 0) * DAY)));
  history(db);
  return db;
}

function assign(db: Db, p: Patient, t: { id: string | null; name: string; weeks: number; sessions_per_week: number; setting: TemplateDetail["setting"]; steps: StepInput[] }, start: string, status: Assignment["status"] = "active") {
  const a: Assignment = {
    id: uid(),
    patient_id: p.id,
    clinic_id: p.clinic_id,
    name: t.name,
    template_id: t.id,
    start_date: start,
    weeks: t.weeks,
    sessions_per_week: t.sessions_per_week,
    setting: t.setting,
    status,
    assigned_by_name: "Yael Bar",
    steps: t.steps.map((s, i) => ({
      ...strip(s),
      id: uid(),
      ordinal: i + 1,
      current_difficulty: isVideoStep(s) ? 3 : s.difficulty_start,
      sessions_completed: 0,
    })),
    sessions: scheduleDates(start, t.weeks, t.sessions_per_week).map((s) => ({ id: uid(), seq: s.seq, week: s.week, planned_date: s.date, status: "planned" })),
  };
  db.assignments.push(a);
  return a;
}
function strip(s: StepInput & { id?: string; ordinal?: number }): StepInput {
  const { id: _i, ordinal: _o, ...rest } = s as StepInput & { id?: string; ordinal?: number };
  return rest;
}

/** Ella Navon: a finished six-week protocol with 12 sessions, as in seed:dev. */
function history(db: Db) {
  const gid = uid(Date.now() - 50 * DAY);
  db.guardians.push({ id: gid, full_name: "Dan Navon", email: null, phone: "+972 50 000 0999", preferred_locale: "en" });
  const p: Patient = {
    id: uid(Date.now() - 50 * DAY),
    clinic_id: CLINIC_A,
    given_name: "Ella",
    family_name: "Navon",
    date_of_birth: isoDay(Date.now() - 7.5 * 365.25 * DAY),
    preferred_locale: "en",
    status: "active",
    sex: null,
    handedness: null,
    alert: null,
    colour_vision_deficiency: false,
    archived: false,
    guardianIds: [gid],
    legal: { [gid]: true },
    relationship: { [gid]: "father" },
  };
  db.patients.push(p);
  db.consents.push({ patient_id: p.id, purpose: "treatment", decision: "granted", signed_at: new Date(Date.now() - 46 * DAY).toISOString(), signer_name: "Dan Navon", guardian_name: "Dan Navon", captured_by_name: "Yael Bar" });
  const t = db.templates[1]!;
  const a = assign(db, p, { ...t, weeks: 6, sessions_per_week: 2 }, isoDay(Date.now() - 45 * DAY), "completed");
  const s = a.steps[0]!;
  s.current_difficulty = 4;
  s.sessions_completed = 12;
  const acc = [0.66, 0.7, 0.81, 0.84, 0.86, 0.68, 0.72, 0.75, 0.79, 0.83, 0.81, 0.86];
  const rt = [1450, 1400, 1320, 1260, 1200, 1380, 1330, 1300, 1250, 1210, 1230, 1180];
  const jnd = [14, 13, 11, 10, 9, 12, 11, 10.5, 9.5, 9, 9.2, 8.4];
  const anchor = [0.4, 0.45, 0.5, 0.55, 0.6, 0.5, 0.55, 0.58, 0.62, 0.66, 0.64, 0.7];
  const start = Date.now() - 45 * DAY;
  a.sessions.forEach((ps, i) => {
    const ended = start + (i * 3.5 + 0.4) * DAY;
    ps.status = "done";
    ps.planned_date = isoDay(ended);
    const difficulty = i < 5 ? 3 : 4;
    const id = uid(ended);
    db.games.push(row(p.id, s.id, ps.id, ps.seq, "out_of_lives", "lives", difficulty, ended, 240_000 + i * 6000, acc[i]!, rt[i]!, {
      final_jnd: jnd[i],
      min_cleared_delta_e: jnd[i]! + 1.5,
      anchor_first_rate: anchor[i],
      best_streak: 4 + (i % 4),
      highest_level: difficulty + 2,
    }, id));
    if (i === 4) {
      db.decisions.push({ id: uid(ended), game_session_id: id, game_id: "catch-me-if-you-can", decided_at: new Date(ended).toISOString(), action: "up", from_difficulty: 3, to_difficulty: 4, reason: "streak_up", patient_id: p.id });
    }
  });
}

function row(
  patient: string,
  stepId: string | null,
  planned: string | null,
  seq: number | null,
  status: GameSessionView["status"],
  mode: GameSessionView["session_mode"],
  difficulty: number,
  ended: number,
  activeMs: number,
  accuracy: number | null,
  rt: number | null,
  metrics: Record<string, unknown>,
  id = uid(ended),
): GameRow {
  const trials = 24;
  const correct = accuracy === null ? 0 : Math.round(trials * accuracy);
  return {
    id,
    patient_id: patient,
    assignment_step_id: stepId,
    game_id: "catch-me-if-you-can",
    status,
    session_mode: mode,
    difficulty,
    hemisphere: "left",
    monochrome: false,
    started_at: new Date(ended - activeMs).toISOString(),
    ended_at: new Date(ended).toISOString(),
    active_ms: activeMs,
    accuracy,
    rt_median_ms: rt,
    trials_total: trials,
    correct,
    errors: trials - correct,
    lives_lost: 1,
    highest_level: typeof metrics.highest_level === "number" ? metrics.highest_level : null,
    planned_session_id: planned,
    seq,
    metrics,
  };
}

// ------------------------------------------------------------------ state

let cache: Db | null = null;
function load(): Db {
  if (cache) return cache;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) return (cache = JSON.parse(raw) as Db);
  } catch {
    /* fresh state */
  }
  return (cache = seed());
}
function save() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* in-memory only */
  }
}

// ------------------------------------------------------------------ views

const consentCurrent = (db: Db, pid: string) => {
  const latest = new Map<string, Consent>();
  for (const c of db.consents.filter((c) => c.patient_id === pid).sort((a, b) => a.signed_at.localeCompare(b.signed_at))) latest.set(c.purpose, c);
  return latest;
};
const canPlay = (db: Db, p: Patient) => p.status === "active" && !p.archived && consentCurrent(db, p.id).get("treatment")?.decision === "granted";

function detail(db: Db, p: Patient): PatientDetail {
  const { guardianIds, legal, relationship, ...rest } = p;
  return {
    ...rest,
    can_play: canPlay(db, p),
    care_team: [{ user_id: ME, full_name: "Yael Bar", role: "primary" }],
    guardians: guardianIds
      .map((id) => db.guardians.find((g) => g.id === id))
      .filter((g): g is Guardian => !!g)
      .map((g) => ({ ...g, relationship: relationship[g.id] ?? "parent", is_legal_guardian: legal[g.id] ?? false })),
    consents: [...consentCurrent(db, p.id).values()].map(({ patient_id: _p, ...c }) => c),
  };
}
function listItem(p: Patient): PatientListItem {
  return { id: p.id, clinic_id: p.clinic_id, given_name: p.given_name, family_name: p.family_name, date_of_birth: p.date_of_birth, status: p.status, has_alert: !!p.alert, archived: p.archived };
}
function assignmentView(a: Assignment | undefined): AssignmentView | null {
  if (!a) return null;
  const { patient_id: _p, clinic_id: _c, ...view } = a;
  return view;
}
const running = (db: Db, pid: string) => db.assignments.find((a) => a.patient_id === pid && (a.status === "active" || a.status === "paused"));

type GameAssignmentStep = GameStepInput & { id: string; ordinal: number; current_difficulty: number; sessions_completed: number };

/** Platform parameters for a step (the same shape as the API's buildParams). */
function params(s: GameAssignmentStep, p: Patient) {
  const ns = s.game_id.replace(/-/g, "_");
  const own: Record<string, unknown> = { ...s.game_params };
  if (p.colour_vision_deficiency && findGame(s.game_id)?.manifest.paramsSchema.properties.cvd_mode) own.cvd_mode = true;
  return {
    session_mode: s.session_mode,
    ...(s.duration_s !== null ? { duration_s: s.duration_s } : {}),
    ...(s.lives_auto ? { lives: "auto" } : s.lives !== null ? { lives: s.lives } : {}),
    difficulty: s.current_difficulty,
    start_level: "from_difficulty",
    hemisphere: s.hemisphere,
    timer_position: timerPositionFor(s.hemisphere, timerShown(s.timer_position)),
    monochrome: s.monochrome === true && findGame(s.game_id)?.manifest.capabilities.monochrome === true,
    trial_window_ms: s.trial_window_ms,
    practice: s.practice === "auto" ? (s.sessions_completed === 0 ? "on" : "off") : s.practice,
    instructions: s.sessions_completed < 2 ? "always" : "short",
    lang: p.preferred_locale,
    sound: "off",
    reduce_motion: "os",
    high_contrast: false,
    show_score: true,
    context: "clinic",
    seed: Math.floor(Math.random() * 2 ** 31),
    input_assist: "none",
    speed_scale: 1,
    ...Object.fromEntries(Object.entries(own).map(([k, v]) => [`${ns}.${k}`, v])),
  };
}

// ------------------------------------------------------------------ routing

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-request-id": crypto.randomUUID() } });
const notFound = () => json({ error: "not_found" }, 404);
const delay = () => new Promise((r) => setTimeout(r, 120 + Math.random() * 180));

function user(a: Auth) {
  const now = new Date().toISOString();
  return { id: ME, email: a.email, name: a.name, emailVerified: true, twoFactorEnabled: a.mfa, createdAt: now, updatedAt: now, image: null };
}

async function handle(path: string, method: string, q: URLSearchParams, body: Record<string, unknown>): Promise<Response> {
  const db = load();
  const a = db.auth;
  await delay();

  // ---- auth
  if (path === "/api/auth/get-session") return json(a.stage === "in" ? { session: { id: "demo", userId: ME, expiresAt: new Date(Date.now() + 36e5).toISOString() }, user: user(a) } : null);
  if (path === "/api/auth/sign-in/email" && method === "POST") {
    const email = String(body.email ?? "");
    if (!email.includes("@") || String(body.password ?? "").length < 12) return json({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }, 401);
    const local = email.split("@")[0] ?? "yael";
    db.auth = { ...a, email, name: local.length > 1 ? `${local[0]!.toUpperCase()}${local.slice(1)} Bar` : "Yael Bar", stage: a.mfa ? "pending_2fa" : "in" };
    save();
    return a.mfa ? json({ twoFactorRedirect: true, twoFactorMethods: ["totp"] }) : json({ redirect: false, token: "demo", user: user(db.auth) });
  }
  if (path === "/api/auth/sign-out") {
    db.auth = { ...a, stage: "out" };
    save();
    return json({ success: true });
  }
  if (path === "/api/auth/two-factor/enable") {
    if (String(body.password ?? "").length < 12) return json({ code: "INVALID_PASSWORD", message: "Invalid password" }, 400);
    return json({
      totpURI: `otpauth://totp/eMazeBrain:${encodeURIComponent(a.email ?? "demo")}?secret=JBSWY3DPEHPK3PXPDEMOKEY2&issuer=eMazeBrain&digits=6&period=30`,
      backupCodes: ["7KQ2M-XW9PD", "R4T8N-HB2LC", "Z6YV3-QF7KM", "P9D2W-JN5XR", "C3HL8-TM6QV", "W5BX9-KD2PF", "N8RJ4-VC7HZ", "F2MQ6-LX9TB", "H7PK3-ZW4NR", "Q4VD8-BM2JC"],
    });
  }
  if (path === "/api/auth/two-factor/verify-totp" || path === "/api/auth/two-factor/verify-backup-code") {
    const code = String(body.code ?? "");
    const ok = path.endsWith("totp") ? /^\d{6}$/.test(code) && code !== "000000" : code.length >= 6;
    if (!ok) return json({ code: "INVALID_CODE", message: "Invalid code" }, 401);
    db.auth = { ...a, mfa: true, stage: "in" };
    save();
    return json({ token: "demo", user: user(db.auth) });
  }

  // ---- v1: the same entry rules as requireStaffSession
  if (!path.startsWith("/v1/")) return notFound();
  if (a.stage !== "in") return json({ error: "unauthenticated" }, 401);
  if (!a.mfa) return json({ error: "mfa_required" }, 403);
  const parts = path.split("/").filter(Boolean).slice(1); // after "v1"
  const [r0, r1, r2, r3] = parts;
  const findP = (id: string | undefined) => db.patients.find((p) => p.id === id);
  const done = (res: Response) => {
    save();
    return res;
  };

  if (r0 === "me") {
    return json({
      user: { id: ME, email: a.email, name: a.name },
      memberships: [
        { clinic_id: CLINIC_A, organization_id: "org", role: "therapist", clinic_name: "Tel Aviv Child Development Center" },
        { clinic_id: CLINIC_A, organization_id: "org", role: "clinic_manager", clinic_name: "Tel Aviv Child Development Center" },
        { clinic_id: CLINIC_B, organization_id: "org", role: "therapist", clinic_name: "Haifa North Clinic" },
      ],
      // The demo user also manages the video library, so the Videos page can be tried (ADR 0018).
      is_platform_admin: true,
    });
  }

  if (r0 === "clinics" && r2 === "staff") {
    return json({
      staff: [
        { id: ME, full_name: "Yael Bar", email: "yael@synthetic.test", roles: ["therapist", "clinic_manager"] },
        { id: "s2", full_name: "Dana Kaplan", email: "dana@synthetic.test", roles: ["therapist"] },
        { id: "s3", full_name: "Ronit Avraham", email: "ronit@synthetic.test", roles: ["clinic_manager"] },
      ],
    });
  }

  if (r0 === "today") {
    const clinic = q.get("clinic");
    const t = today();
    const from = isoDay(Date.now() - 7 * DAY);
    const items: TodayItem[] = [];
    for (const asg of db.assignments.filter((x) => x.status === "active" && (!clinic || x.clinic_id === clinic))) {
      const p = findP(asg.patient_id);
      if (!p || p.archived) continue;
      const next = asg.sessions.filter((s) => s.status === "planned" || s.status === "in_progress").sort((x, y) => x.seq - y.seq)[0];
      if (!next || next.planned_date > t || next.planned_date < from) continue;
      items.push({
        planned_session_id: next.id,
        planned_date: next.planned_date,
        seq: next.seq,
        week: next.week,
        total: asg.sessions.filter((s) => s.status !== "cancelled").length,
        patient: { id: p.id, given_name: p.given_name, family_name: p.family_name, date_of_birth: p.date_of_birth, alert: p.alert, can_play: canPlay(db, p) },
        assignment: { id: asg.id, name: asg.name, weeks: asg.weeks },
        games: asg.steps.flatMap((s) => (isVideoStep(s) ? [] : [s.game_id])),
        items: itemsOf(db, asg.steps),
      });
    }
    items.sort((x, y) => x.planned_date.localeCompare(y.planned_date) || x.patient.family_name.localeCompare(y.patient.family_name));
    return json({ items });
  }

  // ---- patients
  if (r0 === "patients" && !r1) {
    if (method === "POST") {
      const clinic = String(body.clinic_id ?? CLINIC_A);
      const dup = db.patients.some(
        (p) => p.clinic_id === clinic && !p.archived && p.given_name.toLowerCase() === String(body.given_name).toLowerCase() && p.family_name.toLowerCase() === String(body.family_name).toLowerCase() && p.date_of_birth === body.date_of_birth,
      );
      if (dup && !body.allow_duplicate) return json({ error: "possible_duplicate" }, 409);
      const id = uid();
      db.patients.push({
        id,
        clinic_id: clinic,
        given_name: String(body.given_name),
        family_name: String(body.family_name),
        date_of_birth: String(body.date_of_birth),
        preferred_locale: (body.preferred_locale as Patient["preferred_locale"]) ?? "he",
        status: "pending_consent",
        sex: (body.sex as Patient["sex"]) ?? null,
        handedness: (body.handedness as Patient["handedness"]) ?? null,
        alert: (body.alert as string) || null,
        colour_vision_deficiency: !!body.colour_vision_deficiency,
        archived: false,
        guardianIds: [],
        legal: {},
        relationship: {},
      });
      return done(json({ id }, 201));
    }
    const clinic = q.get("clinic");
    const archived = q.get("archived") === "1";
    const list = db.patients
      .filter((p) => p.archived === archived && (!clinic || p.clinic_id === clinic))
      .sort((x, y) => x.family_name.localeCompare(y.family_name) || x.given_name.localeCompare(y.given_name))
      .map(listItem);
    return json({ patients: list });
  }

  if (r0 === "patients" && r1) {
    const p = findP(r1);
    if (!p) return notFound();
    if (!r2) {
      if (method === "PATCH") {
        for (const k of ["given_name", "family_name", "date_of_birth", "preferred_locale", "sex", "handedness", "alert", "colour_vision_deficiency"] as const) {
          if (k in body) (p as unknown as Record<string, unknown>)[k] = body[k] === "" ? null : body[k];
        }
        return done(json({ patient: detail(db, p) }));
      }
      return json({ patient: detail(db, p) });
    }
    if (r2 === "archive" || r2 === "restore") {
      p.archived = r2 === "archive";
      return done(json({ ok: true }));
    }
    if (r2 === "guardians") {
      if (method === "POST" && !r3) {
        const gid = uid();
        db.guardians.push({ id: gid, full_name: String(body.full_name), email: (body.email as string) || null, phone: (body.phone as string) || null, preferred_locale: (body.preferred_locale as Guardian["preferred_locale"]) ?? p.preferred_locale });
        p.guardianIds.push(gid);
        p.legal[gid] = !!body.is_legal_guardian;
        p.relationship[gid] = (body.relationship as GuardianView["relationship"]) ?? "parent";
        return done(json({ id: gid }, 201));
      }
      const g = db.guardians.find((x) => x.id === r3);
      if (!g || !p.guardianIds.includes(g.id)) return notFound();
      if (method === "DELETE") {
        p.guardianIds = p.guardianIds.filter((x) => x !== g.id);
        return done(json({ ok: true }));
      }
      Object.assign(g, { full_name: body.full_name ?? g.full_name, email: (body.email as string) || null, phone: (body.phone as string) || null, preferred_locale: body.preferred_locale ?? g.preferred_locale });
      if ("is_legal_guardian" in body) p.legal[g.id] = !!body.is_legal_guardian;
      if ("relationship" in body) p.relationship[g.id] = body.relationship as GuardianView["relationship"];
      return done(json({ ok: true }));
    }
    if (r2 === "consents") {
      if (method === "POST") {
        const gid = body.guardian_id as string | undefined;
        if (gid && !p.legal[gid]) return json({ error: "not_legal_guardian" }, 422);
        const guardian = db.guardians.find((x) => x.id === gid);
        const decisions = Object.entries((body.decisions as Record<string, string | undefined>) ?? {}).filter(([, d]) => d === "granted" || d === "withdrawn");
        if (!decisions.length) return json({ error: "validation", issues: [{ path: ["decisions"], message: "no_decisions" }] }, 422);
        const signedAt = new Date().toISOString();
        for (const [purpose, d] of decisions) {
          const decision = d as Consent["decision"];
          db.consents.push({ patient_id: p.id, purpose: purpose as Consent["purpose"], decision, signed_at: signedAt, signer_name: (body.signer_name as string) ?? guardian?.full_name ?? null, guardian_name: guardian?.full_name ?? null, captured_by_name: a.name });
          // Same as the database trigger: consent for clinic sessions unlocks the patient; withdrawing it locks them again.
          if (purpose === "treatment") {
            if (decision === "granted" && (p.status === "pending_consent" || p.status === "consent_legacy")) p.status = "active";
            if (decision === "withdrawn" && p.status === "active") p.status = "pending_consent";
          }
        }
        return done(json({ patient: detail(db, p) }, 201));
      }
      return json({ consents: db.consents.filter((c) => c.patient_id === p.id).map(({ patient_id: _x, ...c }) => c).reverse() });
    }
    if (r2 === "assignment") {
      if (method === "POST") {
        if (running(db, p.id)) return json({ error: "already_assigned" }, 409);
        const steps = (body.steps as StepInput[]) ?? [];
        const asg = assign(db, p, { id: (body.template_id as string) ?? null, name: String(body.name), weeks: Number(body.weeks), sessions_per_week: Number(body.sessions_per_week), setting: (body.setting as Assignment["setting"]) ?? "clinic", steps }, String(body.start_date));
        return done(json({ assignment: assignmentView(asg) }, 201));
      }
      return json({ assignment: assignmentView(running(db, p.id)) });
    }
    if (r2 === "sessions") {
      return json({ sessions: db.games.filter((g) => g.patient_id === p.id).sort((x, y) => y.ended_at.localeCompare(x.ended_at)).map(({ patient_id: _p, assignment_step_id: _s, ...g }) => g) });
    }
    if (r2 === "progression") {
      return json({ decisions: db.decisions.filter((d) => d.patient_id === p.id).sort((x, y) => y.decided_at.localeCompare(x.decided_at)).map(({ patient_id: _p, ...d }) => d) });
    }
    return notFound();
  }

  if (r0 === "assignments" && r1 && method === "PATCH") {
    const asg = db.assignments.find((x) => x.id === r1 && (x.status === "active" || x.status === "paused"));
    if (!asg) return notFound();
    asg.status = body.status as Assignment["status"];
    if (asg.status === "cancelled") asg.sessions.forEach((s) => s.status === "planned" && (s.status = "cancelled"));
    return done(json({ patient_id: asg.patient_id, assignment: assignmentView(running(db, asg.patient_id)) }));
  }

  // ---- templates
  if (r0 === "templates") {
    if (!r1) {
      if (method === "POST") {
        const steps = (body.steps as StepInput[]).map((s, i) => ({ ...s, id: uid(), ordinal: i + 1 }));
        const t: TemplateDetail = {
          id: uid(),
          name: String(body.name),
          description: (body.description as string) ?? null,
          weeks: Number(body.weeks),
          sessions_per_week: Number(body.sessions_per_week),
          setting: (body.setting as TemplateDetail["setting"]) ?? "clinic",
          visibility: (body.visibility as TemplateDetail["visibility"]) ?? "private",
          version: 1,
          owner_name: a.name,
          can_edit: true,
          games: steps.flatMap((s) => (isVideoStep(s) ? [] : [s.game_id])),
          items: itemsOf(db, steps),
          clinic_id: (body.clinic_id as string) ?? CLINIC_A,
          steps,
        };
        db.templates.push(t);
        return done(json({ template: t }, 201));
      }
      return json({ templates: db.templates.map(({ steps, clinic_id: _c, ...t }) => ({ ...t, items: itemsOf(db, steps) })) });
    }
    const t = db.templates.find((x) => x.id === r1);
    if (!t) return notFound();
    if (method === "DELETE") {
      db.templates = db.templates.filter((x) => x.id !== t.id);
      return done(json({ ok: true }));
    }
    if (method === "PUT") {
      const steps = (body.steps as StepInput[]).map((s, i) => ({ ...s, id: uid(), ordinal: i + 1 }));
      Object.assign(t, { name: body.name, description: body.description ?? null, weeks: body.weeks, sessions_per_week: body.sessions_per_week, setting: body.setting, visibility: body.visibility, version: t.version + 1, steps, games: steps.flatMap((s) => (isVideoStep(s) ? [] : [s.game_id])), items: itemsOf(db, steps) });
      return done(json({ template: t }));
    }
    return json({ template: { ...t, items: itemsOf(db, t.steps) } });
  }

  // ---- video library (ADR 0018)
  if (r0 === "brain-regions") return json({ regions: regionsIn(q.get("lang") ?? "en") });
  if (r0 === "videos" && !r1) {
    const lang = q.get("lang") ?? "en";
    const region = REGION_NODES.find((x) => x.id === q.get("region"));
    const words = (q.get("q") ?? "").trim().toLowerCase();
    const list = db.videos
      .filter((v) => v.status === "published" || q.get("all") === "1")
      .filter((v) => !region || v.regions.some((r) => r.path === region.path || r.path.startsWith(`${region.path}.`)))
      .filter((v) => !words || Object.values(v.titles).some((t) => t?.toLowerCase().includes(words)))
      .map((v) => localized(v, lang))
      .sort((x, y) => x.title.localeCompare(y.title));
    return json({ videos: list });
  }
  if (r0 === "videos" && r1 && !r2) {
    const v = db.videos.find((x) => x.id === r1);
    return v ? json({ video: localized(v, q.get("lang") ?? "en") }) : notFound();
  }
  if (r0 === "admin" && r1 === "videos") {
    const lang = q.get("lang") ?? "en";
    const fields = (v: Partial<Db["videos"][number]>) => {
      const yt = String(body.youtube_url ?? "").match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/)?.[1] ?? null;
      const titles = (body.titles ?? {}) as Record<string, string>;
      const descriptions = (body.descriptions ?? {}) as Record<string, string>;
      return {
        source: body.source as "upload" | "youtube",
        youtube_id: body.source === "youtube" ? yt : null,
        titles: Object.fromEntries(Object.entries(titles).filter(([, x]) => x?.trim())),
        descriptions: Object.fromEntries(Object.entries(descriptions).filter(([, x]) => x?.trim())),
        regions: ((body.region_ids ?? []) as string[]).map((id) => REGION_NODES.find((x) => x.id === id)).filter((x): x is BrainRegion => !!x).map(({ id, kind, code, path }) => ({ id, kind, code, path })),
        age_min: (body.age_min as number | null) ?? null,
        age_max: (body.age_max as number | null) ?? null,
        status: (body.status as VideoSummary["status"]) ?? "draft",
        duration_s: (body.duration_s as number | null | undefined) ?? v.duration_s ?? null,
        needs_internet: body.source === "youtube",
      };
    };
    if (!r2 && method === "POST") {
      const v = { id: uid(), version: 1, has_file: false, file_url: null, title: "", description: null, ...fields({}) };
      db.videos.push(v);
      return done(json({ video: localized(v, lang) }, 201));
    }
    const v = db.videos.find((x) => x.id === r2);
    if (!v) return notFound();
    if (!r3 && method === "PUT") {
      const next = fields(v);
      const media = next.source !== v.source || next.youtube_id !== v.youtube_id;
      Object.assign(v, next, { version: v.version + (media ? 1 : 0) }, next.source === "youtube" ? { has_file: false, file_url: null } : {});
      return done(json({ video: localized(v, lang) }));
    }
  }
  if (r0 === "video-views" && method === "POST") {
    const view = body as unknown as VideoViewInput;
    const asg = db.assignments.find((x) => x.sessions.some((s) => s.id === view.planned_session_id));
    const ps = asg?.sessions.find((s) => s.id === view.planned_session_id);
    if (!asg || !ps) return notFound();
    if (db.views.some((x) => x.client_view_id === view.client_view_id)) return json({ outcome: "duplicate", planned_session_status: ps.status });
    const st = asg.steps.find((s) => s.id === view.assignment_step_id);
    if (!st || !isVideoStep(st) || st.video_id !== view.video_id) return json({ error: "step_mismatch" }, 422);
    if (ps.status !== "planned" && ps.status !== "in_progress") return json({ error: "session_closed" }, 409);
    db.views.push(view);
    ps.status = asg.steps.every((s) => stepDone(db, ps.id, s)) ? "done" : "in_progress";
    return done(json({ outcome: "accepted", planned_session_status: ps.status }, 201));
  }

  // ---- sessions
  if (r0 === "planned-sessions" && r2 === "launch") {
    const asg = db.assignments.find((x) => x.sessions.some((s) => s.id === r1));
    const ps = asg?.sessions.find((s) => s.id === r1);
    const p = findP(asg?.patient_id);
    if (!asg || !ps || !p) return notFound();
    if (!canPlay(db, p)) return json({ error: "consent_required" }, 409);
    if (asg.status !== "active") return json({ error: "protocol_not_active" }, 409);
    if (ps.status !== "planned" && ps.status !== "in_progress") return json({ error: "session_closed" }, 409);
    ps.status = "in_progress";
    const launch: LaunchPackage = {
      planned_session_id: ps.id,
      seq: ps.seq,
      week: ps.week,
      total: asg.sessions.filter((s) => s.status !== "cancelled").length,
      patient: { id: p.id, given_name: p.given_name, family_name: p.family_name, preferred_locale: p.preferred_locale, alert: p.alert },
      assignment: { id: asg.id, name: asg.name },
      steps: asg.steps.map((s): LaunchStep => {
        if (isVideoStep(s)) {
          const v = db.videos.find((x) => x.id === s.video_id)!;
          const lv = localized(v, p.preferred_locale);
          return {
            kind: "video",
            assignment_step_id: s.id,
            ordinal: s.ordinal,
            video: { id: v.id, version: v.version, source: v.source, youtube_id: v.youtube_id, title: lv.title, duration_s: v.duration_s, file_url: v.file_url, sha256: null },
            done: stepDone(db, ps.id, s),
          };
        }
        return {
          kind: "game",
          assignment_step_id: s.id,
          ordinal: s.ordinal,
          game_id: s.game_id,
          params: params(s, p),
          // Not a real signature: in the demo nothing leaves the browser. The real API signs an Ed25519 ticket.
          ticket: `demo.${btoa(JSON.stringify({ psid: ps.id, asid: s.id, pid: p.id }))}`,
          done: stepDone(db, ps.id, s),
        };
      }),
    };
    return done(json({ launch }));
  }

  if (r0 === "results" && method === "POST") {
    const env = body.envelope as Record<string, unknown> & { std: Record<string, number | null>; metrics: Record<string, unknown>; params: Record<string, unknown> };
    let claims: { psid: string; asid: string; pid: string };
    try {
      claims = JSON.parse(atob(String(body.ticket).slice(5)));
    } catch {
      return json({ error: "invalid_ticket" }, 422);
    }
    const asg = db.assignments.find((x) => x.steps.some((s) => s.id === claims.asid));
    const found = asg?.steps.find((s) => s.id === claims.asid);
    const ps = asg?.sessions.find((s) => s.id === claims.psid);
    if (!asg || !found || isVideoStep(found) || !ps) return json({ error: "invalid_ticket" }, 422);
    const st = found as GameAssignmentStep;
    const sid = String(env.session_id);
    if (db.games.some((g) => g.id === sid)) return json({ outcome: "duplicate", session_id: sid, progression: null, planned_session_status: ps.status }); // stored once
    const ended = Date.parse(String(env.ended_at)) || Date.now();
    db.games.push({
      ...row(claims.pid, st.id, ps.id, ps.seq, env.status as GameSessionView["status"], env.mode as GameSessionView["session_mode"], Number(env.params.difficulty ?? st.current_difficulty), ended, Number(env.active_ms ?? 0), env.std.accuracy ?? null, env.std.rt_median_ms !== null && env.std.rt_median_ms !== undefined ? Math.round(env.std.rt_median_ms) : null, env.metrics, sid),
      hemisphere: (env.params.hemisphere as "left" | "right") ?? st.hemisphere,
      monochrome: env.params.monochrome === true,
      trials_total: Number(env.std.trials_total ?? 0),
      correct: Number(env.std.correct ?? 0),
      errors: Number(env.std.errors ?? 0),
      lives_lost: Number(env.lives_lost ?? 0),
    });
    let progression: { action: "up" | "down" | "hold"; from: number; to: number } | null = null;
    if (env.status !== "abandoned") {
      st.sessions_completed += 1;
      const hist = db.games
        .filter((g) => g.assignment_step_id === st.id)
        .sort((x, y) => x.ended_at.localeCompare(y.ended_at))
        .map((g) => ({ accuracy: g.accuracy, difficulty: g.difficulty, valid: g.status !== "abandoned" }));
      const d = decide(st.progression, hist, st.current_difficulty);
      progression = { action: d.action, from: d.from, to: d.to };
      if (d.action !== "hold") {
        st.current_difficulty = d.to;
        db.decisions.push({ id: uid(), game_session_id: sid, game_id: st.game_id, decided_at: new Date().toISOString(), action: d.action, from_difficulty: d.from, to_difficulty: d.to, reason: d.reason, patient_id: claims.pid });
      }
    }
    const allIn = asg.steps.every((s) => stepDone(db, ps.id, s));
    ps.status = allIn ? "done" : "in_progress";
    return done(json({ outcome: "accepted", session_id: sid, progression, planned_session_status: ps.status }, 201));
  }

  return notFound();
}

export function installDemoApi() {
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(typeof input === "string" ? new URL(input, location.href) : input, init);
    const url = new URL(req.url);
    const at = url.pathname.search(/\/(api\/auth|v1)\//);
    if (url.origin !== location.origin || at < 0) return real(input, init);
    const upload = url.pathname.match(/\/v1\/admin\/videos\/([^/]+)\/file$/);
    if (upload && req.method === "PUT") return uploadFile(upload[1]!, await req.blob());
    let body: Record<string, unknown> = {};
    if (req.method !== "GET" && req.method !== "HEAD") body = (await req.clone().json().catch(() => ({}))) as Record<string, unknown>;
    return handle(url.pathname.slice(at), req.method, url.searchParams, body);
  };
}

// ------------------------------------------------------------------ video library (ADR 0018)

/** The brain-region tree with stable demo ids (the real API uses UUIDv7 rows from migration 0010). */
const REGION_NODES: BrainRegion[] = (() => {
  const out: BrainRegion[] = [];
  let n = 0;
  const id = () => `0192f3a0-0000-7000-8000-${(++n).toString(16).padStart(12, "0")}`;
  HEMISPHERES.forEach((h, hi) => {
    const hid = id();
    out.push({ id: hid, parent_id: null, kind: "hemisphere", code: h.code, path: h.code, label: h.en, sort: hi + 1 });
    LOBES.forEach((l, li) => {
      const lid = id();
      out.push({ id: lid, parent_id: hid, kind: "lobe", code: l.code, path: `${h.code}.${l.code}`, label: l.en, sort: li + 1 });
      AREAS.filter((a) => a.lobe === l.code).forEach((a, ai) => out.push({ id: id(), parent_id: lid, kind: "area", code: a.code, path: `${h.code}.${l.code}.${a.code}`, label: a.en, sort: ai + 1 }));
    });
  });
  return out;
})();
const NAMES = new Map([...HEMISPHERES, ...LOBES, ...AREAS].map((x) => [x.en, x.he]));
function regionsIn(lang: string): BrainRegion[] {
  return REGION_NODES.map((r) => (lang === "he" ? { ...r, label: NAMES.get(r.label) ?? r.label } : r));
}
const regionRef = (path: string) => {
  const r = REGION_NODES.find((x) => x.path === path)!;
  return { id: r.id, kind: r.kind, code: r.code, path: r.path };
};

function seedVideos(): Db["videos"] {
  const clip = (file: string, en: string, he: string, seconds: number, ages: [number, number], paths: string[]) => ({
    id: uid(Date.now() - 200 * DAY),
    source: "upload" as const,
    youtube_id: null,
    title: en,
    description: null,
    titles: { en, he },
    descriptions: {},
    duration_s: seconds,
    age_min: ages[0],
    age_max: ages[1],
    status: "published" as const,
    version: 2,
    has_file: true,
    needs_internet: false,
    regions: paths.map(regionRef),
    // Synthetic clips bundled with the demo (scripts/make-sample-videos.sh): generated patterns, no people.
    file_url: `./demo-videos/${file}`,
  });
  return [
    clip("colour-shapes.mp4", "Colour shapes", "צורות צבעוניות", 10, [5, 12], ["left.frontal.ba44", "left.frontal.ba46"]),
    clip("spiral-zoom.mp4", "Spiral zoom", "זום ספירלה", 10, [4, 14], ["left.occipital.ba17", "right.occipital.ba17"]),
    clip("growing-dots.mp4", "Growing dots", "נקודות צומחות", 8, [6, 14], ["right.parietal.ba40", "right.cerebellum.cerebellum"]),
  ];
}

function pickText(texts: Record<string, string | undefined>, lang: string) {
  for (const l of [lang, "en", "he"]) if (texts[l]) return texts[l]!;
  return Object.values(texts).find(Boolean) ?? "";
}
function localized(v: Db["videos"][number], lang: string): VideoSummary {
  const { file_url: _f, ...rest } = v;
  return { ...rest, title: pickText(v.titles, lang), description: pickText(v.descriptions, lang) || null };
}
function itemsOf(db: Db, steps: StepInput[]): StepItem[] {
  return steps.map((s) => (isVideoStep(s) ? { kind: "video", video_id: s.video_id, title: pickText(db.videos.find((v) => v.id === s.video_id)?.titles ?? {}, "en") } : { kind: "game", game_id: s.game_id }));
}
function stepDone(db: Db, psid: string, s: StepInput & { id: string }) {
  return isVideoStep(s) ? db.views.some((v) => v.planned_session_id === psid && v.assignment_step_id === s.id) : db.games.some((g) => g.planned_session_id === psid && g.assignment_step_id === s.id);
}

/** An uploaded file stays in this tab only (a blob URL); the demo keeps nothing anywhere else. */
async function uploadFile(id: string, blob: Blob): Promise<Response> {
  const db = load();
  const v = db.videos.find((x) => x.id === id);
  if (!v) return notFound();
  if (v.source !== "upload") return json({ error: "not_an_upload" }, 409);
  if (!["video/mp4", "video/webm"].includes(blob.type)) return json({ error: "unsupported_type" }, 415);
  Object.assign(v, { file_url: URL.createObjectURL(blob), has_file: true, version: v.version + 1 });
  save();
  return json({ video: localized(v, "en") });
}
