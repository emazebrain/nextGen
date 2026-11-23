/**
 * The progress report as a document (migration 0042): one A4-shaped sheet that prints, or saves as PDF, exactly as
 * shown. It is written in the report's own language and direction, whatever language the reader's app is in, and
 * always on white paper with dark ink, whatever the theme.
 *
 * Wording follows §11.6: what was done and how results changed against the child's own earlier sessions. No norms,
 * no conclusions. The therapist's summary is printed as written.
 */
import { IntlProvider, useIntl } from "react-intl";
import type { ProgressReport } from "../../api/progress-reports.ts";
import { catalogs, isRtl, type MessageId } from "../../i18n/index.tsx";
import { findGame, localText } from "../../games/registry.ts";
import { iso } from "../../lib/format.ts";

export function ReportDocument({ report }: { report: ProgressReport }) {
  return (
    <IntlProvider locale={report.locale} messages={catalogs[report.locale]} onError={() => {}}>
      <Sheet report={report} />
    </IntlProvider>
  );
}

function Sheet({ report }: { report: ProgressReport }) {
  const intl = useIntl();
  const t = (id: MessageId, values?: Record<string, string | number>) => intl.formatMessage({ id }, values) as string;
  const d = report.data;
  const formal = report.audience === "formal";
  const first = iso(d.patient.given_name);
  const day = (s: string) => intl.formatDate(new Date(s.length === 10 ? `${s}T00:00:00` : s), { day: "numeric", month: "long", year: "numeric" });
  const shortDay = (s: string) => intl.formatDate(new Date(s), { day: "numeric", month: "short" });
  const num = (n: number) => intl.formatNumber(n);
  const pct = (n: number | null) => (n === null ? "—" : intl.formatNumber(n, { style: "percent", maximumFractionDigits: 0 }));
  const gameName = (id: string) => {
    const g = findGame(id);
    return g ? localText(g.manifest.name, report.locale) : id;
  };

  return (
    <article className="rdoc" lang={report.locale} dir={isRtl(report.locale) ? "rtl" : "ltr"}>
      <header className="rdoc__letterhead">
        <div>
          <p className="rdoc__clinic">{d.clinic.name}</p>
          {d.clinic.address && <p>{d.clinic.address}</p>}
          {d.clinic.phone && (
            <p>
              {t("pr.phone")}: <bdi dir="ltr">{d.clinic.phone}</bdi>
            </p>
          )}
          {formal && d.clinic.license_no && (
            <p>
              {t("pr.license")}: <bdi dir="ltr">{d.clinic.license_no}</bdi>
            </p>
          )}
        </div>
        <h1 className="rdoc__title">{t("pr.title")}</h1>
      </header>

      <dl className="rdoc__facts">
        <div>
          <dt>{t("pr.patient")}</dt>
          <dd>
            <bdi>
              {d.patient.given_name} {d.patient.family_name}
            </bdi>
          </dd>
        </div>
        <div>
          <dt>{t("pr.dob")}</dt>
          <dd>{day(d.patient.date_of_birth)}</dd>
        </div>
        <div>
          <dt>{t("pr.periodLabel")}</dt>
          <dd>{t("pr.period", { from: day(report.period_from), to: day(report.period_to) })}</dd>
        </div>
        <div>
          <dt>{t("pr.by")}</dt>
          <dd>
            <bdi>{d.author.name}</bdi>
          </dd>
        </div>
        <div>
          <dt>{t("pr.issued")}</dt>
          <dd>{day(report.created_at)}</dd>
        </div>
      </dl>

      {report.summary && (
        <section className="rdoc__section">
          <h2>{formal ? t("pr.summary.formal") : t("pr.summary.family", { name: iso(d.author.name) })}</h2>
          <p className="rdoc__summary">{report.summary}</p>
        </section>
      )}

      <section className="rdoc__section">
        <h2>{t("pr.glance")}</h2>
        {d.totals.sessions === 0 ? (
          <p>{t("pr.none")}</p>
        ) : (
          <dl className="rdoc__stats">
            <div>
              <dt>{t("pr.stat.sessions")}</dt>
              <dd>{num(d.totals.sessions)}</dd>
            </div>
            <div>
              <dt>{t("pr.stat.minutes")}</dt>
              <dd>{num(d.totals.minutes)}</dd>
            </div>
            <div>
              <dt>{t("pr.stat.days")}</dt>
              <dd>{num(d.totals.days_active)}</dd>
            </div>
            <div>
              <dt>{t("pr.stat.where")}</dt>
              <dd>
                {num(d.totals.clinic_sessions)} / {num(d.totals.home_sessions)}
              </dd>
            </div>
            {d.plan.planned > 0 && (
              <div>
                <dt>{t("pr.stat.plan")}</dt>
                <dd>{t("pr.stat.planValue", { done: d.plan.done, planned: d.plan.planned })}</dd>
              </div>
            )}
            {d.plan.missed > 0 && (
              <div>
                <dt>{t("pr.stat.missed")}</dt>
                <dd>{num(d.plan.missed)}</dd>
              </div>
            )}
          </dl>
        )}
      </section>

      {d.activities.length > 0 && (
        <section className="rdoc__section">
          <h2>{t("pr.activities")}</h2>
          <table className="rdoc__table">
            <thead>
              <tr>
                <th scope="col">{t("pr.col.activity")}</th>
                <th scope="col" className="is-num">
                  {t("pr.col.sessions")}
                </th>
                <th scope="col" className="is-num">
                  {t("pr.col.accuracy")}
                </th>
                <th scope="col" className="is-num">
                  {t("pr.col.difficulty")}
                </th>
              </tr>
            </thead>
            <tbody>
              {d.activities.map((a) => (
                <tr key={a.game_id}>
                  <th scope="row">{gameName(a.game_id)}</th>
                  <td className="is-num">{num(a.sessions)}</td>
                  <td className="is-num">{pct(a.avg_accuracy)}</td>
                  <td className="is-num">{a.first_difficulty === a.last_difficulty ? num(a.last_difficulty) : t("pr.difficultyRange", { from: a.first_difficulty, to: a.last_difficulty })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {d.totals.sessions > 0 && (
        <section className="rdoc__section">
          <h2>{t("pr.trend")}</h2>
          <p>{t(`pr.trend.${d.trend.summary}` as MessageId, { name: first })}</p>
          <TrendFigure points={d.trend.points} label={t("pr.trend.chart", { name: first })} baseline={t("pr.trend.baseline")} date={shortDay} />
        </section>
      )}

      {d.totals.sessions > 0 && (
        <section className="rdoc__section">
          <h2>{t("pr.changes")}</h2>
          {d.changes.length === 0 ? (
            <p>{t("pr.changes.none")}</p>
          ) : (
            <ul className="rdoc__list">
              {d.changes.map((c, i) => (
                <li key={i}>{t(c.action === "up" ? "pr.change.up" : "pr.change.down", { date: day(c.decided_at), game: gameName(c.game_id), from: c.from, to: c.to })}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {formal && (
        <div className="rdoc__sign">
          <div>
            <span className="rdoc__line" />
            {t("pr.signature")}
          </div>
          <div>
            <span className="rdoc__line" />
            {t("pr.date")}
          </div>
        </div>
      )}

      <footer className="rdoc__footer">{t("pr.footer", { name: first })}</footer>
    </article>
  );
}

/** Scores over the period against the child's own starting level (100). Static, so it prints as drawn. */
function TrendFigure({ points, label, baseline, date }: { points: Array<{ ended_at: string; score: number | null }>; label: string; baseline: string; date: (s: string) => string }) {
  const pts = points.filter((p): p is { ended_at: string; score: number } => p.score !== null);
  if (pts.length === 0) return null;
  const W = 640;
  const H = 190;
  const L = 36;
  const R = 12;
  const T = 12;
  const B = 26;
  const lo = Math.floor((Math.min(100, ...pts.map((p) => p.score)) - 5) / 25) * 25;
  const hi = Math.ceil((Math.max(100, ...pts.map((p) => p.score)) + 5) / 25) * 25;
  const x = (i: number) => (pts.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (pts.length - 1));
  const y = (v: number) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const ticks: number[] = [];
  for (let v = lo; v <= hi; v += 25) ticks.push(v);
  const labelEvery = Math.max(1, Math.ceil(pts.length / 6));
  return (
    <figure className="rdoc__figure">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="rdoc__chart">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className={v === 100 ? "rdoc__base" : "rdoc__grid"} />
            <text x={L - 6} y={y(v) + 4} textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        {pts.length > 1 && <polyline className="rdoc__lineplot" points={pts.map((p, i) => `${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(" ")} />}
        {pts.map((p, i) => (
          <g key={p.ended_at + i}>
            <circle className="rdoc__dot" cx={x(i)} cy={y(p.score)} r={3.5} />
            {((i % labelEvery === 0 && pts.length - 1 - i >= labelEvery) || i === pts.length - 1) && (
              <text x={x(i)} y={H - 8} textAnchor={pts.length > 1 && i === pts.length - 1 ? "end" : pts.length > 1 && i === 0 ? "start" : "middle"}>
                {date(p.ended_at)}
              </text>
            )}
          </g>
        ))}
      </svg>
      <figcaption>
        <span className="rdoc__key" /> {baseline} (100)
      </figcaption>
    </figure>
  );
}
