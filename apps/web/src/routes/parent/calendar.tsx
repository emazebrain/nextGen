/**
 * Parent calendar (§5.10): for each child, the appointments the clinic set and the home sessions to do, in date
 * order. Read-only: a guardian sees only their own children and cannot set or change anything here.
 */
import { useState } from "react";
import { useIntl } from "react-intl";
import { Button, Card, EmptyState, MazeLoader, PageHeader } from "@emb/ui";
import { CalendarDays, Play } from "lucide-react";
import { useT } from "../../i18n/index.tsx";
import { useTitle } from "../../lib/title.ts";
import { useParentContext } from "./shell.tsx";
import { Link } from "react-router";
import { useChildAppointments, useChildSessions } from "../../api/parent.ts";
import type { StepItem } from "@emb/contracts";
import { findGame, localText } from "../../games/registry.ts";
import { usePrefs } from "../../i18n/index.tsx";
import { collapseRepeats, joinSteps } from "../../lib/steps.ts";
import { localToday, useStartHomeSession } from "./session.tsx";

/** A protocol can run for months: the calendar opens on what is next, and the rest is one tap away. */
const SHOWN = 6;

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
  const appointments = useChildAppointments(childId);
  const { start, starting, failed } = useStartHomeSession(childId);
  const { locale } = usePrefs();
  const [all, setAll] = useState(false);
  /** "▶ Warm-up → Catch Me If You Can ×2": what the session includes, on one line. */
  const stepLine = (items: StepItem[]) =>
    joinSteps(collapseRepeats(items.map((i) => (i.kind === "video" ? `▶ ${i.title}` : findGame(i.game_id) ? localText(findGame(i.game_id)!.manifest.name, locale) : i.game_id))), locale);

  if (sessions.isPending || appointments.isPending) return <MazeLoader label={t("common.loading")} />;

  const upcoming = sessions.data?.upcoming ?? [];
  const recent = sessions.data?.recent ?? [];
  const appts = appointments.data ?? [];
  const today = localToday();

  const formatDate = (s: string) => intl.formatDate(new Date(s + "T00:00:00"), { weekday: "short", day: "numeric", month: "short" });
  const clock = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number) as [number, number];
    return intl.formatTime(new Date(2000, 0, 1, h, m), { hour: "numeric", minute: "2-digit" });
  };

  // One list in date order: on the same day an appointment (it has a time) comes before a home session (any time).
  const coming = [
    ...appts.map((a) => ({ kind: "appointment" as const, key: `a-${a.id}`, date: a.date, order: a.start_time, a })),
    ...upcoming.map((s) => ({ kind: "session" as const, key: `s-${s.id}`, date: s.planned_date, order: "99:99", s })),
  ].sort((x, y) => x.date.localeCompare(y.date) || x.order.localeCompare(y.order));

  if (coming.length === 0 && recent.length === 0) {
    return (
      <Card>
        <h3 className="app-cardtitle"><bdi>{childName}</bdi></h3>
        {appointments.isError && <p className="app-muted">{t("parent.apptsUnavailable")}</p>}
        <p className="app-muted">{t("parent.nothingPlanned")}</p>
      </Card>
    );
  }

  const dayTag = (date: string, overdueable: boolean) =>
    date < today && overdueable ? (
      <span className="parent-calendar__overdue">{t("parent.overdue")}</span>
    ) : date === today ? (
      <span className="parent-calendar__today">{t("parent.today")}</span>
    ) : null;

  return (
    <Card as="section">
      <h3 className="app-cardtitle"><Link to={`/parent/children/${childId}`} className="parent-kid__link"><bdi>{childName}</bdi></Link></h3>
      {appointments.isError && <p className="app-muted">{t("parent.apptsUnavailable")}</p>}
      {coming.length > 0 && (
        <ul className="plainlist parent-calendar">
          {(all ? coming : coming.slice(0, SHOWN)).map((e) =>
            e.kind === "appointment" ? (
              <li key={e.key} className="parent-calendar__item parent-calendar__item--appt">
                <span className="parent-calendar__date emb-tnum">{formatDate(e.a.date)}</span>
                <span className="parent-calendar__details">
                  <span className="parent-calendar__title">
                    <CalendarDays size={16} aria-hidden="true" />
                    <bdi>{e.a.title || t("parent.appointment")}</bdi>
                  </span>
                  <span className="app-muted">
                    {/* A time range reads start-to-end left to right in every language. */}
                    <span className="emb-tnum" dir="ltr">
                      {clock(e.a.start_time)} – {clock(e.a.end_time)}
                    </span>
                    {" · "}
                    {t("parent.apptAt", { clinic: e.a.clinic_name })}
                  </span>
                </span>
                <span className="parent-calendar__status">{dayTag(e.a.date, false)}</span>
              </li>
            ) : (
              <li key={e.key} className="parent-calendar__item parent-calendar__item--session">
                <span className={`parent-calendar__date emb-tnum${e.s.planned_date < today && e.s.location === "home" ? " parent-calendar__date--overdue" : ""}`}>{formatDate(e.s.planned_date)}</span>
                <span className="parent-calendar__details">
                  <span><bdi>{e.s.assignment_name}</bdi></span>
                  <span className="app-muted">
                    {t(e.s.setting === "mixed" ? "parent.eitherSession" : e.s.location === "home" ? "parent.homeSession" : "parent.clinicSession")} · {t("parent.sessionMeta", { seq: e.s.seq, total: e.s.total ?? 0, week: e.s.week })}
                  </span>
                  {(e.s.items ?? []).length > 0 && <span className="parent-calendar__steps">{stepLine(e.s.items ?? [])}</span>}
                  {failed === e.s.id && <span className="parent-session__error" role="alert">{t("parent.startFailed")}</span>}
                </span>
                <span className="parent-calendar__status">
                  {e.s.startable ? (
                    <Button icon={<Play size={18} aria-hidden="true" />} onClick={() => void start(e.s.id)} loading={starting === e.s.id}>
                      {t("parent.startSession")}
                    </Button>
                  ) : (
                    dayTag(e.s.planned_date, e.s.location === "home")
                  )}
                </span>
              </li>
            ),
          )}
        </ul>
      )}
      {coming.length > SHOWN && (
        <Button variant="ghost" onClick={() => setAll(!all)}>{all ? t("parent.showFewer") : t("parent.showAll", { n: coming.length })}</Button>
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
