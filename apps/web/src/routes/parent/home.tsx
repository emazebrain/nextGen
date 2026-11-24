/** Parent kids page — list of children with upcoming sessions (§5.10). */
import { useState } from "react";
import { useNavigate } from "react-router";
import { useIntl } from "react-intl";
import { Button, Card, Chip, EmptyState, MazeLoader, PageHeader } from "@emb/ui";
import { Play, Users } from "lucide-react";
import { useT, type MessageId } from "../../i18n/index.tsx";
import { useTitle } from "../../lib/title.ts";
import { useParentContext } from "./shell.tsx";
import { useChildSessions, useLaunchHomeSession, type HomePlannedSession } from "../../api/parent.ts";

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
        <ChildCard key={child.id} childId={child.id} name={`${child.given_name} ${child.family_name}`} clinicName={new Set(children.map((c) => c.clinic_name)).size > 1 ? child.clinic_name : ""} />
      ))}
    </div>
  );
}

function ChildCard({ childId, name, clinicName }: { childId: string; name: string; clinicName: string }) {
  const t = useT();
  const intl = useIntl();
  const navigate = useNavigate();
  const sessions = useChildSessions(childId);
  const launch = useLaunchHomeSession(childId);
  const [launching, setLaunching] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const date = (s: string) => intl.formatDate(new Date(s + "T00:00:00"), { day: "numeric", month: "short" });

  const handleLaunch = async (sessionId: string) => {
    setLaunching(sessionId);
    try {
      const result = await launch.mutateAsync(sessionId);
      navigate(`/session/${sessionId}`, { state: { launch: result.launch, fromParent: true } });
    } catch {
      setLaunching(null);
    }
  };

  const upcoming = sessions.data?.upcoming ?? [];
  const readySessions = upcoming.filter((s) => s.planned_date <= today);
  const nextSession = upcoming.find((s) => s.planned_date > today);

  return (
    <Card as="section">
      <div className="parent-kid">
        <div className="parent-kid__header">
          <h2 className="parent-kid__name"><bdi>{name}</bdi></h2>
          {clinicName && <span className="app-muted">{clinicName}</span>}
        </div>

        {sessions.isPending && <MazeLoader label={t("common.loading")} />}

        {readySessions.length > 0 && (
          <div className="parent-kid__sessions">
            {readySessions.map((s) => (
              <div key={s.id} className="parent-session">
                <div className="parent-session__info">
                  <span className="parent-session__name"><bdi>{s.assignment_name}</bdi></span>
                  <span className="parent-session__meta app-muted">
                    {t("parent.sessionMeta", { seq: s.seq, total: s.total ?? 0, week: s.week })}
                    {s.planned_date < today ? <Chip tone="warning">{t("parent.overdue")}</Chip> : <Chip tone="neutral">{t("parent.dueToday")}</Chip>}
                  </span>
                </div>
                <Button
                  icon={<Play size={18} aria-hidden="true" />}
                  onClick={() => void handleLaunch(s.id)}
                  loading={launching === s.id}
                >
                  {t("parent.startSession")}
                </Button>
              </div>
            ))}
          </div>
        )}

        {readySessions.length === 0 && nextSession && (
          <p className="app-muted">
            {t("parent.nextSessionOn", { date: date(nextSession.planned_date) })}
          </p>
        )}

        {readySessions.length === 0 && !nextSession && !sessions.isPending && (
          <p className="app-muted">{t("parent.noSessionHint")}</p>
        )}
      </div>
    </Card>
  );
}
