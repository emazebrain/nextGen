/**
 * Running a session in the clinic (design doc §4.3, §5.6; journey T2).
 *
 * The therapist presses Start, sees what will be played and hands the tablet
 * over. The child plays each game in turn with a short pause between them;
 * therapist controls (skip a game, end the session) sit behind a long press
 * and the device's kid-mode PIN. Every result goes to the outbox first and
 * is sent from there, so nothing is lost if the connection drops. When the
 * child is done, the PIN opens the therapist's summary.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { useIntl } from "react-intl";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, CircleCheck, CloudOff, Hand, Lock, Minus, Play, RotateCw, SkipForward, Square } from "lucide-react";
import type { LaunchGameStep, LaunchPackage, LaunchStep, LaunchVideoStep, OfflineBundle, SessionPackage, VideoViewInput } from "@emb/contracts";
import type { HostToFrame, LaunchParams, ResultEnvelope } from "@emb/game-runtime/protocol";
import { Alert, Button, Card, Chip, Logo, MazeLoader, TextField } from "@emb/ui";
import { ApiError } from "../api/http.ts";
import { assignmentKey, sessionsKey, useLaunch, useMe } from "../api/queries.ts";
import { GameFrame } from "../games/GameFrame.tsx";
import { findGame, localText } from "../games/registry.ts";
import { useT, usePrefs, type MessageId } from "../i18n/index.tsx";
import { uuidv7 } from "../lib/ids.ts";
import { noteActivity } from "../lib/idle.ts";
import { firstName, iso } from "../lib/format.ts";
import { useTitle } from "../lib/title.ts";
import { ResultSummary } from "../routes/library.tsx";
import { checkPin, hasPin, PIN_PATTERN, setPin } from "./kidmode.ts";
import { enqueue, enqueueView, send, sendView, type SendResult, type ViewSendResult } from "./outbox.ts";
import { VideoStep, viewSummary } from "./VideoStep.tsx";
import { launchFromPackage, type SessionPoint } from "./package.ts";
import { preflight, type Preflight } from "./preflight.ts";
import { useOptionalDevice } from "../device/session.tsx";
import { hasVideo } from "../device/content.ts";
import { markSessionDone } from "../device/bundle.ts";
import { setSessionRunning } from "../device/update.ts";
import type { OpenSpace } from "../device/spaces.ts";

const BETWEEN_GAMES_S = 5;
const LONG_PRESS_MS = 1500;

type Phase =
  | { k: "handoff" }
  | { k: "play"; i: number }
  | { k: "between"; i: number }
  | { k: "finished" }
  | { k: "summary" };

type Played =
  | { kind: "game"; id: string; step: LaunchGameStep; envelope: ResultEnvelope; send: SendResult | { state: "sending" } }
  | { kind: "video"; id: string; step: LaunchVideoStep; view: VideoViewInput; send: ViewSendResult | { state: "sending" } };

/** A session started from the device's package (no connection): the package, what to launch, and the pre-flight. */
interface OfflineStart {
  source: SessionPackage;
  space: OpenSpace;
  check: Preflight;
  history: Record<string, SessionPoint[]>;
}

