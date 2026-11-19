/**
 * Calendar — Google Calendar-style day view with time grid (§5.13).
 * Managers see all therapists with a filter; therapists see their own.
 * Click a time slot to create an appointment; click an event to reschedule.
 */
import { useState, useRef, useEffect, type FormEvent } from "react";
import { Link } from "react-router";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Download, MapPin, Pencil, Play, Plus, X } from "lucide-react";
import { Alert, Button, Card, Chip, MazeLoader, PageHeader, SelectField, TextField } from "@emb/ui";
import {
  useCalendarEvents,
  useCalendarTherapists,
  useReschedule,
  useCreateAppointment,
  searchCalendarPatients,
  getExportUrl,
  type CalendarEvent,
  type CalendarFilters,
  type CalendarPatient,
} from "../api/calendar.ts";
import { useT } from "../i18n/index.tsx";
import { useClinic } from "../lib/clinic.tsx";
import { useTitle } from "../lib/title.ts";
import { useIntl } from "react-intl";

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

const HOURS = Array.from({ length: 14 }, (_, i) => i + 7); // 07:00 – 20:00

export function CalendarPage() {
  const t = useT();
  const intl = useIntl();
  const clinic = useClinic();
  useTitle(t("calendar.title"));

  const clinicId = clinic.clinicId ?? "";
  const [date, setDate] = useState(() => isoDate(new Date()));
  const [therapistFilter, setTherapistFilter] = useState("");
  const [rescheduleTarget, setRescheduleTarget] = useState<CalendarEvent | null>(null);
  const [newApptSlot, setNewApptSlot] = useState<{ date: string; hour: number } | null>(null);

  const filters: CalendarFilters = {
    clinic: clinicId,
    from: date,
    to: date,
    ...(therapistFilter ? { therapist: therapistFilter } : {}),
  };

  const events = useCalendarEvents(filters);
  const therapists = useCalendarTherapists(clinicId);

  const prev = () => setDate((d) => addDays(d, -1));
  const next = () => setDate((d) => addDays(d, 1));
  const today = () => setDate(isoDate(new Date()));

  const dateObj = new Date(date + "T12:00:00Z");
  const isToday = date === isoDate(new Date());

  // Map events to their hour slot
  const eventsByHour = new Map<number, CalendarEvent[]>();
  for (const ev of events.data ?? []) {
    const hour = ev.start_time ? parseInt(ev.start_time.slice(0, 2), 10) : -1;
    const list = eventsByHour.get(hour) ?? [];
    list.push(ev);
    eventsByHour.set(hour, list);
  }
  // Events without a time
  const unscheduled = eventsByHour.get(-1) ?? [];

  return (
    <div className="app-page">
      <PageHeader title={t("calendar.title")} />

      {/* Top bar */}
      <div className="cal-toolbar">
        <div className="cal-toolbar__nav">
          <Button variant="ghost" icon={<ChevronLeft size={18} />} onClick={prev} aria-label={t("calendar.prev")} />
          <button type="button" className={`cal-toolbar__date ${isToday ? "cal-toolbar__date--today" : ""}`} onClick={today}>
            {intl.formatDate(dateObj, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </button>
          <Button variant="ghost" icon={<ChevronRight size={18} />} onClick={next} aria-label={t("calendar.next")} />
          {!isToday && (
            <Button variant="secondary" onClick={today}>{t("calendar.today")}</Button>
          )}
        </div>
        <div className="cal-toolbar__actions">
          {clinic.isManager && (therapists.data ?? []).length > 0 && (
            <SelectField label={t("calendar.therapist")} hideLabel name="therapist" value={therapistFilter} onChange={(e) => setTherapistFilter(e.target.value)}>
              <option value="">{t("calendar.allTherapists")}</option>
              {(therapists.data ?? []).map((th) => (
                <option key={th.id} value={th.id}>{th.full_name}</option>
              ))}
            </SelectField>
          )}
          <Button variant="secondary" icon={<Plus size={18} />} onClick={() => setNewApptSlot({ date, hour: 9 })}>
            {t("calendar.newAppt")}
          </Button>
          <a href={getExportUrl(clinicId, date, addDays(date, 90))} className="emb-btn emb-btn--ghost" download>
            <Download size={18} /> <span>{t("calendar.export")}</span>
          </a>
        </div>
      </div>

      {events.isPending ? (
        <MazeLoader label={t("common.loading")} />
      ) : (
        <>
          {/* Unscheduled events */}
          {unscheduled.length > 0 && (
            <div className="cal-unscheduled">
              <span className="cal-unscheduled__label">{t("calendar.unscheduled")}</span>
              <div className="cal-unscheduled__items">
                {unscheduled.map((ev) => (
                  <EventChip key={ev.id} event={ev} showTherapist={clinic.isManager} onEdit={() => setRescheduleTarget(ev)} />
                ))}
              </div>
            </div>
          )}

          {/* Time grid */}
          <div className="cal-grid">
            {HOURS.map((hour) => {
              const hourEvents = eventsByHour.get(hour) ?? [];
              const timeLabel = `${String(hour).padStart(2, "0")}:00`;
              return (
                <div key={hour} className="cal-row" onClick={() => setNewApptSlot({ date, hour })}>
                  <div className="cal-row__time">{timeLabel}</div>
                  <div className={`cal-row__slot ${hourEvents.length > 0 ? "cal-row__slot--has-events" : ""}`}>
                    {hourEvents.map((ev) => (
                      <EventCard key={ev.id} event={ev} showTherapist={clinic.isManager} onEdit={() => setRescheduleTarget(ev)} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* New appointment dialog */}
      {newApptSlot && (
        <NewAppointmentDialog
          clinicId={clinicId}
          date={newApptSlot.date}
          hour={newApptSlot.hour}
          onClose={() => setNewApptSlot(null)}
        />
      )}

      {/* Reschedule dialog */}
      {rescheduleTarget && (
        <RescheduleDialog
          event={rescheduleTarget}
          onClose={() => setRescheduleTarget(null)}
        />
      )}
    </div>
  );
}

function EventCard({ event: ev, showTherapist, onEdit }: { event: CalendarEvent; showTherapist: boolean; onEdit: () => void }) {
  const t = useT();
  const isAppt = ev.kind === "appointment";
  const timeRange = ev.start_time && ev.end_time
    ? `${ev.start_time.slice(0, 5)} – ${ev.end_time.slice(0, 5)}`
    : ev.start_time
      ? ev.start_time.slice(0, 5)
      : "";

  return (
    <div className={`cal-event cal-event--${ev.kind}`} onClick={(e) => { e.stopPropagation(); onEdit(); }}>
      <div className="cal-event__header">
        <span className="cal-event__patient">
          <bdi>{ev.patient_family_name}, {ev.patient_given_name}</bdi>
        </span>
        {timeRange && <span className="cal-event__time">{timeRange}</span>}
      </div>
      <div className="cal-event__detail">
        {isAppt
          ? (ev.title || t("calendar.appointment"))
          : `${ev.assignment_name} · ${t("calendar.sessionLabel", { seq: ev.seq, week: ev.week })}`
        }
        {showTherapist && ev.therapist_name && <> · <bdi>{ev.therapist_name}</bdi></>}
      </div>
      {!isAppt && ev.status === "planned" && (
        <Link to={`/session/${ev.id}`} className="cal-event__start" onClick={(e) => e.stopPropagation()}>
          <Play size={12} /> {t("calendar.start")}
        </Link>
      )}
    </div>
  );
}

function EventChip({ event: ev, showTherapist, onEdit }: { event: CalendarEvent; showTherapist: boolean; onEdit: () => void }) {
  const t = useT();
  return (
    <button type="button" className="cal-chip" onClick={onEdit}>
      <bdi>{ev.patient_given_name} {ev.patient_family_name}</bdi>
      <span className="cal-chip__label">
        {ev.kind === "appointment" ? (ev.title || t("calendar.appointment")) : ev.assignment_name}
      </span>
      {showTherapist && ev.therapist_name && <span className="cal-chip__therapist">{ev.therapist_name}</span>}
    </button>
  );
}

function NewAppointmentDialog({ clinicId, date, hour, onClose }: { clinicId: string; date: string; hour: number; onClose: () => void }) {
  const t = useT();
  const create = useCreateAppointment();
  const [title, setTitle] = useState("");
  const [patientSearch, setPatientSearch] = useState("");
  const [patients, setPatients] = useState<CalendarPatient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<CalendarPatient | null>(null);
  const [startTime, setStartTime] = useState(`${String(hour).padStart(2, "0")}:00`);
  const [endTime, setEndTime] = useState(`${String(hour + 1).padStart(2, "0")}:00`);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const onPatientSearch = (q: string) => {
    setPatientSearch(q);
    setSelectedPatient(null);
    clearTimeout(searchTimer.current);
    if (q.length < 2) { setPatients([]); return; }
    searchTimer.current = setTimeout(() => {
      void searchCalendarPatients(clinicId, q).then(setPatients).catch(() => {});
    }, 300);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedPatient) { setError(t("calendar.selectPatient")); return; }
    if (startTime >= endTime) { setError(t("calendar.invalidTime")); return; }
    try {
      await create.mutateAsync({
        patient_id: selectedPatient.id,
        title: title || undefined,
        notes: notes || undefined,
        date,
        start_time: startTime,
        end_time: endTime,
      });
      onClose();
    } catch {
      setError(t("calendar.createFailed"));
    }
  };

  return (
    <div className="calendar-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <Card className="calendar-dialog">
        <div className="calendar-dialog__header">
          <h3>{t("calendar.newApptTitle")}</h3>
          <Button variant="ghost" icon={<X size={18} />} onClick={onClose} aria-label={t("common.cancel")} />
        </div>
        <form onSubmit={(e) => void submit(e)} className="pform">
          {error && <Alert tone="danger">{error}</Alert>}

          {/* Patient search */}
          <div className="cal-patient-search">
            <TextField
              label={t("calendar.patient")}
              value={selectedPatient ? `${selectedPatient.family_name}, ${selectedPatient.given_name}` : patientSearch}
              onChange={(e) => onPatientSearch(e.target.value)}
              autoComplete="off"
              placeholder={t("calendar.searchPatient")}
            />
            {patients.length > 0 && !selectedPatient && (
              <ul className="cal-patient-results">
                {patients.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="cal-patient-option" onClick={() => { setSelectedPatient(p); setPatients([]); }}>
                      <bdi>{p.family_name}, {p.given_name}</bdi>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <TextField label={t("calendar.apptTitle")} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("calendar.apptTitleHint")} />

          <div className="pform__row">
            <TextField label={t("calendar.newDate")} type="date" value={date} disabled />
            <TextField label={t("calendar.startTime")} type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            <TextField label={t("calendar.endTime")} type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>

          <TextField label={t("calendar.notes")} value={notes} onChange={(e) => setNotes(e.target.value)} />

          <div className="pform__actions">
            <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
            <Button type="submit" loading={create.isPending}>{t("calendar.createAppt")}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function RescheduleDialog({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  const t = useT();
  const reschedule = useReschedule();
  const [newDate, setNewDate] = useState(event.date);
  const [newTime, setNewTime] = useState(event.start_time?.slice(0, 5) ?? "");
  const [shiftSubsequent, setShiftSubsequent] = useState(true);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!newDate) return;
    try {
      if (event.kind === "session") {
        await reschedule.mutateAsync({
          sessionId: event.id,
          planned_date: newDate,
          planned_time: newTime || null,
          shift_subsequent: shiftSubsequent,
        });
      } else {
        const { updateAppointment } = await import("../api/calendar.ts");
        const patch: Record<string, string> = { date: newDate };
        const st = newTime || event.start_time?.slice(0, 5);
        const et = event.end_time?.slice(0, 5);
        if (st) patch.start_time = st;
        if (et) patch.end_time = et;
        await updateAppointment(event.id, patch);
      }
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
          <bdi>{event.patient_family_name}, {event.patient_given_name}</bdi>
          {event.kind === "session" && <> — {event.assignment_name}</>}
        </p>
        <form onSubmit={(e) => void submit(e)} className="pform">
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="pform__row">
            <TextField label={t("calendar.newDate")} type="date" name="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
            <TextField label={t("calendar.newTime")} type="time" name="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
          </div>
          {event.kind === "session" && (
            <label className="calendar-dialog__shift">
              <input type="checkbox" checked={shiftSubsequent} onChange={(e) => setShiftSubsequent(e.target.checked)} />
              {t("calendar.shiftSubsequent")}
            </label>
          )}
          <div className="pform__actions">
            <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
            <Button type="submit" loading={reschedule.isPending}>{t("calendar.confirmReschedule")}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
