/** Parent home — today's session card, child overview (§5.10). */
import { useState } from "react";
import { useNavigate } from "react-router";
import { useIntl } from "react-intl";
import { Button, Card, Chip, EmptyState, MazeLoader, PageHeader } from "@emb/ui";
import { CalendarDays, Play } from "lucide-react";
import { useT } from "../../i18n/index.tsx";
import { useTitle } from "../../lib/title.ts";
import { useParentContext } from "./shell.tsx";
import { useChildSessions, useLaunchHomeSession, type HomePlannedSession } from "../../api/parent.ts";
import type { MessageId } from "../../i18n/index.tsx";

export function ParentHomePage() {
  const t = useT();
  const intl = useIntl();
  const { activeChild } = useParentContext();
  useTitle(t("parent.home"));

  if (!activeChild) {
    return (
      <div className="app-page">
        <EmptyState icon={<CalendarDays size={32} aria-hidden="true" />} title={t("parent.noChildren")}>
          {t("parent.noChildrenHint")}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="app-page">
      <PageHeader
        title={t("parent.welcome", { name: activeChild.given_name })}
        description={t("parent.homeIntro")}
      />
      <Card>
        <div className="parent-child-card">
          <h3 className="parent-child-card__name">
            <bdi>{activeChild.given_name} {activeChild.family_name}</bdi>
          </h3>
          <dl className="parent-child-card__details">
            <div className="parent-child-card__detail">
              <dt>{t("parent.clinic")}</dt>
              <dd><bdi>{activeChild.clinic_name}</bdi></dd>
            </div>
            <div className="parent-child-card__detail">
              <dt>{t("parent.status")}</dt>
              <dd>{t("patients.status", { status: activeChild.status })}</dd>
            </div>
          </dl>
        </div>
      </Card>

      <SessionCards childId={activeChild.id} />
    </div>
  );
}

function SessionCards({ childId }: { childId: string }) {
  const t = useT();
  const intl = useIntl();
  const navigate = useNavigate();
  const sessions = useChildSessions(childId);
  const launch = useLaunchHomeSession(childId);
  const [launching, setLaunching] = useState<string | null>(null);

  if (sessions.isPending) return <MazeLoader label={t("common.loading")} />;
  if (sessions.isError) return null;

  const { upcoming, recent } = sessions.data;
  const today = new Date().toISOString().slice(0, 10);
  const date = (s: string) => intl.formatDate(new Date(s + "T00:00:00"), { day: "numeric", month: "short", year: "numeric" });

  const handleLaunch = async (sessionId: string) => {
    setLaunching(sessionId);
    try {
      const result = await launch.mutateAsync(sessionId);
      // Navigate to session runner with the launch package
      navigate(`/session/${sessionId}`, { state: { launch: result.launch, fromParent: true } });
    } catch {
      setLaunching(null);
    }
  };

  if (upcoming.length === 0) {
    return (
      <Card>
        <EmptyState icon={<CalendarDays size={32} aria-hidden="true" />} title={t("parent.noSession")}>
          {t("parent.noSessionHint")}
        </EmptyState>
      </Card>
    );
  }

  // Split into today/overdue and future
  const todayOrOverdue = upcoming.filter((s) => s.planned_date <= today);
  const future = upcoming.filter((s) => s.planned_date > today);

  return (
    <>
      {todayOrOverdue.length > 0 && (
        <Card as="section" labelledBy="parent-sessions-ready">
          <h2 id="parent-sessions-ready" className="app-cardtitle">{t("parent.sessionsReady")}</h2>
          <ul className="plainlist parent-sessions">
            {todayOrOverdue.map((s) => (
              <li key={s.id} className="parent-session">
                <div className="parent-session__info">
                  <span className="parent-session__name"><bdi>{s.assignment_name}</bdi></span>
                  <span className="parent-session__meta app-muted">
                    {t("parent.sessionMeta", { seq: s.seq, total: s.total ?? 0, week: s.week })}
                    {s.planned_date < today && (
                      <Chip tone="warning">{t("parent.overdue")}</Chip>
                    )}
                  </span>
                </div>
                <Button
                  icon={<Play size={18} aria-hidden="true" />}
                  onClick={() => void handleLaunch(s.id)}
                  loading={launching === s.id}
                >
                  {t("parent.startSession")}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {future.length > 0 && (
        <Card as="section" labelledBy="parent-sessions-upcoming">
          <h2 id="parent-sessions-upcoming" className="app-cardtitle">{t("parent.upcomingSessions")}</h2>
          <ul className="plainlist parent-sessions">
            {future.map((s) => (
              <li key={s.id} className="parent-session">
                <div className="parent-session__info">
                  <span className="parent-session__name"><bdi>{s.assignment_name}</bdi></span>
                  <span className="parent-session__meta app-muted">
                    {t("parent.sessionDate", { date: date(s.planned_date) })}
                    {" · "}
                    {t("parent.sessionMeta", { seq: s.seq, total: s.total ?? 0, week: s.week })}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {recent.length > 0 && (
        <Card as="section" labelledBy="parent-sessions-recent">
          <h2 id="parent-sessions-recent" className="app-cardtitle">{t("parent.recentSessions")}</h2>
          <ul className="plainlist parent-sessions">
            {recent.map((s) => (
              <li key={s.id} className="parent-session">
                <div className="parent-session__info">
                  <span className="parent-session__name"><bdi>{s.assignment_name}</bdi></span>
                  <span className="parent-session__meta app-muted">
                    {date(s.planned_date)}
                    {" · "}
                    {t("parent.sessionMeta", { seq: s.seq, total: s.total ?? 0, week: s.week })}
                  </span>
                </div>
                <Chip tone="success">{t("parent.sessionDone")}</Chip>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
