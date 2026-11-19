/**
 * Calendar — day view of planned sessions (§5.13).
 * Clinic managers see all therapists with a filter; therapists see their own.
 */
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Download, MapPin, Pencil, Play, X } from "lucide-react";
import { Alert, Button, Card, Chip, EmptyState, MazeLoader, PageHeader, SelectField, TextField } from "@emb/ui";
import {
  useCalendarSessions,
  useCalendarTherapists,
  useReschedule,
  getExportUrl,
  type CalendarSession,
  type CalendarFilters,
} from "../api/calendar.ts";

import { useT } from "../i18n/index.tsx";
import { useClinic } from "../lib/clinic.tsx";
import { useTitle } from "../lib/title.ts";
import { useIntl } from "react-intl";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

export function CalendarPage() {
  const t = useT();
  const intl = useIntl();
  const clinic = useClinic();
  useTitle(t("calendar.title"));

  const [date, setDate] = useState(() => isoDate(new Date()));
  const [therapistFilter, setTherapistFilter] = useState("");
  const [rescheduleTarget, setRescheduleTarget] = useState<CalendarSession | null>(null);

  const clinicId = clinic.clinicId ?? "";

  const filters: CalendarFilters = {
    clinic: clinicId,
    from: date,
    to: date,
    ...(therapistFilter ? { therapist: therapistFilter } : {}),
  };

  const sessions = useCalendarSessions(filters);
  const therapists = useCalendarTherapists(clinicId);

  const prev = () => setDate((d) => addDays(d, -1));
  const next = () => setDate((d) => addDays(d, 1));
  const today = () => setDate(isoDate(new Date()));

  const dateObj = new Date(date + "T12:00:00Z");
  const isToday = date === isoDate(new Date());

  // Group sessions by time slot
  const grouped = groupByTime(sessions.data ?? []);

  return (
    <div className="app-page">
      <PageHeader title={t("calendar.title")} description={t("calendar.description")} />

      {/* Controls row */}
      <div className="calendar-controls">
        <div className="calendar-nav">
          <Button variant="ghost" icon={<ChevronLeft size={18} aria-hidden="true" />} onClick={prev} aria-label={t("calendar.prev")} />
          <button type="button" className="calendar-date" onClick={today}>
            {intl.formatDate(dateObj, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </button>
          <Button variant="ghost" icon={<ChevronRight size={18} aria-hidden="true" />} onClick={next} aria-label={t("calendar.next")} />
        </div>

        <div className="calendar-filters">
          {clinic.isManager && (therapists.data ?? []).length > 0 && (
            <SelectField
              label={t("calendar.therapist")}
              hideLabel
              name="therapist"
              value={therapistFilter}
              onChange={(e) => setTherapistFilter(e.target.value)}
            >
              <option value="">{t("calendar.allTherapists")}</option>
              {(therapists.data ?? []).map((th) => (
                <option key={th.id} value={th.id}>{th.full_name}</option>
              ))}
            </SelectField>
          )}
          <a
            href={getExportUrl(clinicId, date, addDays(date, 90))}
            className="emb-btn emb-btn--ghost"
            download
          >
            <Download size={18} aria-hidden="true" />
            <span>{t("calendar.export")}</span>
          </a>
        </div>
      </div>

      {/* Day view */}
      {sessions.isPending ? (
        <MazeLoader label={t("common.loading")} />
      ) : sessions.data?.length === 0 ? (
        <Card>
          <EmptyState icon={<CalendarDays size={32} aria-hidden="true" />} title={t("calendar.empty")}>
            {isToday ? t("calendar.emptyToday") : t("calendar.emptyDay")}
          </EmptyState>
        </Card>
      ) : (
        <div className="calendar-day">
          {grouped.map(([label, items]) => (
            <div key={label} className="calendar-slot">
              <div className="calendar-slot__time">{label}</div>
              <div className="calendar-slot__sessions">
                {items.map((s) => (
                  <SessionCard
                    key={s.id}
                    session={s}
                    showTherapist={clinic.isManager}
                    onReschedule={() => setRescheduleTarget(s)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reschedule dialog */}
      {rescheduleTarget && (
        <RescheduleDialog
          session={rescheduleTarget}
          onClose={() => setRescheduleTarget(null)}
        />
      )}
    </div>
  );
}

function SessionCard({
  session: s,
  showTherapist,
  onReschedule,
}: {
  session: CalendarSession;
  showTherapist: boolean;
  onReschedule: () => void;
}) {
  const t = useT();

  return (
    <Card className="calendar-session">
      <div className="calendar-session__header">
        <span className="calendar-session__patient">
          <Link to={`/patients/${s.patient_id}`} className="app-textlink">
            <bdi>{s.patient_family_name}, {s.patient_given_name}</bdi>
          </Link>
        </span>
        <Chip tone={s.location === "home" ? "brand" : "neutral"}>
          <MapPin size={12} aria-hidden="true" /> {s.location === "home" ? t("calendar.home") : t("calendar.clinic")}
        </Chip>
      </div>
      <p className="calendar-session__info">
        {s.assignment_name} · {t("calendar.sessionLabel", { seq: s.seq, week: s.week })}
        {showTherapist && s.therapist_name && (
          <> · <bdi>{s.therapist_name}</bdi></>
        )}
      </p>
      <div className="calendar-session__actions">
        {s.status === "planned" && (
          <Link to={`/session/${s.id}`} className="emb-btn emb-btn--secondary">
            <Play size={14} aria-hidden="true" /> {t("calendar.start")}
          </Link>
        )}
        <Button variant="ghost" icon={<Pencil size={14} aria-hidden="true" />} onClick={onReschedule}>
          {t("calendar.reschedule")}
        </Button>
      </div>
    </Card>
  );
}

function RescheduleDialog({ session, onClose }: { session: CalendarSession; onClose: () => void }) {
  const t = useT();
  const reschedule = useReschedule();
  const [newDate, setNewDate] = useState(session.planned_date);
  const [newTime, setNewTime] = useState(session.planned_time ?? "");
  const [shiftSubsequent, setShiftSubsequent] = useState(true);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!newDate) return;
    try {
      await reschedule.mutateAsync({
        sessionId: session.id,
        planned_date: newDate,
        planned_time: newTime || null,
        shift_subsequent: shiftSubsequent,
      });
      onClose();
    } catch {
      setError(t("calendar.rescheduleFailed"));
    }
  };

  return (
    <div className="calendar-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <Card className="calendar-dialog">
        <div className="calendar-dialog__header">
          <h3>{t("calendar.rescheduleTitle")}</h3>
          <Button variant="ghost" icon={<X size={18} />} onClick={onClose} aria-label={t("common.cancel")} />
        </div>
        <p className="app-muted">
          <bdi>{session.patient_family_name}, {session.patient_given_name}</bdi> — {session.assignment_name}
        </p>
        <form onSubmit={(e) => void submit(e)} className="pform">
          {error && <Alert tone="danger">{error}</Alert>}
          <TextField
            label={t("calendar.newDate")}
            type="date"
            name="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
          />
          <TextField
            label={t("calendar.newTime")}
            type="time"
            name="time"
            value={newTime}
            onChange={(e) => setNewTime(e.target.value)}
          />
          <label className="calendar-dialog__shift">
            <input
              type="checkbox"
              checked={shiftSubsequent}
              onChange={(e) => setShiftSubsequent(e.target.checked)}
            />
            {t("calendar.shiftSubsequent")}
          </label>
          <div className="pform__actions">
            <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
            <Button type="submit" loading={reschedule.isPending}>{t("calendar.confirmReschedule")}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

/** Group sessions by time slot: "09:00", "10:30", or "Unscheduled" for sessions without a time. */
function groupByTime(sessions: CalendarSession[]): Array<[string, CalendarSession[]]> {
  const groups = new Map<string, CalendarSession[]>();
  for (const s of sessions) {
    const key = s.planned_time ? s.planned_time.slice(0, 5) : "—";
    const list = groups.get(key) ?? [];
    list.push(s);
    groups.set(key, list);
  }
  // Sort by time, with unscheduled ("—") last
  return [...groups.entries()].sort(([a], [b]) => {
    if (a === "—") return 1;
    if (b === "—") return -1;
    return a.localeCompare(b);
  });
}
