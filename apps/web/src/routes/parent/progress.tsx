/** Parent progress — plain-language progress view + session history (§5.10). */
import { useState } from "react";
import { useIntl } from "react-intl";
import { Button, Card, Chip, DataList, EmptyState, MazeLoader, PageHeader, type Column } from "@emb/ui";
import { BarChart3 } from "lucide-react";
import type { GameSessionView } from "@emb/contracts";
import { useT, usePrefs, type MessageId } from "../../i18n/index.tsx";
import { useTitle } from "../../lib/title.ts";
import { useParentContext } from "./shell.tsx";
import { useChildProgress, useChildHistory } from "../../api/parent.ts";
import { findGame, localText } from "../../games/registry.ts";

const HISTORY_PAGE = 20;

export function ParentProgressPage() {
  const t = useT();
  const { activeChild } = useParentContext();
  useTitle(t("parent.progress"));

  if (!activeChild) {
    return (
      <div className="app-page">
        <EmptyState icon={<BarChart3 size={32} aria-hidden="true" />} title={t("parent.noChildren")}>
          {t("parent.noChildrenHint")}
        </EmptyState>
      </div>
    );
  }

  return <ProgressView childId={activeChild.id} childName={activeChild.given_name} />;
}

function ProgressView({ childId, childName }: { childId: string; childName: string }) {
  const t = useT();
  const intl = useIntl();
  const { locale } = usePrefs();
  const progress = useChildProgress(childId);
  const history = useChildHistory(childId);
  const [shown, setShown] = useState(HISTORY_PAGE);

  if (progress.isPending) return <MazeLoader label={t("common.loading")} />;

  if (progress.isError || !progress.data) {
    return (
      <div className="app-page">
        <PageHeader title={t("parent.progressTitle", { name: childName })} />
        <Card>
          <p>{t("errors.generic")}</p>
        </Card>
      </div>
    );
  }

  const { stats, protocols } = progress.data;
  const sessions = history.data?.sessions ?? [];
  const gameName = (id: string) => (findGame(id) ? localText(findGame(id)!.manifest.name, locale) : id);
  const date = (s: string) => intl.formatDate(new Date(s), { day: "numeric", month: "short", year: "numeric" });
  const time = (ms: number) => {
    const m = Math.floor(ms / 60000);
    const s = Math.round((ms % 60000) / 1000);
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  const columns: Column<GameSessionView>[] = [
    { id: "date", header: t("progress.col.date"), primary: true, cell: (s) => <span className="emb-tnum">{date(s.ended_at)}</span> },
    { id: "protocol", header: t("progress.col.protocol"), cell: (s) => s.assignment_name ?? "—" },
    { id: "game", header: t("progress.col.game"), cell: (s) => gameName(s.game_id) },
    { id: "difficulty", header: t("progress.col.difficulty"), numeric: true, cell: (s) => s.difficulty },
    { id: "result", header: t("progress.col.result"), cell: (s) => t("result.status", { status: s.status }) },
    { id: "accuracy", header: t("result.accuracy"), numeric: true, cell: (s) => (s.accuracy !== null ? intl.formatNumber(s.accuracy, { style: "percent" }) : "—") },
    { id: "rt", header: t("result.rt"), numeric: true, hideOnCard: true, cell: (s) => (s.rt_median_ms !== null ? t("result.ms", { n: s.rt_median_ms }) : "—") },
    { id: "time", header: t("result.time"), numeric: true, cell: (s) => <span className="emb-tnum" dir="ltr">{time(s.active_ms)}</span> },
  ];

  return (
    <div className="app-page">
      <PageHeader
        title={t("parent.progressTitle", { name: childName })}
        description={t("parent.progressIntro")}
      />

      {/* Summary stats */}
      <div className="parent-stats">
        <Card>
          <div className="parent-stat">
            <span className="parent-stat__value">{stats.total_sessions}</span>
            <span className="parent-stat__label">{t("parent.totalSessions")}</span>
          </div>
        </Card>
        <Card>
          <div className="parent-stat">
            <span className="parent-stat__value">
              {stats.last_session
                ? intl.formatDate(new Date(stats.last_session), { day: "numeric", month: "short", year: "numeric" })
                : "—"}
            </span>
            <span className="parent-stat__label">{t("parent.lastSession")}</span>
          </div>
        </Card>
      </div>

      {/* Active programs */}
      {protocols.length > 0 ? (
        protocols.map((p) => (
          <Card key={p.id}>
            <h3 className="parent-protocol__title">{p.title}</h3>
            <div className="parent-protocol__bar">
              <div
                className="parent-protocol__fill"
                style={{ width: p.total_sessions > 0 ? `${(p.completed_sessions / p.total_sessions) * 100}%` : "0%" }}
              />
            </div>
            <p className="parent-protocol__label">
              {t("parent.protocolProgress", {
                done: p.completed_sessions,
                total: p.total_sessions,
              })}
            </p>
          </Card>
        ))
      ) : (
        <Card>
          <EmptyState icon={<BarChart3 size={32} aria-hidden="true" />} title={t("parent.noProtocols")}>
            {t("parent.noProtocolsHint")}
          </EmptyState>
        </Card>
      )}

      {/* Session history */}
      {sessions.length > 0 && (
        <Card as="section" labelledBy="parent-history-title">
          <h2 id="parent-history-title" className="app-cardtitle">{t("parent.historyTitle")}</h2>
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
        </Card>
      )}
    </div>
  );
}

