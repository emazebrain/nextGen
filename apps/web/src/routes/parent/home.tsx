/** Parent kids page — list of children with upcoming sessions (§5.10). */
import { Link } from "react-router";
import { useIntl } from "react-intl";
import { Card, EmptyState, MazeLoader, PageHeader } from "@emb/ui";
import { CalendarDays, ChevronRight, Users } from "lucide-react";
import { useT } from "../../i18n/index.tsx";
import { useTitle } from "../../lib/title.ts";
import { useParentContext } from "./shell.tsx";
import { useChildAppointments, useChildSessions } from "../../api/parent.ts";
import { ParentSessionCard } from "./session.tsx";
import { TherapistOf } from "../shared.tsx";

export function ParentHomePage() {
  const t = useT();
  const { children } = useParentContext();
  useTitle(t("parent.kids"));

  if (children.length === 0) {
    return (
      <div className="app-page">
        <EmptyState icon={<Users size={32} aria-hidden="true" />} title={t("parent.noChildren")}>
          {t("parent.noChildrenHint")}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="app-page">
      <PageHeader title={t("parent.kidsTitle")} description={t("parent.kidsIntro")} />
      {children.map((child) => (
        // With one clinic for every child the header already names it.
        <ChildCard key={child.id} childId={child.id} name={`${child.given_name} ${child.family_name}`} givenName={child.given_name} therapists={child.therapists} clinicName={new Set(children.map((c) => c.clinic_name)).size > 1 ? child.clinic_name : ""} />
      ))}
    </div>
  );
}

function ChildCard({ childId, name, givenName, clinicName, therapists }: { childId: string; name: string; givenName: string; clinicName: string; therapists?: string[] | undefined }) {
  const t = useT();
  const intl = useIntl();
  const sessions = useChildSessions(childId);
  const appointments = useChildAppointments(childId);

  const upcoming = sessions.data?.upcoming ?? [];
  // What can be started now: the next home session in line for each protocol, whatever day it was planned for.
  const ready = upcoming.filter((s) => s.startable);
  const next = upcoming[0];
  const date = (s: string) => intl.formatDate(new Date(s + "T00:00:00"), { weekday: "short", day: "numeric", month: "short" });
  const appt = appointments.data?.[0];
  const clock = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number) as [number, number];
    return intl.formatTime(new Date(2000, 0, 1, h, m), { hour: "numeric", minute: "2-digit" });
  };

  return (
    <Card as="section">
      <div className="parent-kid">
        <div className="parent-kid__header">
          <h2 className="parent-kid__name">
            <Link to={`/parent/children/${childId}`} className="parent-kid__link"><bdi>{name}</bdi></Link>
          </h2>
          {clinicName && <span className="app-muted">{clinicName}</span>}
          <TherapistOf names={therapists} />
        </div>

        {sessions.isPending && <MazeLoader label={t("common.loading")} />}
        {sessions.isError && <p className="app-muted" role="alert">{t("parent.sessionsFailed")}</p>}

        {ready.length > 0 && (
          <ul className="plainlist parent-kid__sessions">
            {ready.map((s) => (
              <li key={s.id}><ParentSessionCard childId={childId} session={s} /></li>
            ))}
          </ul>
        )}

        {/* Nothing to start right now: the next session is still shown, with the reason it has no Start. */}
        {ready.length === 0 && next && <ParentSessionCard childId={childId} session={next} />}
        {ready.length === 0 && !next && sessions.isSuccess && <p className="app-muted">{t("parent.noProgram")}</p>}
        {appt && <p className="parent-kid__appt"><CalendarDays size={16} aria-hidden="true" /> {t("parent.nextAppointment", { date: date(appt.date), time: clock(appt.start_time) })}</p>}

        <Link to={`/parent/children/${childId}`} className="parent-kid__all">
          {t("parent.seeAll", { name: givenName })}
          <ChevronRight size={16} aria-hidden="true" className="parent-kid__chev" />
        </Link>
      </div>
    </Card>
  );
}
