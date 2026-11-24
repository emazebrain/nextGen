/** Parent results — session history and progress for each child (§5.10). */
import { useState } from "react";
import { useIntl } from "react-intl";
import { Button, Card, DataList, EmptyState, MazeLoader, PageHeader, type Column } from "@emb/ui";
import { BarChart3 } from "lucide-react";
import type { GameSessionView } from "@emb/contracts";
import { useT, usePrefs } from "../../i18n/index.tsx";
import { useTitle } from "../../lib/title.ts";
import { useParentContext } from "./shell.tsx";
import { useChildProgress, useChildHistory } from "../../api/parent.ts";
import { findGame, localText } from "../../games/registry.ts";
import { useChildReports } from "../../api/progress-reports.ts";
import { ReportList } from "../patients/reports.tsx";

const HISTORY_PAGE = 20;

export function ParentResultsPage() {
  const t = useT();
  const { children } = useParentContext();
  useTitle(t("parent.results"));

  if (children.length === 0) {
    return (
      <div className="app-page">
        <EmptyState icon={<BarChart3 size={32} aria-hidden="true" />} title={t("parent.noChildren")}>
          {t("parent.noChildrenHint")}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="app-page">
      <PageHeader title={t("parent.resultsTitle")} description={t("parent.resultsIntro")} />
      {children.map((child) => (
        <ChildResults key={child.id} childId={child.id} childName={child.given_name} />
      ))}
    </div>
  );
}

function ChildResults({ childId, childName }: { childId: string; childName: string }) {
  const t = useT();
  const intl = useIntl();
  const { locale } = usePrefs();
  const progress = useChildProgress(childId);
  const history = useChildHistory(childId);
  const reports = useChildReports(childId);
  const [shown, setShown] = useState(HISTORY_PAGE);

  if (progress.isPending) return <MazeLoader label={t("common.loading")} />;

  const stats = progress.data?.stats;
  const protocols = progress.data?.protocols ?? [];
  const sessions = history.data?.sessions ?? [];
  const gameName = (id: string) => (findGame(id) ? localText(findGame(id)!.manifest.name, locale) : id);
  const date = (s: string) => intl.formatDate(new Date(s), { day: "numeric", month: "short", year: "numeric" });

  // What a parent can read at a glance: when, which activity, how much was right, how long. The therapist's own
  // columns (difficulty, how the round ended, reaction time) stay on the clinic side.
  const columns: Column<GameSessionView>[] = [
    { id: "date", header: t("progress.col.date"), primary: true, cell: (s) => <span className="emb-tnum">{date(s.ended_at)}</span> },
    { id: "game", header: t("parent.col.activity"), cell: (s) => gameName(s.game_id) },
    { id: "accuracy", header: t("parent.col.correct"), numeric: true, cell: (s) => (s.accuracy !== null ? intl.formatNumber(s.accuracy, { style: "percent" }) : "—") },
    { id: "time", header: t("result.time"), numeric: true, cell: (s) => <span className="emb-tnum">{t("parent.minutes", { n: Math.max(1, Math.round(s.active_ms / 60000)) })}</span> },
  ];

  return (
    <Card as="section">
      <h2 className="app-cardtitle"><bdi>{childName}</bdi></h2>

      {stats && (
        <div className="parent-stats-inline">
          <span><strong>{stats.total_sessions}</strong> {t("parent.totalSessions").toLowerCase()}</span>
          {stats.last_session && (
            <span className="app-muted">{t("parent.lastPlayed", { date: date(stats.last_session) })}</span>
          )}
        </div>
      )}

      {protocols.length > 0 && (
        <div className="parent-protocols">
          {protocols.map((p) => (
            <div key={p.id} className="parent-protocol-row">
              <span>{p.title}</span>
              <span className="app-muted">{t("parent.protocolProgress", { done: p.completed_sessions, total: p.total_sessions })}</span>
            </div>
          ))}
        </div>
      )}

      {reports.data && reports.data.length > 0 && (
        <>
          <h3 className="app-muted" style={{ marginBlockStart: "var(--space-4)", marginBlockEnd: "var(--space-2)" }}>{t("pr.ui.parentSection")}</h3>
          <ReportList reports={reports.data} href={(r) => `/parent/reports/${r.id}`} />
        </>
      )}

      {sessions.length > 0 ? (
        <>
          <h3 className="app-muted" style={{ marginBlockStart: "var(--space-4)", marginBlockEnd: "var(--space-2)" }}>{t("parent.historyTitle")}</h3>
          <DataList
            rows={sessions.slice(0, shown)}
            columns={columns}
            getRowKey={(s) => s.id}
            caption={t("parent.historyCaption")}
          />
          {sessions.length > shown && (
            <Button variant="secondary" onClick={() => setShown((n) => n + HISTORY_PAGE)}>
              {t("progress.history.more", { count: Math.min(HISTORY_PAGE, sessions.length - shown) })}
            </Button>
          )}
        </>
      ) : (
        <p className="app-muted" style={{ marginBlockStart: "var(--space-3)" }}>{t("parent.noResultsYet")}</p>
      )}
    </Card>
  );
}
