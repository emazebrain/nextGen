/** Parent calendar — upcoming sessions for all children (§5.10). */
import { useIntl } from "react-intl";
import { Card, EmptyState, MazeLoader, PageHeader } from "@emb/ui";
import { CalendarDays } from "lucide-react";
import { useT } from "../../i18n/index.tsx";
import { useTitle } from "../../lib/title.ts";
import { useParentContext } from "./shell.tsx";
import { useChildSessions } from "../../api/parent.ts";

export function ParentCalendarPage() {
  const t = useT();
  const { children } = useParentContext();
  useTitle(t("parent.calendar"));

  if (children.length === 0) {
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
      <PageHeader title={t("parent.calendarTitle")} description={t("parent.calendarIntro")} />
      {children.map((child) => (
        <ChildCalendar key={child.id} childId={child.id} childName={child.given_name} />
      ))}
    </div>
  );
}

function ChildCalendar({ childId, childName }: { childId: string; childName: string }) {
  const t = useT();
  const intl = useIntl();
  const sessions = useChildSessions(childId);

  if (sessions.isPending) return <MazeLoader label={t("common.loading")} />;

  const upcoming = sessions.data?.upcoming ?? [];
  const recent = sessions.data?.recent ?? [];
  const today = new Date().toISOString().slice(0, 10);

  const formatDate = (s: string) => intl.formatDate(new Date(s + "T00:00:00"), { weekday: "short", day: "numeric", month: "short" });

  if (upcoming.length === 0 && recent.length === 0) {
    return (
      <Card>
        <h3 className="app-cardtitle"><bdi>{childName}</bdi></h3>
        <p className="app-muted">{t("parent.noSessionHint")}</p>
      </Card>
    );
  }

  return (
    <Card as="section">
      <h3 className="app-cardtitle"><bdi>{childName}</bdi></h3>
      {upcoming.length > 0 && (
        <ul className="plainlist parent-calendar">
          {upcoming.map((s) => (
            <li key={s.id} className="parent-calendar__item">
              <span className={`parent-calendar__date emb-tnum${s.planned_date < today ? " parent-calendar__date--overdue" : ""}`}>
                {formatDate(s.planned_date)}
              </span>
              <span className="parent-calendar__details">
                <span><bdi>{s.assignment_name}</bdi></span>
                <span className="app-muted">
                  {t("parent.sessionMeta", { seq: s.seq, total: s.total ?? 0, week: s.week })}
                </span>
              </span>
              <span className="parent-calendar__status">
                {s.planned_date < today ? (
                  <span className="parent-calendar__overdue">{t("parent.overdue")}</span>
                ) : s.planned_date === today ? (
                  <span className="parent-calendar__today">{t("parent.today")}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {recent.length > 0 && (
        <>
          <h4 className="app-muted" style={{ marginBlockStart: "var(--space-4)" }}>{t("parent.recentSessions")}</h4>
          <ul className="plainlist parent-calendar">
            {recent.map((s) => (
              <li key={s.id} className="parent-calendar__item parent-calendar__item--done">
                <span className="parent-calendar__date emb-tnum">{formatDate(s.planned_date)}</span>
                <span className="parent-calendar__details">
                  <span><bdi>{s.assignment_name}</bdi></span>
                </span>
                <span className="parent-calendar__status app-muted">{t("parent.sessionDone")}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