export function SessionPage() {
  const t = useT();
  const { plannedSessionId = "" } = useParams();
  const launch = useLaunch();
  const device = useOptionalDevice();
  const started = useRef(false);
  const [offline, setOffline] = useState<OfflineStart | null>(null);
  const [withoutMissing, setWithoutMissing] = useState(false);
  useTitle(t("run.title"));

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    launch.mutate(plannedSessionId, {
      // No connection: start from the package this device keeps for the session (offline devices spec §7.4).
      onError: (e) => {
        const space = device?.space;
        if (!(e instanceof ApiError && e.status === 0) || !space) return;
        void (async () => {
          const b = await space.read<OfflineBundle>("bundle");
          const source = b?.packages.find((p) => p.planned_session_id === plannedSessionId);
          if (!source) return;
          const history: Record<string, SessionPoint[]> = {};
          for (const st of source.steps) if (st.kind === "game") history[st.assignment_step_id] = (await space.read<SessionPoint[]>(`local_history:${st.assignment_step_id}`)) ?? [];
          const check = await preflight(source, { online: navigator.onLine, hasVideo });
          setOffline({ source, space, check, history });
        })();
      },
    });
  }, [plannedSessionId, launch, device]);

  // Decided once per start: a fresh seed and the device's difficulty choice must not change on a re-render.
  const offlinePkg = useMemo(() => {
    if (!offline || (!offline.check.ok && !withoutMissing)) return null;
    const missing = new Set(offline.check.ok ? [] : offline.check.missing.map((m) => m.ordinal));
    const source = { ...offline.source, steps: offline.source.steps.filter((st) => !missing.has(st.ordinal)) };
    return launchFromPackage(source, (asid) => offline.history[asid] ?? [], () => Math.floor(Math.random() * 2 ** 31));
  }, [offline, withoutMissing]);

  if (offline) {
    if (!offline.check.ok && !withoutMissing) {
      return <PreflightMissing missing={offline.check.missing} onStartWithout={() => setWithoutMissing(true)} />;
    }
    if (offlinePkg) return <Runner pkg={offlinePkg} space={offline.space} />;
  }
  if (launch.isError && launch.error instanceof ApiError && launch.error.status === 0 && device?.space) {
    return <MazeLoader label={t("common.loading")} />;
  }
  if (launch.isError) {
    const code = launch.error instanceof ApiError ? launch.error.code : "unknown";
    const known = ["consent_required", "session_closed", "protocol_not_active", "not_found", "forbidden"];
    return (
      <Shell>
        <Card>
          <div className="handoff__form">
            <Alert tone="warning">{t(`run.error.${known.includes(code) ? code : "unknown"}` as MessageId)}</Alert>
            <div className="pform__actions">
              <Link to="/today" className="emb-btn emb-btn--secondary">
                {t("run.backToday")}
              </Link>
            </div>
          </div>
        </Card>
      </Shell>
    );
  }
  if (!launch.data) return <MazeLoader label={t("common.loading")} />;
  return <Runner pkg={launch.data} />;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="handoff">
      <div className="handoff__top">
        <Logo />
      </div>
      <main id="main" className="handoff__main">
        {children}
      </main>
    </div>
  );
}

function PreflightMissing({ missing, onStartWithout }: { missing: Array<{ ordinal: number; title: string }>; onStartWithout: () => void }) {
  const t = useT();
  return (
    <Shell>
      <Card>
        <div className="handoff__form">
          <Alert tone="warning">{t("run.preflight.missing", { count: missing.length })}</Alert>
          <ul className="run-games">
            {missing.map((m) => (
              <li key={m.ordinal}>▶ {m.title}</li>
            ))}
          </ul>
          <div className="pform__actions">
            <Link to="/today" className="emb-btn emb-btn--secondary">
              {t("run.preflight.wait")}
            </Link>
            <Button onClick={onStartWithout}>{t("run.preflight.startWithout")}</Button>
          </div>
        </div>
      </Card>
    </Shell>
  );
}

