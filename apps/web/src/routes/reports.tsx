/**
 * Reports, caseload first (reports dashboard design 2026-11-23; design doc §5.9.2). Three questions, in order:
 * who is worth a look, how is each patient doing, is the plan being followed. Then the activity mix.
 *
 * Therapists see their own caseload; clinic managers see the clinic (the API decides).
 * Wording follows §11.6: every comparison is with the child's own earlier sessions; no norms, no ranking,
 * no red/green flags. Only "waiting for review" carries the warning tone, because it asks for an action.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useIntl } from "react-intl";
import { ArrowDown, ArrowUp, BarChart3, Check, Clock, Play, TrendingDown, TrendingUp, UserRound } from "lucide-react";
import { Avatar, Chip, EmptyState, MazeLoader, PageHeader, SelectField } from "@emb/ui";
import { useActivityBreakdown, useAdherence, useCaseload, useReportsOverview, type AdherenceWeek, type CaseloadReason, type CaseloadRow, type ReportsOverview, type TrendSummary } from "../api/queries.ts";
import { useClinic } from "../lib/clinic.tsx";
import { useT, usePrefs, type MessageId } from "../i18n/index.tsx";
import { useTitle } from "../lib/title.ts";
import { iso } from "../lib/format.ts";
import { findGame, localText } from "../games/registry.ts";
import { LoadError } from "./shared.tsx";
import { ArcGauge, MiniArea, PlanChart, Sparkline, WeekBars } from "./reports/charts.tsx";
import { LookList, TREND_LABEL } from "./reports/look.tsx";

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];
const DAY_MS = 86_400_000;

const fullName = (p: { given_name: string; family_name: string }) => `${p.given_name} ${p.family_name}`;
const progressHref = (id: string) => `/patients/${encodeURIComponent(id)}/progress`;

export function ReportsPage() {
  const t = useT();
  const { clinicId } = useClinic();
  const [range, setRange] = useState<Range>(30);
  useTitle(t("reports.title"));

  const overview = useReportsOverview(clinicId, range);
  const caseload = useCaseload(clinicId);
  const adherence = useAdherence(clinicId);

  const header = (
    <div className="reports__head glass">
      <PageHeader
        title={t("reports.title")}
        description={t("reports.subtitle")}
        actions={
          <SelectField label={t("reports.dateRange")} hideLabel value={String(range)} onChange={(e) => setRange(Number(e.currentTarget.value) as Range)}>
            {RANGES.map((d) => (
              <option key={d} value={d}>
                {t(`reports.range.${d}` as MessageId)}
              </option>
            ))}
          </SelectField>
        }
      />
    </div>
  );

  if (overview.isPending || caseload.isPending) {
    return (
      <div className="app-page reports">
        {header}
        <MazeLoader label={t("common.loading")} />
      </div>
    );
  }
  const failed = overview.isError ? overview : caseload.isError ? caseload : null;
  if (failed) {
    return (
      <div className="app-page reports">
        {header}
        <div className="reports__tile glass">
          <LoadError error={failed.error} retry={() => void failed.refetch()} />
        </div>
      </div>
    );
  }

  const o = overview.data!;
  const patients = caseload.data!;
  if (patients.length === 0 && o.sessions === 0) {
    return (
      <div className="app-page reports">
        {header}
        <div className="reports__tile glass">
          <EmptyState icon={<BarChart3 size={28} aria-hidden="true" />} title={t("reports.title")}>
            {t("reports.empty")}
          </EmptyState>
        </div>
      </div>
    );
  }

  return (
    <div className="app-page reports">
      {header}
      <div className="reports__stage">
        <Tiles o={o} patients={patients} />
        <div className="reports__two">
          <WorthALook patients={patients} />
          <section className="reports__tile glass" aria-labelledby="reports-plan">
            <h2 id="reports-plan" className="app-cardtitle">
              {t("reports.plan.title")}
            </h2>
            <Plan q={adherence} />
          </section>
        </div>
        <Caseload patients={patients} />
        <Activities clinicId={clinicId} days={range} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- top row

function Tiles({ o, patients }: { o: ReportsOverview; patients: CaseloadRow[] }) {
  const t = useT();
  const intl = useIntl();
  const num = (n: number) => intl.formatNumber(n, { maximumFractionDigits: 0 });
  const pct = (n: number) => intl.formatNumber(n, { style: "percent", maximumFractionDigits: 0 });
  const minutes = o.avg_duration_ms === null ? null : Math.round(o.avg_duration_ms / 60_000);
  // Faces for the tile: the patients seen most recently.
  const recent = useMemo(() => [...patients].filter((p) => p.last_session_at).sort((a, b) => (b.last_session_at ?? "").localeCompare(a.last_session_at ?? "")), [patients]);
  const shown = recent.slice(0, 4);
  const more = Math.max(o.active_patients - shown.length, 0);

  return (
    <section className="reports__stats" aria-label={t("reports.summary")}>
      <div className="rstat glass">
        <h2 className="rstat__label">
          <span className="rstat__icon">
            <Play size={16} aria-hidden="true" className="emb-flip-rtl" />
          </span>
          {t("reports.tile.sessions")}
        </h2>
        <div>
          <b className="rstat__value">{num(o.sessions)}</b>
          <small>{t("reports.tile.sessionsWeek", { n: o.sessions_this_week })}</small>
        </div>
        <WeekBars values={o.weekly.map((w) => w.sessions)} label={t("reports.tile.sessionsChart")} format={num} />
      </div>

      <div className="rstat glass">
        <h2 className="rstat__label">
          <span className="rstat__icon">
            <UserRound size={16} aria-hidden="true" />
          </span>
          {t("reports.tile.active")}
        </h2>
        <div>
          <b className="rstat__value">{num(o.active_patients)}</b>
          <small>{t("reports.tile.inCare", { n: o.in_care })}</small>
        </div>
        <div className="rstat__faces" aria-hidden="true">
          {shown.map((p) => (
            <Avatar key={p.patient_id} name={fullName(p)} size={30} />
          ))}
          {more > 0 && <span className="rstat__more">+{num(more)}</span>}
        </div>
      </div>

      <div className="rstat glass">
        <h2 className="rstat__label">
          <span className="rstat__icon">
            <Check size={16} aria-hidden="true" />
          </span>
          {t("reports.tile.plan")}
        </h2>
        <div>
          <b className="rstat__value">{o.plan_followed === null ? "—" : pct(o.plan_followed)}</b>
          <small>{t(o.plan_followed === null ? "reports.tile.planNone" : "reports.tile.planHint")}</small>
        </div>
        {o.plan_followed !== null && <ArcGauge value={o.plan_followed} label={t("reports.tile.planChart", { pct: pct(o.plan_followed) })} />}
      </div>

      <div className="rstat glass">
        <h2 className="rstat__label">
          <span className="rstat__icon">
            <Clock size={16} aria-hidden="true" />
          </span>
          {t("reports.tile.duration")}
        </h2>
        <div>
          <b className="rstat__value">{minutes === null ? "—" : t("reports.tiles.minutes", { n: minutes })}</b>
          <small>{t("reports.tile.durationHint")}</small>
        </div>
        <MiniArea values={o.weekly.map((w) => w.avg_duration_ms)} label={t("reports.tile.durationChart")} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- worth a look

function WorthALook({ patients }: { patients: CaseloadRow[] }) {
  const t = useT();
  const list = patients.filter((p) => p.reasons.length > 0);
  return (
    <section className="reports__tile glass" aria-labelledby="reports-look">
      <h2 id="reports-look" className="app-cardtitle">
        {t("reports.look.title")}
        {list.length > 0 && <span className="reports__count emb-tnum">{list.length}</span>}
      </h2>
      {list.length === 0 ? <p className="app-muted">{t("reports.look.none")}</p> : <LookList patients={list} />}
    </section>
  );
}

// ---------------------------------------------------------------- plan

function Plan({ q }: { q: ReturnType<typeof useAdherence> }) {
  const t = useT();
  const intl = useIntl();
  if (q.isPending) return <MazeLoader label={t("common.loading")} />;
  if (q.isError) return <LoadError error={q.error} retry={() => void q.refetch()} />;
  if (q.data.every((w) => w.planned === 0 && w.done_clinic === 0 && w.done_home === 0)) return <p className="app-muted">{t("reports.plan.none")}</p>;
  const day = (s: string) => intl.formatDate(new Date(`${s}T00:00:00`), { day: "numeric", month: "short" });
  return (
    <>
      <ul className="plainlist rlegend">
        <li>
          <span className="rlegend__sw rlegend__sw--clinic" />
          {t("reports.plan.clinic")}
        </li>
        <li>
          <span className="rlegend__sw rlegend__sw--home" />
          {t("reports.plan.home")}
        </li>
        <li>
          <span className="rlegend__sw rlegend__sw--planned" />
          {t("reports.plan.planned")}
        </li>
      </ul>
      <PlanChart
        weeks={q.data}
        label={t("reports.plan.label")}
        weekLabel={day}
        describe={(w: AdherenceWeek) => t("reports.plan.week", { date: day(w.week_start), planned: w.planned, clinic: w.done_clinic, home: w.done_home })}
      />
    </>
  );
}

// ---------------------------------------------------------------- caseload

type SortKey = "name" | "trend" | "week" | "difficulty" | "last";
const TREND_ORDER: Record<TrendSummary, number> = { declining: 0, steady: 1, improving: 2, not_enough: 3 };

function Caseload({ patients }: { patients: CaseloadRow[] }) {
  const t = useT();
  const intl = useIntl();
  const { locale } = usePrefs();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);

  const rows = useMemo(() => {
    if (!sort) return patients; // as the server ordered them: most reasons to look first
    const collate = new Intl.Collator(locale);
    const value: Record<SortKey, (p: CaseloadRow) => number | string> = {
      name: (p) => fullName(p),
      trend: (p) => TREND_ORDER[p.summary],
      week: (p) => (p.week.planned === 0 ? 2 : p.week.done / p.week.planned),
      difficulty: (p) => p.difficulty ?? -1,
      // Most recent first on the first click, so the direction is flipped here.
      last: (p) => -(p.last_session_at ? Date.parse(p.last_session_at) : 0),
    };
    const get = value[sort.key];
    return [...patients].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      return (typeof x === "string" ? collate.compare(x, String(y)) : x - (y as number)) * sort.dir;
    });
  }, [patients, sort, locale]);

  if (patients.length === 0) return null;

  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const lastSeen = (s: string | null) => (s ? relative.format(-Math.max(0, Math.floor((Date.now() - Date.parse(s)) / DAY_MS)), "day") : t("reports.caseload.never"));
  const head = (key: SortKey, label: MessageId, numeric = false) => {
    const active = sort?.key === key;
    return (
      <th scope="col" className={numeric ? "is-num" : undefined} aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
        <button type="button" className="rcase__sort" aria-label={t("reports.caseload.sort", { column: t(label) })} onClick={() => setSort(active ? { key, dir: sort.dir === 1 ? -1 : 1 } : { key, dir: 1 })}>
          {t(label)}
          {active && (sort.dir === 1 ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />)}
        </button>
      </th>
    );
  };

  return (
    <section className="reports__tile glass" aria-labelledby="reports-caseload">
      <div className="reports__tilehead">
        <h2 id="reports-caseload" className="app-cardtitle">
          {t("reports.caseload.title")}
        </h2>
        <span className="app-muted">{t("reports.caseload.hint")}</span>
      </div>
      <div className="rcase__scroll">
        <table className="rcase" aria-labelledby="reports-caseload">
          <thead>
            <tr>
              {head("name", "reports.col.patient")}
              <th scope="col">{t("reports.col.scores")}</th>
              {head("trend", "reports.col.trend")}
              {head("week", "reports.col.week")}
              {head("difficulty", "reports.col.difficulty", true)}
              {head("last", "reports.col.last", true)}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const scored = p.scores.filter((s) => s !== null).length;
              return (
                <tr key={p.patient_id}>
                  <td>
                    <span className="rcase__who">
                      <Avatar name={fullName(p)} size={36} />
                      <Link to={progressHref(p.patient_id)} className="rcase__name">
                        <bdi>{fullName(p)}</bdi>
                      </Link>
                    </span>
                  </td>
                  <td>{scored > 0 ? <Sparkline scores={p.scores} label={t("reports.caseload.sparkline", { count: scored })} /> : <span className="app-muted">{t("reports.caseload.noScores")}</span>}</td>
                  <td>
                    <Chip
                      tone={p.summary === "improving" ? "brand" : "neutral"}
                      icon={p.summary === "improving" ? <TrendingUp size={14} aria-hidden="true" /> : p.summary === "declining" ? <TrendingDown size={14} aria-hidden="true" /> : undefined}
                    >
                      {t(TREND_LABEL[p.summary])}
                    </Chip>
                  </td>
                  <td>
                    {p.week.planned === 0 ? (
                      <span className="app-muted">{t("reports.caseload.weekNone")}</span>
                    ) : (
                      <span className="rcase__week">
                        <span className="rcase__pips" aria-hidden="true">
                          {Array.from({ length: Math.min(p.week.planned, 7) }, (_, i) => (
                            <span key={i} className={i < p.week.done ? "rcase__pip is-done" : "rcase__pip"} />
                          ))}
                        </span>
                        <span className="emb-tnum">{t("reports.caseload.week", { done: p.week.done, planned: p.week.planned })}</span>
                      </span>
                    )}
                  </td>
                  <td className="is-num emb-tnum">
                    {p.difficulty === null ? (
                      "—"
                    ) : (
                      <span className="rcase__diff">
                        {intl.formatNumber(p.difficulty)}
                        {p.last_change === "up" && <ArrowUp size={14} aria-label={t("reports.caseload.up")} />}
                        {p.last_change === "down" && <ArrowDown size={14} aria-label={t("reports.caseload.down")} />}
                      </span>
                    )}
                  </td>
                  <td className="is-num emb-tnum">{lastSeen(p.last_session_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- activities

function Activities({ clinicId, days }: { clinicId: string | null; days: number }) {
  const t = useT();
  const intl = useIntl();
  const { locale } = usePrefs();
  const from = useMemo(() => new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10), [days]);
  const q = useActivityBreakdown(clinicId, from);
  const gameName = (id: string) => {
    const g = findGame(id);
    return g ? localText(g.manifest.name, locale) : id;
  };
  const max = Math.max(1, ...(q.data ?? []).map((r) => r.count));
  return (
    <section className="reports__tile glass" aria-labelledby="reports-acts">
      <div className="reports__tilehead">
        <h2 id="reports-acts" className="app-cardtitle">
          {t("reports.breakdown.title")}
        </h2>
        <span className="app-muted">{t("reports.breakdown.hint")}</span>
      </div>
      {q.isPending ? (
        <MazeLoader label={t("common.loading")} />
      ) : q.isError ? (
        <LoadError error={q.error} retry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <p className="app-muted">{t("reports.breakdown.none")}</p>
      ) : (
        <ul className="plainlist racts">
          {q.data.map((r) => (
            <li key={r.game_id} className="racts__row">
              <span>{gameName(r.game_id)}</span>
              <span className="racts__track" aria-hidden="true">
                <span className="racts__fill" style={{ inlineSize: `${(r.count / max) * 100}%` }} />
              </span>
              <span className="emb-tnum racts__num">{intl.formatNumber(r.count)}</span>
              <span className="emb-tnum racts__num app-muted">{r.avg_accuracy === null ? "—" : intl.formatNumber(r.avg_accuracy, { style: "percent", maximumFractionDigits: 0 })}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
