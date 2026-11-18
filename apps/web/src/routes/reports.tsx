/**
 * Reports dashboard (design doc §5.9.2): summary tiles, sessions-over-time
 * chart, and activity breakdown table.
 *
 * Therapists see their own caseload; clinic admins see all.
 */
import { useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { BarChart3 } from "lucide-react";
import { Card, EmptyState, MazeLoader, PageHeader, Segmented, SelectField, type Column, DataList } from "@emb/ui";
import { useReportsSummary, useSessionsOverTime, useActivityBreakdown, type TimeSeriesPoint, type ActivityBreakdown } from "../api/queries.ts";
import { useClinic } from "../lib/clinic.tsx";
import { useT, usePrefs } from "../i18n/index.tsx";
import { useTitle } from "../lib/title.ts";
import { findGame, localText } from "../games/registry.ts";
import { LoadError } from "./shared.tsx";

type Period = "day" | "week" | "month";
type DateRange = "7d" | "30d" | "month" | "3m" | "all";

/** Compute ISO date strings for a preset range. */
function dateRangeBounds(range: DateRange): { from?: string; to?: string } {
  if (range === "all") return {};
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  switch (range) {
    case "7d": {
      const from = new Date(now);
      from.setDate(from.getDate() - 7);
      return { from: fmt(from) };
    }
    case "30d": {
      const from = new Date(now);
      from.setDate(from.getDate() - 30);
      return { from: fmt(from) };
    }
    case "month": {
      return { from: fmt(new Date(now.getFullYear(), now.getMonth(), 1)) };
    }
    case "3m": {
      const from = new Date(now);
      from.setMonth(from.getMonth() - 3);
      return { from: fmt(from) };
    }
  }
}

export function ReportsPage() {
  const t = useT();
  const intl = useIntl();
  const { locale } = usePrefs();
  const { clinicId } = useClinic();
  const [period, setPeriod] = useState<Period>("week");
  const [dateRange, setDateRange] = useState<DateRange>("all");
  useTitle(t("reports.title"));

  const bounds = useMemo(() => dateRangeBounds(dateRange), [dateRange]);

  const summary = useReportsSummary(clinicId);
  const timeline = useSessionsOverTime(clinicId, period, bounds.from, bounds.to);
  const breakdown = useActivityBreakdown(clinicId, bounds.from, bounds.to);

  const gameName = (id: string) => {
    const g = findGame(id);
    return g ? localText(g.manifest.name, locale) : id;
  };
  const num = (n: number) => intl.formatNumber(n, { maximumFractionDigits: 0 });
  const pct = (n: number | null) => (n !== null ? intl.formatNumber(n, { style: "percent", maximumFractionDigits: 0 }) : "—");
  const dateLabel = (s: string) => {
    const d = new Date(s);
    if (period === "month") return intl.formatDate(d, { month: "short", year: "2-digit" });
    if (period === "week") return intl.formatDate(d, { day: "numeric", month: "short" });
    return intl.formatDate(d, { day: "numeric", month: "short" });
  };

  if (summary.isPending) {
    return (
      <div className="app-page">
        <PageHeader title={t("reports.title")} />
        <MazeLoader label={t("common.loading")} />
      </div>
    );
  }
  if (summary.isError) {
    return (
      <div className="app-page">
        <PageHeader title={t("reports.title")} />
        <Card>
          <LoadError error={summary.error} retry={() => void summary.refetch()} />
        </Card>
      </div>
    );
  }

  const s = summary.data;
  const durationMin = s.avg_duration_ms ? Math.round(s.avg_duration_ms / 60_000) : null;

  if (s.total_sessions === 0) {
    return (
      <div className="app-page">
        <PageHeader title={t("reports.title")} />
        <Card>
          <EmptyState icon={<BarChart3 size={28} aria-hidden="true" />} title={t("reports.title")}>
            {t("reports.empty")}
          </EmptyState>
        </Card>
      </div>
    );
  }

  const breakdownColumns: Column<ActivityBreakdown>[] = [
    { id: "game", header: t("reports.breakdown.game"), primary: true, cell: (r) => gameName(r.game_id) },
    { id: "count", header: t("reports.breakdown.sessions"), numeric: true, cell: (r) => num(r.count) },
    { id: "accuracy", header: t("reports.breakdown.avgAccuracy"), numeric: true, cell: (r) => pct(r.avg_accuracy) },
  ];

  return (
    <div className="app-page">
      <PageHeader
        title={t("reports.title")}
        actions={
          <SelectField label={t("reports.dateRange")} hideLabel value={dateRange} onChange={(e) => setDateRange(e.currentTarget.value as DateRange)}>
            <option value="all">{t("reports.allTime")}</option>
            <option value="7d">{t("reports.last7days")}</option>
            <option value="30d">{t("reports.last30days")}</option>
            <option value="month">{t("reports.thisMonth")}</option>
            <option value="3m">{t("reports.last3months")}</option>
          </SelectField>
        }
      />

      <dl className="reports-tiles">
        <Card as="div" className="reports-tile">
          <dt>{t("reports.tiles.sessions")}</dt>
          <dd>{num(s.total_sessions)}</dd>
        </Card>
        <Card as="div" className="reports-tile">
          <dt>{t("reports.tiles.activePatients")}</dt>
          <dd>{num(s.active_patients)}</dd>
        </Card>
        <Card as="div" className="reports-tile">
          <dt>{t("reports.tiles.thisMonth")}</dt>
          <dd>{num(s.sessions_this_month)}</dd>
        </Card>
        <Card as="div" className="reports-tile">
          <dt>{t("reports.tiles.avgDuration")}</dt>
          <dd>{durationMin !== null ? t("reports.tiles.minutes", { n: durationMin }) : "—"}</dd>
        </Card>
      </dl>

      <Card as="section" labelledBy="sessions-chart">
        <div className="progress-head">
          <h2 id="sessions-chart" className="app-cardtitle">
            {t("reports.chart.sessionsTitle")}
          </h2>
          <Segmented<Period>
            legend={t("reports.chart.period")}
            name="period"
            value={period}
            onChange={setPeriod}
            options={[
              { value: "day", label: t("reports.chart.day") },
              { value: "week", label: t("reports.chart.week") },
              { value: "month", label: t("reports.chart.month") },
            ]}
          />
        </div>
        {timeline.isPending ? (
          <MazeLoader label={t("common.loading")} />
        ) : timeline.isError ? (
          <LoadError error={timeline.error} retry={() => void timeline.refetch()} />
        ) : timeline.data.length === 0 ? (
          <p className="app-muted">{t("reports.empty")}</p>
        ) : (
          <SessionsChart data={timeline.data} dateLabel={dateLabel} />
        )}
      </Card>

      <Card as="section" labelledBy="breakdown-title">
        <h2 id="breakdown-title" className="app-cardtitle">
          {t("reports.breakdown.title")}
        </h2>
        {breakdown.isPending ? (
          <MazeLoader label={t("common.loading")} />
        ) : breakdown.isError ? (
          <LoadError error={breakdown.error} retry={() => void breakdown.refetch()} />
        ) : breakdown.data.length === 0 ? (
          <p className="app-muted">{t("reports.empty")}</p>
        ) : (
          <DataList rows={breakdown.data} columns={breakdownColumns} getRowKey={(r) => r.game_id} caption={t("reports.breakdown.title")} />
        )}
      </Card>
    </div>
  );
}

/** Simple SVG bar chart for sessions over time with gridlines and hover. */
function SessionsChart({ data, dateLabel }: { data: TimeSeriesPoint[]; dateLabel: (s: string) => string }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  const gap = 4;
  const barWidth = Math.max(14, Math.min(36, 480 / data.length - gap));
  const padStart = 20;
  const chartWidth = padStart + data.length * (barWidth + gap) + 20;
  const chartHeight = 140;
  const barAreaTop = 12;
  const barAreaBottom = chartHeight - 22;
  const barAreaHeight = barAreaBottom - barAreaTop;

  // Simple gridlines: 2–4 horizontal lines at round intervals
  const step = max <= 4 ? 1 : max <= 10 ? 2 : max <= 30 ? 5 : Math.ceil(max / 4 / 5) * 5;
  const gridlines: number[] = [];
  for (let v = step; v < max; v += step) gridlines.push(v);

  return (
    <div className="reports-chart" role="img" aria-label="Sessions over time chart">
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="xMidYMid meet">
        {/* Gridlines */}
        {gridlines.map((v) => {
          const y = barAreaBottom - (v / max) * barAreaHeight;
          return <line key={v} className="reports-gridline" x1={padStart - 4} y1={y} x2={chartWidth - 16} y2={y} />;
        })}
        {/* Bars */}
        {data.map((d, i) => {
          const x = padStart + i * (barWidth + gap);
          const h = max > 0 ? (d.count / max) * barAreaHeight : 0;
          const y = barAreaBottom - h;
          return (
            <g key={d.period}>
              <rect className="reports-bar" x={x} y={y} width={barWidth} height={Math.max(h, 0)} rx={3} />
              {d.count > 0 && (
                <text className="reports-bar-value" x={x + barWidth / 2} y={y - 4}>
                  {d.count}
                </text>
              )}
              <text className="reports-bar-label" x={x + barWidth / 2} y={chartHeight - 4} dominantBaseline="auto">
                {dateLabel(d.period)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