function Runner({ pkg, space = null }: { pkg: LaunchPackage; space?: OpenSpace | null }) {
  const t = useT();
  const qc = useQueryClient();
  const { locale } = usePrefs();
  const queue = pkg.steps.filter((s) => !s.done);
  const [phase, setPhase] = useState<Phase>(queue.length ? { k: "handoff" } : { k: "summary" });
  const [played, setPlayed] = useState<Played[]>([]);
  const gameName = (id: string) => (findGame(id) ? localText(findGame(id)!.manifest.name, locale) : id);
  const stepName = (s: LaunchStep) => (s.kind === "video" ? s.video.title : gameName(s.game_id));

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: assignmentKey(pkg.patient.id) });
    void qc.invalidateQueries({ queryKey: sessionsKey(pkg.patient.id) });
    void qc.invalidateQueries({ queryKey: ["progression", pkg.patient.id] });
    void qc.invalidateQueries({ queryKey: ["today"] });
  }, [qc, pkg.patient.id]);
  const settle = (id: string, r: Played["send"]) => setPlayed((p) => p.map((x) => (x.id === id ? ({ ...x, send: r } as Played) : x)));

  // While a session runs, a new app version waits (offline devices spec §7.1).
  useEffect(() => {
    setSessionRunning(true);
    return () => setSessionRunning(false);
  }, []);

  const upload = useCallback(
    (step: LaunchGameStep, envelope: ResultEnvelope) => {
      const id = envelope.session_id;
      setPlayed((p) => [...p, { kind: "game", id, step, envelope, send: { state: "sending" } }]);
      // First to the device, then to the server.
      void enqueue(step.ticket, envelope)
        .then(() => send({ ticket: step.ticket, envelope }))
        .then((r) => {
          settle(id, r);
          refresh();
        });
      // Played from a package: this result also feeds the device's next difficulty choice for the step.
      if (space && envelope.status !== "abandoned") {
        const key = `local_history:${step.assignment_step_id}`;
        const point: SessionPoint = { accuracy: envelope.std.accuracy, difficulty: Number((envelope.params as { difficulty?: number }).difficulty ?? 0), valid: true };
        void space.read<SessionPoint[]>(key).then((h) => space.write(key, [...(h ?? []), point]));
      }
    },
    [refresh, space],
  );

  const recordView = useCallback(
    (step: LaunchVideoStep, raw: VideoViewInput) => {
      // From a package the step carries its v2 ticket: whoever sends the view later, it's credited correctly.
      const view = step.ticket ? { ...raw, ticket: step.ticket } : raw;
      const id = view.client_view_id;
      setPlayed((p) => [...p, { kind: "video", id, step, view, send: { state: "sending" } }]);
      void enqueueView(view) // same rule as results: the device first
        .then(() => sendView(view))
        .then((r) => {
          settle(id, r);
          refresh();
        });
    },
    [refresh],
  );

  // Played from a package: Today moves on to the next session on this device right away.
  useEffect(() => {
    if (space && (phase.k === "finished" || phase.k === "summary") && played.length) void markSessionDone(space, pkg.planned_session_id);
  }, [space, phase.k, played.length, pkg.planned_session_id]);

  const retry = () => {
    for (const x of played.filter((p) => p.send.state === "waiting")) {
      settle(x.id, { state: "sending" });
      if (x.kind === "game") void send({ ticket: x.step.ticket, envelope: x.envelope }).then((r) => settle(x.id, r));
      else void sendView(x.view).then((r) => settle(x.id, r));
    }
  };

  const next = (i: number) => setPhase(i < queue.length ? { k: "between", i } : { k: "finished" });

  if (phase.k === "handoff") {
    return <Handoff pkg={pkg} games={queue.map((s) => (s.kind === "video" ? `▶ ${stepName(s)}` : stepName(s)))} onStart={() => setPhase({ k: "play", i: 0 })} />;
  }
  if (phase.k === "play") {
    const step = queue[phase.i]!;
    if (step.kind === "video") {
      return (
        <VideoPlay
          key={step.assignment_step_id}
          step={step}
          plannedSessionId={pkg.planned_session_id}
          onView={(view) => recordView(step, view)}
          onDone={(how) => (how === "end" ? setPhase({ k: "finished" }) : next(phase.i + 1))}
        />
      );
    }
    return (
      <PlayStep
        key={step.assignment_step_id}
        step={step}
        name={gameName(step.game_id)}
        onResult={(env) => upload(step, env)}
        onDone={(how) => (how === "end" ? setPhase({ k: "finished" }) : next(phase.i + 1))}
      />
    );
  }
  if (phase.k === "between") {
    return <Between name={stepName(queue[phase.i]!)} n={phase.i + 1} total={queue.length} onGo={() => setPhase({ k: "play", i: phase.i })} />;
  }
  if (phase.k === "finished") {
    return <Finished child={pkg.patient.given_name} onUnlock={() => setPhase({ k: "summary" })} />;
  }
  return <Summary pkg={pkg} played={played} stepName={stepName} retry={retry} />;
}

