/**
 * One child in the parent portal (§5.10): every coming session with the game-based activities and videos in it,
 * the next home session ready to start, the appointments the clinic set, and what was done lately. A guardian
 * reaches only their own children; anything else shows "not found".
 */
import { Link, useParams } from "react-router";
import { useIntl } from "react-intl";
import { Card, EmptyState, MazeLoader, PageHeader } from "@emb/ui";
import { ArrowLeft, CalendarDays, Users } from "lucide-react";
import { useT } from "../../i18n/index.tsx";
import { useTitle } from "../../lib/title.ts";
import { useParentContext } from "./shell.tsx";
import { useChildAppointments, useChildSessions } from "../../api/parent.ts";
import { ParentSessionCard } from "./session.tsx";

export function ParentChildPage() {
  const t = useT();
  const intl = useIntl();
  const { id = "" } = useParams();
  const { children } = useParentContext();
  const child = children.find((c) => c.id === id);
  const sessions = useChildSessions(child ? id : "");
  const appointments = useChildAppointments(child ? id : "");
  useTitle(child ? `${child.given_name} ${child.family_name}` : t("parent.kids"));

  const back = (
    <Link to="/parent" className="parent-back">
      <ArrowLeft size={16} aria-hidden="true" className="parent-back__icon" />
      {t("parent.backToKids")}
    </Link>
  );

  if (!child) {
    return (
      <div className="app-page">
        {back}
        <EmptyState icon={<Users size={32} aria-hidden="true" />} title={t("parent.childNotFound")} />
      </div>
    );
  }

  const upcoming = sessions.data?.upcoming ?? [];
  const recent = sessions.data?.recent ?? [];
  const appts = appointments.data ?? [];
  const formatDate = (s: string) => intl.formatDate(new Date(s + "T00:00:00"), { weekday: "short", day: "numeric", month: "short" });
  const clock = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number) as [number, number];
    return intl.formatTime(new Date(2000, 0, 1, h, m), { hour: "numeric", minute: "2-digit" });
  };

  return (
    <div className="app-page">
      {back}
      <PageHeader title={<bdi>{child.given_name} {child.family_name}</bdi>} description={t("parent.childIntro")} />

      <Card as="section">
        <h2 className="app-cardtitle">{t("parent.sessionsTitle")}</h2>
        {sessions.isPending && <MazeLoader label={t("common.loading")} />}
        {sessions.isError && <p className="app-muted" role="alert">{t("parent.sessionsFailed")}</p>}
        {sessions.isSuccess && upcoming.length === 0 && <p className="app-muted">{t("parent.noSessions")}</p>}
        {upcoming.length > 0 && (
          <ul className="plainlist parent-sessions">
            {upcoming.map((s) => (
              <li key={s.id}><ParentSessionCard childId={id} session={s} /></li>
            ))}
          </ul>
        )}
      </Card>

      {appts.length > 0 && (
        <Card as="section">
          <h2 className="app-cardtitle">{t("parent.appointmentsTitle")}</h2>
          <ul className="plainlist parent-calendar">
            {appts.map((a) => (
              <li key={a.id} className="parent-calendar__item parent-calendar__item--appt">
                <span className="parent-calendar__date emb-tnum">{formatDate(a.date)}</span>
                <span className="parent-calendar__details">
                  <span className="parent-calendar__title">
                    <CalendarDays size={16} aria-hidden="true" />
                    <bdi>{a.title || t("parent.appointment")}</bdi>
                  </span>
                  <span className="app-muted">
                    <span className="emb-tnum" dir="ltr">{clock(a.start_time)} – {clock(a.end_time)}</span>
                    {" · "}
                    {t("parent.apptAt", { clinic: a.clinic_name })}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {recent.length > 0 && (
        <Card as="section">
          <h2 className="app-cardtitle">{t("parent.recentSessions")}</h2>
          <ul className="plainlist parent-calendar">
            {recent.map((s) => (
              <li key={s.id} className="parent-calendar__item parent-calendar__item--done">
                <span className="parent-calendar__date emb-tnum">{formatDate(s.planned_date)}</span>
                <span className="parent-calendar__details"><span><bdi>{s.assignment_name}</bdi></span></span>
                <span className="parent-calendar__status app-muted">{t("parent.sessionDone")}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
