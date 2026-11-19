/** Parent progress — plain-language progress view (§5.10). */
import { Card, EmptyState, MazeLoader, PageHeader } from "@emb/ui";
import { BarChart3 } from "lucide-react";
import { useT } from "../../i18n/index.tsx";
import { useTitle } from "../../lib/title.ts";
import { useParentContext } from "./shell.tsx";
import { useChildProgress } from "../../api/parent.ts";

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
  const progress = useChildProgress(childId);

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
                ? new Date(stats.last_session).toLocaleDateString()
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
    </div>
  );
}