// ------------------------------------------------------------------ hand-off

function Handoff({ pkg, games, onStart }: { pkg: LaunchPackage; games: string[]; onStart: () => void }) {
  const t = useT();
  const [pinReady, setPinReady] = useState(hasPin);
  return (
    <Shell>
      <Card>
        <div className="handoff__form">
          <p className="app-muted">{t("run.sessionOf", { seq: pkg.seq, total: pkg.total, name: pkg.assignment.name })}</p>
          <h1 className="auth__title">
            {t("run.handoff.title", { name: iso(pkg.patient.given_name) })}
          </h1>
          {pkg.patient.alert && <Alert tone="warning">{pkg.patient.alert}</Alert>}
          <ol className="run-games">
            {games.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ol>
          {pinReady ? (
            <>
              <p className="app-muted">{t("run.handoff.body")}</p>
              <div className="pform__actions">
                <Button size="lg" icon={<Play size={20} aria-hidden="true" />} onClick={onStart}>
                  {t("run.start")}
                </Button>
                <Link to={`/patients/${pkg.patient.id}`} className="emb-btn emb-btn--ghost">
                  {t("common.cancel")}
                </Link>
              </div>
            </>
          ) : (
            <>
              <Alert tone="info">{t("kidpin.needed")}</Alert>
              <SetPinForm onSaved={() => setPinReady(true)} />
            </>
          )}
        </div>
      </Card>
    </Shell>
  );
}

// ------------------------------------------------------------------ playing

function PlayStep({ step, name, onResult, onDone }: { step: LaunchGameStep; name: string; onResult: (e: ResultEnvelope) => void; onDone: (how: "next" | "end") => void }) {
  const t = useT();
  const [sessionId] = useState(uuidv7);
  const [failed, setFailed] = useState(false);
  const [controls, setControls] = useState<"closed" | "pin" | "menu">("closed");
  const sendRef = useRef<((m: HostToFrame) => void) | null>(null);
  const ending = useRef<"skip" | "end" | null>(null);
  const ended = useRef(false);

  const openControls = () => {
    sendRef.current?.({ type: "pause" });
    setControls("pin");
  };
  const closeControls = () => {
    setControls("closed");
    sendRef.current?.({ type: "resume" });
  };
  const stop = (how: "skip" | "end") => {
    setControls("closed");
    if (ended.current) return onDone(how === "end" ? "end" : "next");
    ending.current = how;
    sendRef.current?.({ type: "quit", by: "therapist" }); // the game ends as "abandoned" and still reports its result
  };

  if (failed) {
    return (
      <Shell>
        <Card>
          <div className="handoff__form">
            <Alert tone="danger">{t("run.gameError", { name })}</Alert>
            <div className="pform__actions">
              <Button onClick={() => onDone("next")} icon={<SkipForward size={18} aria-hidden="true" className="emb-flip-rtl" />}>
                {t("run.skip")}
              </Button>
              <Button variant="secondary" onClick={() => onDone("end")}>
                {t("run.end")}
              </Button>
            </div>
          </div>
        </Card>
      </Shell>
    );
  }

  const game = findGame(step.game_id);
  if (!game) {
    return (
      <Shell>
        <Alert tone="danger">{t("run.gameError", { name })}</Alert>
      </Shell>
    );
  }

  return (
    <div className="playscreen">
      <GameFrame
        game={game}
        sessionId={sessionId}
        params={step.params as LaunchParams}
        demo={false}
        title={name}
        loadingLabel={t("common.loading")}
        control={(s) => (sendRef.current = s)}
        onHeartbeat={noteActivity}
        onEnded={(env) => {
          ended.current = true;
          onResult(env);
          if (ending.current) onDone(ending.current === "end" ? "end" : "next");
        }}
        onClosed={() => {
          if (!ending.current) onDone("next");
        }}
        onError={(message) => {
          console.warn("Game frame error:", message); // messages come from game code, never patient data
          setFailed(true);
        }}
      />
      <LongPress label={t("run.controls")} onTrigger={openControls} />
      {controls !== "closed" && (
        <div className="run-overlay" role="dialog" aria-modal="true" aria-labelledby="run-controls-title">
          <Card>
            <div className="handoff__form">
              <h2 id="run-controls-title" className="app-cardtitle">
                {t("run.controls")}
              </h2>
              {controls === "pin" ? (
                <CheckPinForm onOk={() => setControls("menu")} onCancel={closeControls} />
              ) : (
                <div className="run-menu">
                  <Button icon={<Play size={18} aria-hidden="true" />} onClick={closeControls}>
                    {t("run.resume")}
                  </Button>
                  <Button variant="secondary" icon={<SkipForward size={18} aria-hidden="true" className="emb-flip-rtl" />} onClick={() => stop("skip")}>
                    {t("run.skip")}
                  </Button>
                  <Button variant="ghost" icon={<Square size={18} aria-hidden="true" />} onClick={() => stop("end")}>
                    {t("run.end")}
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

/** A video between games, with the same corner controls as a game (skip records the view as not completed). */
function VideoPlay({ step, plannedSessionId, onView, onDone }: { step: LaunchVideoStep; plannedSessionId: string; onView: (v: VideoViewInput) => void; onDone: (how: "next" | "end") => void }) {
  const t = useT();
  const [controls, setControls] = useState<"closed" | "pin" | "menu">("closed");
  const finishRef = useRef<(() => void) | null>(null);
  const how = useRef<"next" | "end">("next");
  const stop = (h: "next" | "end") => {
    setControls("closed");
    how.current = h;
    finishRef.current?.();
  };
  return (
    <div className="playscreen playscreen--video">
      <VideoStep
        step={step}
        plannedSessionId={plannedSessionId}
        finishRef={finishRef}
        onDone={(view) => {
          onView(view);
          onDone(how.current);
        }}
      />
      <LongPress label={t("run.controls")} onTrigger={() => setControls("pin")} />
      {controls !== "closed" && (
        <div className="run-overlay" role="dialog" aria-modal="true" aria-labelledby="run-controls-title">
          <Card>
            <div className="handoff__form">
              <h2 id="run-controls-title" className="app-cardtitle">
                {t("run.controls")}
              </h2>
              {controls === "pin" ? (
                <CheckPinForm onOk={() => setControls("menu")} onCancel={() => setControls("closed")} />
              ) : (
                <div className="run-menu">
                  <Button icon={<Play size={18} aria-hidden="true" />} onClick={() => setControls("closed")}>
                    {t("run.resume")}
                  </Button>
                  <Button variant="secondary" icon={<SkipForward size={18} aria-hidden="true" className="emb-flip-rtl" />} onClick={() => stop("next")}>
                    {t("run.skip")}
                  </Button>
                  <Button variant="ghost" icon={<Square size={18} aria-hidden="true" />} onClick={() => stop("end")}>
                    {t("run.end")}
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

/** A quiet corner button that needs a long press, so a child's tap doesn't open it. Keyboard: Enter or Space. */
function LongPress({ label, onTrigger }: { label: string; onTrigger: () => void }) {
  const timer = useRef(0);
  const [holding, setHolding] = useState(false);
  const cancel = () => {
    window.clearTimeout(timer.current);
    setHolding(false);
  };
  return (
    <button
      type="button"
      className={`run-corner${holding ? " run-corner--holding" : ""}`}
      aria-label={label}
      onPointerDown={() => {
        setHolding(true);
        timer.current = window.setTimeout(() => {
          setHolding(false);
          onTrigger();
        }, LONG_PRESS_MS);
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onTrigger();
        }
      }}
    >
      <Lock size={16} aria-hidden="true" />
    </button>
  );
}

function Between({ name, n, total, onGo }: { name: string; n: number; total: number; onGo: () => void }) {
  const t = useT();
  const [left, setLeft] = useState(BETWEEN_GAMES_S);
  const go = useRef(onGo);
  go.current = onGo;
  useEffect(() => {
    if (left <= 0) {
      go.current();
      return;
    }
    const id = window.setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [left]);
  return (
    <Shell>
      <Card>
        <div className="handoff__done">
          <p className="app-muted">{t("run.between.count", { n, total })}</p>
          <h1 className="auth__title">{t("run.between.title", { name })}</h1>
          <p className="run-count emb-tnum" aria-live="polite">
            {left}
          </p>
          <Button size="lg" icon={<Play size={20} aria-hidden="true" />} onClick={onGo}>
            {t("run.between.go")}
          </Button>
        </div>
      </Card>
    </Shell>
  );
}

function Finished({ child, onUnlock }: { child: string; onUnlock: () => void }) {
  const t = useT();
  const me = useMe();
  const [asking, setAsking] = useState(false);
  return (
    <Shell>
      <Card>
        <div className="handoff__done">
          <CircleCheck size={56} aria-hidden="true" className="handoff__doneicon" />
          <h1 className="auth__title">
            {t("run.finished.title", { name: iso(child) })}
          </h1>
          <p className="auth__subtitle">
            <Hand size={18} aria-hidden="true" /> {t("run.finished.body", { name: iso(firstName(me.data?.user.name ?? "")) })}
          </p>
          {asking ? (
            <CheckPinForm onOk={onUnlock} onCancel={() => setAsking(false)} />
          ) : (
            <Button variant="secondary" icon={<Lock size={18} aria-hidden="true" />} onClick={() => setAsking(true)}>
              {t("run.finished.therapist")}
            </Button>
          )}
        </div>
      </Card>
    </Shell>
  );
}

// ------------------------------------------------------------------ therapist summary

function Summary({ pkg, played, stepName, retry }: { pkg: LaunchPackage; played: Played[]; stepName: (s: LaunchStep) => string; retry: () => void }) {
  const t = useT();
  const intl = useIntl();
  const waiting = played.some((p) => p.send.state === "waiting");
  const notPlayed = pkg.steps.filter((s) => !s.done && !played.some((p) => p.step.assignment_step_id === s.assignment_step_id));
  return (
    <Shell>
      <div className="handoff__form">
        <div>
          <p className="app-muted">{t("run.sessionOf", { seq: pkg.seq, total: pkg.total, name: pkg.assignment.name })}</p>
          <h1 className="auth__title">
            {t("run.summary.title", { name: iso(`${pkg.patient.given_name} ${pkg.patient.family_name}`) })}
          </h1>
        </div>
        {played.length === 0 && <Alert tone="info">{t("run.summary.none")}</Alert>}
        {played.map((p) =>
          p.kind === "video" ? (
            <Card key={p.id} as="section" labelledBy={`r-${p.id}`}>
              <div className="app-cardrow">
                <h2 id={`r-${p.id}`} className="app-cardtitle">
                  {stepName(p.step)}
                </h2>
                <SendChip s={p.send} />
              </div>
              <p>{(({ id, time }) => t(id, { time }))(viewSummary(p.view))}</p>
            </Card>
          ) : (
          <Card key={p.id} as="section" labelledBy={`r-${p.id}`}>
            <div className="app-cardrow">
              <h2 id={`r-${p.id}`} className="app-cardtitle">
                {stepName(p.step)}
              </h2>
              <SendChip s={p.send} />
            </div>
            <ResultSummary envelope={p.envelope} intl={intl} />
            {p.send.state === "saved" && p.send.receipt.progression && <ProgressionLine p={p.send.receipt.progression} />}
            {p.send.state === "saved" && p.send.receipt.outcome === "accepted" && p.envelope.status === "abandoned" && (
              <p className="app-muted">{t("run.summary.abandoned")}</p>
            )}
          </Card>
          ),
        )}
        {notPlayed.length > 0 && <Alert tone="info">{t("run.summary.notPlayed", { games: notPlayed.map(stepName).join(", ") })}</Alert>}
        {waiting && <Alert tone="warning">{t("run.summary.waiting")}</Alert>}
        <div className="pform__actions">
          {waiting && (
            <Button variant="secondary" icon={<RotateCw size={18} aria-hidden="true" />} onClick={retry}>
              {t("run.summary.retry")}
            </Button>
          )}
          <Link to={`/patients/${pkg.patient.id}`} className="emb-btn emb-btn--primary">
            {t("run.summary.done", { name: iso(pkg.patient.given_name) })}
          </Link>
        </div>
      </div>
    </Shell>
  );
}


function SendChip({ s }: { s: Played["send"] }) {
  const t = useT();
  if (s.state === "sending") return <Chip tone="neutral">{t("run.send.sending")}</Chip>;
  if (s.state === "saved") return <Chip tone="success" icon={<CircleCheck size={14} aria-hidden="true" />}>{t("run.send.saved")}</Chip>;
  if (s.state === "waiting") return <Chip tone="warning" icon={<CloudOff size={14} aria-hidden="true" />}>{t("run.send.waiting")}</Chip>;
  return <Chip tone="danger">{t("run.send.rejected")}</Chip>;
}

function ProgressionLine({ p }: { p: { action: "up" | "down" | "hold"; from: number; to: number } }) {
  const t = useT();
  const Icon = p.action === "up" ? ArrowUp : p.action === "down" ? ArrowDown : Minus;
  return (
    <p className="run-prog">
      <Icon size={18} aria-hidden="true" />
      {t("run.progression", { action: p.action, from: p.from, to: p.to })}
    </p>
  );
}

// ------------------------------------------------------------------ PIN forms

export function SetPinForm({ onSaved }: { onSaved: () => void }) {
  const t = useT();
  const [pin, setPinValue] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<MessageId | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!PIN_PATTERN.test(pin)) return setError("kidpin.invalid");
    if (pin !== again) return setError("kidpin.mismatch");
    await setPin(pin);
    setPinValue("");
    setAgain("");
    setError(null);
    onSaved();
  };
  return (
    <form className="handoff__form" onSubmit={(e) => void submit(e)} noValidate>
      <TextField inputMode="numeric" dir="ltr" className="emb-field--code" label={t("kidpin.new")} hint={t("kidpin.hint")} type="password" value={pin} maxLength={6} onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ""))} autoComplete="off" spellCheck={false} />
      <TextField inputMode="numeric" dir="ltr" className="emb-field--code" label={t("kidpin.again")} type="password" value={again} maxLength={6} onChange={(e) => setAgain(e.target.value.replace(/\D/g, ""))} autoComplete="off" spellCheck={false} error={error ? t(error) : undefined} />
      <div className="pform__actions">
        <Button type="submit">{t("kidpin.save")}</Button>
      </div>
    </form>
  );
}

function CheckPinForm({ onOk, onCancel }: { onOk: () => void; onCancel: () => void }) {
  const t = useT();
  const [pin, setPinValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await checkPin(pin);
    setPinValue("");
    if (r.ok) return onOk();
    setError(r.locked_ms ? t("kidpin.locked", { s: Math.ceil(r.locked_ms / 1000) }) : t("kidpin.wrong", { n: r.tries_left }));
  };
  return (
    <form className="handoff__form" onSubmit={(e) => void submit(e)} noValidate>
      <TextField inputMode="numeric" dir="ltr" className="emb-field--code" label={t("kidpin.enter")} type="password" value={pin} maxLength={6} autoFocus onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ""))} autoComplete="off" spellCheck={false} error={error ?? undefined} />
      <div className="pform__actions">
        <Button type="submit">{t("kidpin.unlock")}</Button>
        <Button variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
