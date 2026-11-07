/**
 * Patient → Progress (design doc §5.9, slice 5): activity totals, one trend
 * at a time (accuracy, response time, or a skill from the games played),
 * difficulty changes, and every game played.
 *
 * Wording follows §11.6: everything is compared with this child's own
 * earlier sessions; no age norms, percentiles or red/green "at risk" flags.
 */
import { useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { ArrowDown, ArrowUp, BarChart3, LineChart, Table2 } from "lucide-react";
import { activity, skillsPlayed, trend, type GameInfo, type TrendPoint, type View } from "@emb/metrics";
import type { GameSessionView, ProgressionDecisionView } from "@emb/contracts";
import { Button, Card, Chip, DataList, EmptyState, MazeLoader, SelectField, type Column } from "@emb/ui";
import { usePatientSessions, useProgression, useReview } from "../../api/queries.ts";
import { GAMES, findGame, localText } from "../../games/registry.ts";
import { usePrefs, useT, type MessageId } from "../../i18n/index.tsx";
import { iso } from "../../lib/format.ts";
import { LoadError } from "../shared.tsx";
import { usePatientCtx } from "./detail.tsx";
import { TrendChart } from "./TrendChart.tsx";

const GAME_INFO: GameInfo[] = GAMES.map((g) => ({ id: g.manifest.id, metrics: g.manifest.metrics }));
const HISTORY_PAGE = 20;

type ViewKey = "accuracy" | "rt_median_ms" | `skill:${string}`;
const toView = (k: ViewKey): View => (k.startsWith("skill:") ? { kind: "skill", skill: k.slice(6) } : { kind: "standard", key: k as "accuracy" | "rt_median_ms" });

export function PatientProgress() {
  const t = useT();
  const intl = useIntl();
  const { locale } = usePrefs();
  const { patient: p } = usePatientCtx();
  const sessions = usePatientSessions(p.id);
  const decisions = useProgression(p.id);
  const [viewKey, setViewKey] = useState<ViewKey>("accuracy");
  const [asTable, setAsTable] = useState(false);
  const [shown, setShown] = useState(HISTORY_PAGE);

  const all = sessions.data ?? [];
  // Results kept for review but not counted (excluded, or consent withdrawn and not yet reviewed) stay out of the
  // charts and totals; the history below still lists them with why (offline devices spec §7.4).
  const list = useMemo(() => all.filter((s) => s.counts !== false), [all]);
  const skills = useMemo(() => skillsPlayed(list, GAME_INFO), [list]);
  const view = toView(viewKey);
  const tr = useMemo(() => trend(list, GAME_INFO, view), [list, viewKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const totals = useMemo(() => activity(list, new Date()), [list]);
  const name = iso(p.given_name);

  if (sessions.isPending) return <MazeLoader label={t("common.loading")} />;
  if (sessions.isError) return <LoadError error={sessions.error} retry={() => void sessions.refetch()} />;
  if (all.length === 0) {
    return (
      <Card>
        <EmptyState icon={<BarChart3 size={28} aria-hidden="true" />} title={t("progress.empty.title")}>
          {t("progress.empty.body", { name })}
        </EmptyState>
      </Card>
    );
  }

  const gameName = (id: string) => (findGame(id) ? localText(findGame(id)!.manifest.name, locale) : id);
  const viewLabel = (k: ViewKey) =>
    k === "accuracy" ? t("progress.view.accuracy") : k === "rt_median_ms" ? t("progress.view.rt") : t(`skill.${k.slice(6)}` as MessageId);
  const num = (n: number) => intl.formatNumber(n, { maximumFractionDigits: 0 });
  const date = (s: string) => intl.formatDate(new Date(s), { day: "numeric", month: "short", year: "numeric" });
  const valueOf = (pt: TrendPoint) =>
    pt.value === null ? null : viewKey === "accuracy" ? intl.formatNumber(pt.value, { style: "percent" }) : t("result.ms", { n: Math.round(pt.value) });

  const summaryText =
    tr.summary === "not_enough"
      ? t("progress.summary.not_enough", { name, count: tr.scoredCount })
      : t(`progress.summary.${tr.summary}`, { name, score: num(tr.recentScore ?? 100) });

  const tableColumns: Column<TrendPoint & { n: number }>[] = [
    { id: "n", header: t("progress.col.session"), primary: true, cell: (r) => <span className="emb-tnum">{t("progress.chart.session", { n: r.n })}</span> },
    { id: "date", header: t("progress.col.date"), cell: (r) => <span className="emb-tnum">{date(r.endedAt)}</span> },
    { id: "game", header: t("progress.col.game"), cell: (r) => gameName(r.gameId) },
    { id: "difficulty", header: t("progress.col.difficulty"), numeric: true, cell: (r) => r.difficulty },
    ...(view.kind === "standard" ? [{ id: "value", header: t("progress.col.value"), numeric: true, cell: (r: TrendPoint) => valueOf(r) ?? "—" }] : []),
    {
      id: "score",
      header: t("progress.col.score"),
      numeric: true,
      cell: (r) => (
        <span className="progress-score">
          {r.score !== null ? num(r.score) : "—"}
          {r.isBaseline && <Chip>{t("progress.chart.settingBaseline")}</Chip>}
        </span>
      ),
    },
  ];

  return (
    <div className="progress">
      <dl className="progress-tiles">
        <div className="progress-tile">
          <dt>{t("progress.tile.sessions")}</dt>
          <dd>{num(totals.sessions)}</dd>
        </div>
        <div className="progress-tile">
          <dt>{t("progress.tile.minutes")}</dt>
          <dd>{num(totals.minutes)}</dd>
        </div>
        <div className="progress-tile">
          <dt>{t("progress.tile.last")}</dt>
          <dd>{totals.lastPlayed ? date(totals.lastPlayed) : t("progress.tile.never")}</dd>
        </div>
      </dl>

      <Card as="section" labelledBy="trend-title">
        <div className="progress-head">
          <div className="progress-head__text">
            <h2 id="trend-title" className="app-cardtitle">
              {t("progress.chart.title", { view: viewLabel(viewKey), name })}
            </h2>
            <p className="app-muted">{t("progress.chart.subtitle")}</p>
          </div>
          <div className="progress-head__controls">
            <SelectField label={t("progress.view")} value={viewKey} onChange={(e) => setViewKey(e.target.value as ViewKey)} className="progress-view">
              <option value="accuracy">{t("progress.view.accuracy")}</option>
              <option value="rt_median_ms">{t("progress.view.rt")}</option>
              {skills.map((s) => (
                <option key={s} value={`skill:${s}`}>
                  {t(`skill.${s}` as MessageId)}
                </option>
              ))}
            </SelectField>
            <Button
              variant="secondary"
              icon={asTable ? <LineChart size={18} aria-hidden="true" /> : <Table2 size={18} aria-hidden="true" />}
              onClick={() => setAsTable((v) => !v)}
              aria-pressed={asTable}
            >
              {t(asTable ? "progress.showChart" : "progress.showTable")}
            </Button>
          </div>
        </div>

        <p className="progress-summary" aria-live="polite">
          <Chip tone={tr.summary === "not_enough" ? "neutral" : "brand"}>{t("progress.summary.chip", { summary: tr.summary })}</Chip>
          <span>{summaryText}</span>
        </p>

        {tr.points.length === 0 ? (
          <p className="app-muted">{t("progress.chart.noScore")}</p>
        ) : asTable ? (
          <DataList
            rows={tr.points.map((pt, i) => ({ ...pt, n: i + 1 })).reverse()}
            columns={tableColumns}
            getRowKey={(r) => r.sessionId}
            caption={t("progress.table.caption", { view: viewLabel(viewKey) })}
            layout="table"
          />
        ) : (
          <TrendChart
            points={tr.points}
            text={{
              label: t("progress.chart.label", { view: viewLabel(viewKey), count: tr.points.length }),
              baseline: t("progress.chart.baseline"),
              difficulty: t("progress.chart.difficulty"),
              session: (n) => t("progress.chart.session", { n }),
              score: (score) => t("progress.chart.score", { score }),
              settingBaseline: t("progress.chart.settingBaseline"),
              noScore: t("progress.chart.noScore"),
              date,
              game: gameName,
              value: valueOf,
              number: num,
            }}
          />
        )}
        <p className="app-muted progress-note">{t("progress.note", { name })}</p>
      </Card>

      <Card as="section" labelledBy="decisions-title">
        <h2 id="decisions-title" className="app-cardtitle">
          {t("progress.decisions.title")}
        </h2>
        <Decisions q={decisions} gameName={gameName} date={date} />
      </Card>

      <section aria-labelledby="history-title" className="progress-history">
        <h2 id="history-title" className="app-cardtitle">
          {t("progress.history.title")}
        </h2>
        <History sessions={all.slice(0, shown)} gameName={gameName} date={date} patientId={p.id} />
        {all.length > shown && (
          <Button variant="secondary" onClick={() => setShown((n) => n + HISTORY_PAGE)}>
            {t("progress.history.more", { count: Math.min(HISTORY_PAGE, all.length - shown) })}
          </Button>
        )}
      </section>
    </div>
  );
}

function Decisions({
  q,
  gameName,
  date,
}: {
  q: ReturnType<typeof useProgression>;
  gameName: (id: string) => string;
  date: (s: string) => string;
}) {
  const t = useT();
  if (q.isPending) return <MazeLoader label={t("common.loading")} />;
  if (q.isError) return <LoadError error={q.error} retry={() => void q.refetch()} />;
  if (q.data.length === 0) return <p className="app-muted">{t("progress.decisions.empty")}</p>;
  return (
    <ul className="plainlist decisions">
      {q.data.map((d: ProgressionDecisionView) => {
        const Icon = d.action === "up" ? ArrowUp : ArrowDown;
        return (
          <li key={d.id} className="decision">
            <span className="decision__icon">
              <Icon size={18} aria-hidden="true" />
            </span>
            <span className="decision__text">
              <span>{t("progress.decision", { reason: d.reason, from: d.from_difficulty, to: d.to_difficulty })}</span>
              <span className="app-muted">
                {gameName(d.game_id)} · <span className="emb-tnum">{date(d.decided_at)}</span>
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A result that arrived after something changed (offline devices spec §7.4): why it was flagged, and Count it /
 * Don't count it while nobody has decided. The decision is append-only on the server; the latest one counts.
 */
export function ReviewCell({ session, patientId }: { session: GameSessionView; patientId: string }) {
  const t = useT();
  const review = useReview(patientId);
  if (!session.review) return null;
  const { reason, decision } = session.review;
  return (
    <span className="review-cell">
      <Chip tone={decision === "accept" ? "success" : decision === "exclude" ? "neutral" : "warning"}>{t("review.reason", { reason })}</Chip>
      {decision === null ? (
        <>
          <Button variant="secondary" loading={review.isPending && review.variables?.decision === "accept"} onClick={() => review.mutate({ id: session.id, decision: "accept" })}>
            {t("review.accept")}
          </Button>
          <Button variant="ghost" loading={review.isPending && review.variables?.decision === "exclude"} onClick={() => review.mutate({ id: session.id, decision: "exclude" })}>
            {t("review.exclude")}
          </Button>
        </>
      ) : (
        <span className="app-muted">{t(decision === "accept" ? "review.counted" : "review.notCounted")}</span>
      )}
    </span>
  );
}

function History({ sessions, gameName, date, patientId }: { sessions: GameSessionView[]; gameName: (id: string) => string; date: (s: string) => string; patientId: string }) {
  const t = useT();
  const intl = useIntl();
  const time = (ms: number) => {
    const m = Math.floor(ms / 60000);
    const s = Math.round((ms % 60000) / 1000);
    return `${m}:${String(s).padStart(2, "0")}`;
  };
  const columns: Column<GameSessionView>[] = [
    { id: "date", header: t("progress.col.date"), primary: true, cell: (s) => <span className="emb-tnum">{date(s.ended_at)}</span> },
    { id: "game", header: t("progress.col.game"), cell: (s) => gameName(s.game_id) },
    { id: "difficulty", header: t("progress.col.difficulty"), numeric: true, cell: (s) => s.difficulty },
    { id: "mode", header: t("progress.col.mode"), hideOnCard: true, cell: (s) => t("game.mode", { mode: s.session_mode }) },
    { id: "result", header: t("progress.col.result"), cell: (s) => t("result.status", { status: s.status }) },
    { id: "accuracy", header: t("result.accuracy"), numeric: true, cell: (s) => (s.accuracy !== null ? intl.formatNumber(s.accuracy, { style: "percent" }) : "—") },
    { id: "rt", header: t("result.rt"), numeric: true, hideOnCard: true, cell: (s) => (s.rt_median_ms !== null ? t("result.ms", { n: s.rt_median_ms }) : "—") },
    { id: "review", header: t("review.column"), hideOnCard: false, cell: (s) => (s.review ? <ReviewCell session={s} patientId={patientId} /> : null) },
    {
      id: "time",
      header: t("result.time"),
      numeric: true,
      cell: (s) => (
        <span className="emb-tnum" dir="ltr">
          {time(s.active_ms)}
        </span>
      ),
    },
  ];
  return <DataList rows={sessions} columns={columns} getRowKey={(s) => s.id} caption={t("progress.history.caption")} />;
}
