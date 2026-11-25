/**
 * One coming session in the parent portal: when it is, what it includes, and — for the home session that is next
 * in line — a Start button. A guardian only ever starts their own child's home sessions, in order; the server
 * enforces both. Clinic sessions and later sessions are shown so the family knows what is coming, without Start.
 */
import { useState } from "react";
import { useNavigate } from "react-router";
import { useIntl } from "react-intl";
import { Button, Chip } from "@emb/ui";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import { useT } from "../../i18n/index.tsx";
import { useLaunchHomeSession, type HomePlannedSession } from "../../api/parent.ts";
import { SessionItems } from "../sessionItems.tsx";

/** Today in the family's own time zone ("YYYY-MM-DD"), not UTC: before 02:00 in Israel the two differ. */
export const localToday = () => new Date().toLocaleDateString("en-CA");

/** Start a home session and open the player. */
export function useStartHomeSession(childId: string) {
  const navigate = useNavigate();
  const launch = useLaunchHomeSession(childId);
  const [starting, setStarting] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const start = async (sessionId: string) => {
    setStarting(sessionId);
    setFailed(null);
    try {
      const result = await launch.mutateAsync(sessionId);
      navigate(`/session/${sessionId}`, { state: { launch: result.launch, fromParent: true } });
    } catch {
      setStarting(null);
      setFailed(sessionId);
    }
  };
  return { start, starting, failed };
}

export function ParentSessionCard({ childId, session: s, showItems = true }: { childId: string; session: HomePlannedSession; showItems?: boolean }) {
  const t = useT();
  const intl = useIntl();
  const { start, starting, failed } = useStartHomeSession(childId);
  const today = localToday();
  const either = s.setting === "mixed";
  const atClinic = s.location !== "home" && !either;
  const date = intl.formatDate(new Date(s.planned_date + "T00:00:00"), { weekday: "short", day: "numeric", month: "short" });

  return (
    <div className={`parent-session parent-session--card${s.startable ? " parent-session--ready" : ""}`}>
      <div className="parent-session__top">
        <div className="parent-session__info">
          <span className="parent-session__name"><bdi>{s.assignment_name}</bdi></span>
          <span className="parent-session__meta app-muted">
            {t(either ? "parent.eitherSession" : atClinic ? "parent.clinicSession" : "parent.homeSession")} · {t("parent.sessionMeta", { seq: s.seq, total: s.total ?? 0, week: s.week })}
          </span>
          <span className="parent-session__meta">
            <span className="emb-tnum">{t("parent.plannedFor", { date })}</span>
            {s.planned_date < today && !atClinic && <Chip tone="warning">{t("parent.overdue")}</Chip>}
            {s.planned_date === today && <Chip tone="neutral">{t("parent.today")}</Chip>}
          </span>
        </div>
        {s.startable && (
          <Button icon={<Play size={18} aria-hidden="true" />} onClick={() => void start(s.id)} loading={starting === s.id}>
            {t("parent.startSession")}
          </Button>
        )}
      </div>
      {failed === s.id && <p className="parent-session__error" role="alert">{t("parent.startFailed")}</p>}
      {showItems && <SessionItems items={s.items ?? []} label={t("parent.inSession")} />}
      {!s.startable && <p className="parent-session__note app-muted">{t(atClinic ? "parent.clinicOnlyHint" : "parent.opensAfter")}</p>}
    </div>
  );
}

/**
 * One session at a time, with arrows to look ahead: a protocol can have dozens of sessions, and only one matters
 * today. Opens on the session that can be started (or the first coming one when none can).
 */
export function ParentSessionPager({ childId, sessions }: { childId: string; sessions: HomePlannedSession[] }) {
  const t = useT();
  const home = Math.max(0, sessions.findIndex((s) => s.startable));
  const [picked, setPicked] = useState<string | null>(null);
  const found = picked ? sessions.findIndex((s) => s.id === picked) : -1;
  const i = found >= 0 ? found : home;
  const s = sessions[i];
  if (!s) return null;
  return (
    <div className="session-pager">
      <ParentSessionCard childId={childId} session={s} />
      {sessions.length > 1 && (
        <div className="session-pager__nav">
          <Button variant="secondary" icon={<ChevronLeft size={18} aria-hidden="true" className="session-pager__arrow" />} aria-label={t("parent.prevSession")} disabled={i === 0} onClick={() => setPicked(sessions[i - 1]!.id)} />
          <span className="session-pager__count emb-tnum" aria-live="polite">{t("parent.sessionOf", { n: i + 1, total: sessions.length })}</span>
          <Button variant="secondary" icon={<ChevronRight size={18} aria-hidden="true" className="session-pager__arrow" />} aria-label={t("parent.nextSession")} disabled={i === sessions.length - 1} onClick={() => setPicked(sessions[i + 1]!.id)} />
          {i !== home && (
            <Button variant="ghost" onClick={() => setPicked(null)}>{t("parent.backToNext")}</Button>
          )}
        </div>
      )}
    </div>
  );
}
