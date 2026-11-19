/**
 * Calendar — day / week / month views with time grid (§5.13).
 * Managers see all therapists with a filter; therapists see their own.
 * Click a time slot to create an appointment; click an event to reschedule.
 */
import { useState, useRef, useMemo, type FormEvent } from "react";
import { Link } from "react-router";
import { ChevronLeft, ChevronRight, Download, Pencil, Play, Plus, X } from "lucide-react";
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

// ---- Date helpers

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

function startOfWeek(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  const day = d.getUTCDay(); // 0=Sun
  d.setUTCDate(d.getUTCDate() - day);
  return isoDate(d);
}

function startOfMonth(iso: string): string { return iso.slice(0, 8) + "01"; }

function endOfMonth(iso: string): string {
  const d = new Date(iso.slice(0, 7) + "-01T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return isoDate(d);
}

function daysInRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  while (cur <= to) { out.push(cur); cur = addDays(cur, 1); }
  return out;
}

type ViewMode = "day" | "week" | "month";

const HOURS = Array.from({ length: 14 }, (_, i) => i + 7); // 07:00–20:00

export function CalendarPage() {
  const t = useT();
  const intl = useIntl();
  const clinic = useClinic();
  useTitle(t("calendar.title"));

  const clinicId = clinic.clinicId ?? "";
  const [date, setDate] = useState(() => isoDate(new Date()));
  const [view, setView] = useState<ViewMode>("day");
  const [therapistFilter, setTherapistFilter] = useState("");
  const [rescheduleTarget, setRescheduleTarget] = useState<CalendarEvent | null>(null);
  const [newApptSlot, setNewApptSlot] = useState<{ date: string; hour: number } | null>(null);

  // Compute date range for the current view
  const { from, to } = useMemo(() => {
    if (view === "day") return { from: date, to: date };
    if (view === "week") { const s = startOfWeek(date); return { from: s, to: addDays(s, 6) }; }
    return { from: startOfMonth(date), to: endOfMonth(date) };
  }, [date, view]);

  const filters: CalendarFilters = {
    clinic: clinicId,
    from,
    to,
    ...(therapistFilter ? { therapist: therapistFilter } : {}),
  };

  const events = useCalendarEvents(filters);
  const therapists = useCalendarTherapists(clinicId);

  const navigate = (n: number) => {
    if (view === "day") setDate((d) => addDays(d, n));
    else if (view === "week") setDate((d) => addDays(d, n * 7));
    else {
      setDate((d) => {
        const dt = new Date(d + "T12:00:00Z");
        dt.setUTCMonth(dt.getUTCMonth() + n);
        return isoDate(dt);
      });
    }
  };

  const goToday = () => setDate(isoDate(new Date()));
  const isToday = date === isoDate(new Date());
  const dateObj = new Date(date + "T12:00:00Z");

  // Format the header label
  const headerLabel = view === "day"
    ? intl.formatDate(dateObj, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : view === "week"
      ? `${intl.formatDate(new Date(from + "T12:00:00Z"), { day: "numeric", month: "short" })} – ${intl.formatDate(new Date(to + "T12:00:00Z"), { day: "numeric", month: "short", year: "numeric" })}`
      : intl.formatDate(dateObj, { month: "long", year: "numeric" });

  return (
    <div className="app-page">
      <PageHeader title={t("calendar.title")} />

      {/* Toolbar */}
      <div className="cal-toolbar">
        <div className="cal-toolbar__nav">
          <Button variant="ghost" icon={<ChevronLeft size={18} />} onClick={() => navigate(-1)} aria-label={t("calendar.prev")} />
          <button type="button" className={`cal-toolbar__date ${isToday ? "cal-toolbar__date--today" : ""}`} onClick={goToday}>
            {headerLabel}
          </button>
          <Button variant="ghost" icon={<ChevronRight size={18} />} onClick={() => navigate(1)} aria-label={t("calendar.next")} />
          {!isToday && <Button variant="secondary" onClick={goToday}>{t("calendar.today")}</Button>}
        </div>
        <div className="cal-toolbar__actions">
          {/* View switcher */}
          <div className="cal-view-switcher" role="group" aria-label={t("calendar.viewLabel")}>
            {(["day", "week", "month"] as ViewMode[]).map((v) => (
              <button key={v} type="button" className={`cal-view-btn ${v === view ? "cal-view-btn--active" : ""}`} onClick={() => setView(v)}>
                {t(`calendar.view.${v}`)}
              </button>
            ))}
          </div>
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
          <a href={getExportUrl(clinicId, from, to)} className="emb-btn emb-btn--ghost" download>
            <Download size={18} /> <span>{t("calendar.export")}</span>
          </a>
        </div>
      </div>

      {events.isPending ? (
        <MazeLoader label={t("common.loading")} />
      ) : view === "day" ? (
        <DayView events={events.data ?? []} date={date} isManager={clinic.isManager} onNewAppt={(h) => setNewApptSlot({ date, hour: h })} onEdit={setRescheduleTarget} />
      ) : view === "week" ? (
        <WeekView events={events.data ?? []} from={from} isManager={clinic.isManager} onNewAppt={(d, h) => setNewApptSlot({ date: d, hour: h })} onEdit={setRescheduleTarget} />
      ) : (
        <MonthView events={events.data ?? []} date={date} isManager={clinic.isManager} onDayClick={(d) => { setDate(d); setView("day"); }} />
      )}

      {newApptSlot && <NewAppointmentDialog clinicId={clinicId} date={newApptSlot.date} hour={newApptSlot.hour} onClose={() => setNewApptSlot(null)} />}
      {rescheduleTarget && <RescheduleDialog event={rescheduleTarget} onClose={() => setRescheduleTarget(null)} />}
    </div>
  );
}

// ---- Day View (time grid)

function DayView({ events, date, isManager, onNewAppt, onEdit }: { events: CalendarEvent[]; date: string; isManager: boolean; onNewAppt: (h: number) => void; onEdit: (ev: CalendarEvent) => void }) {
  const t = useT();
  const eventsByHour = new Map<number, CalendarEvent[]>();
  for (const ev of events) {
    const hour = ev.start_time ? parseInt(ev.start_time.slice(0, 2), 10) : -1;
    const list = eventsByHour.get(hour) ?? [];
    list.push(ev);
    eventsByHour.set(hour, list);
  }
  const unscheduled = eventsByHour.get(-1) ?? [];

  return (
    <>
      {unscheduled.length > 0 && (
        <div className="cal-unscheduled">
          <span className="cal-unscheduled__label">{t("calendar.unscheduled")}</span>
          <div className="cal-unscheduled__items">
            {unscheduled.map((ev) => <EventChip key={ev.id} event={ev} showTherapist={isManager} onEdit={() => onEdit(ev)} />)}
          </div>
        </div>
      )}
      <div className="cal-grid">
        {HOURS.map((hour) => {
          const hourEvents = eventsByHour.get(hour) ?? [];
          return (
            <div key={hour} className="cal-row" onClick={() => onNewAppt(hour)}>
              <div className="cal-row__time">{`${String(hour).padStart(2, "0")}:00`}</div>
              <div className="cal-row__slot">
                {hourEvents.map((ev) => <EventCard key={ev.id} event={ev} showTherapist={isManager} onEdit={() => onEdit(ev)} />)}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---- Week View (7 columns × time grid)

function WeekView({ events, from, isManager, onNewAppt, onEdit }: { events: CalendarEvent[]; from: string; isManager: boolean; onNewAppt: (d: string, h: number) => void; onEdit: (ev: CalendarEvent) => void }) {
  const t = useT();
  const intl = useIntl();
  const days = useMemo(() => daysInRange(from, addDays(from, 6)), [from]);
  const todayIso = isoDate(new Date());

  // Group events by date + hour
  const byDateHour = new Map<string, CalendarEvent[]>();
  for (const ev of events) {
    const hour = ev.start_time ? parseInt(ev.start_time.slice(0, 2), 10) : -1;
    const key = `${ev.date}:${hour}`;
    const list = byDateHour.get(key) ?? [];
    list.push(ev);
    byDateHour.set(key, list);
  }

  return (
    <div className="cal-week">
      {/* Column headers */}
      <div className="cal-week__header">
        <div className="cal-week__time-col" />
        {days.map((d) => {
          const dt = new Date(d + "T12:00:00Z");
          return (
            <div key={d} className={`cal-week__day-header ${d === todayIso ? "cal-week__day-header--today" : ""}`}>
              <span className="cal-week__day-name">{intl.formatDate(dt, { weekday: "short" })}</span>
              <span className="cal-week__day-num">{dt.getUTCDate()}</span>
            </div>
          );
        })}
      </div>
      {/* Grid rows */}
      <div className="cal-week__body">
        {HOURS.map((hour) => (
          <div key={hour} className="cal-week__row">
            <div className="cal-week__time">{`${String(hour).padStart(2, "0")}:00`}</div>
            {days.map((d) => {
              const cellEvents = byDateHour.get(`${d}:${hour}`) ?? [];
              return (
                <div key={d} className="cal-week__cell" onClick={() => onNewAppt(d, hour)}>
                  {cellEvents.map((ev) => (
                    <div key={ev.id} className={`cal-week__event cal-event--${ev.kind}`} onClick={(e) => { e.stopPropagation(); onEdit(ev); }}>
                      <bdi>{ev.patient_family_name.slice(0, 1)}. {ev.patient_given_name}</bdi>
                      {ev.start_time && <span className="cal-week__event-time">{ev.start_time.slice(0, 5)}</span>}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Month View (calendar grid)

function MonthView({ events, date, isManager, onDayClick }: { events: CalendarEvent[]; date: string; isManager: boolean; onDayClick: (d: string) => void }) {
  const t = useT();
  const intl = useIntl();
  const todayIso = isoDate(new Date());

  const monthStart = startOfMonth(date);
  const monthEnd = endOfMonth(date);

  // Build 6-week grid starting from the Sunday before monthStart
  const gridStart = startOfWeek(monthStart);
  const gridDays = daysInRange(gridStart, addDays(gridStart, 41)); // 6 weeks

  // Group events by date
  const byDate = new Map<string, CalendarEvent[]>();
  for (const ev of events) {
    const list = byDate.get(ev.date) ?? [];
    list.push(ev);
    byDate.set(ev.date, list);
  }

  // Day-of-week headers
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(gridStart + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    return intl.formatDate(d, { weekday: "short" });
  });

  return (
    <div className="cal-month">
      <div className="cal-month__header">
        {weekDays.map((wd) => (
          <div key={wd} className="cal-month__wday">{wd}</div>
        ))}
      </div>
      <div className="cal-month__grid">
        {gridDays.map((d) => {
          const dayEvents = byDate.get(d) ?? [];
          const inMonth = d >= monthStart && d <= monthEnd;
          const dayNum = new Date(d + "T12:00:00Z").getUTCDate();
          return (
            <div key={d} className={`cal-month__day ${!inMonth ? "cal-month__day--outside" : ""} ${d === todayIso ? "cal-month__day--today" : ""}`} onClick={() => onDayClick(d)}>
              <span className="cal-month__num">{dayNum}</span>
              {dayEvents.length > 0 && (
                <div className="cal-month__events">
                  {dayEvents.slice(0, 3).map((ev) => (
                    <div key={ev.id} className={`cal-month__dot cal-month__dot--${ev.kind}`} title={`${ev.patient_given_name} ${ev.patient_family_name}`} />
                  ))}
                  {dayEvents.length > 3 && <span className="cal-month__more">+{dayEvents.length - 3}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Shared event components

function EventCard({ event: ev, showTherapist, onEdit }: { event: CalendarEvent; showTherapist: boolean; onEdit: () => void }) {
  const t = useT();
  const isAppt = ev.kind === "appointment";
  const timeRange = ev.start_time && ev.end_time
    ? `${ev.start_time.slice(0, 5)} – ${ev.end_time.slice(0, 5)}`
    : ev.start_time ? ev.start_time.slice(0, 5) : "";

  return (
    <div className={`cal-event cal-event--${ev.kind}`} onClick={(e) => { e.stopPropagation(); onEdit(); }}>
      <div className="cal-event__header">
        <span className="cal-event__patient"><bdi>{ev.patient_family_name}, {ev.patient_given_name}</bdi></span>
        {timeRange && <span className="cal-event__time">{timeRange}</span>}
      </div>
      <div className="cal-event__detail">
        {isAppt ? (ev.title || t("calendar.appointment")) : `${ev.assignment_name} · ${t("calendar.sessionLabel", { seq: ev.seq, week: ev.week })}`}
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
      <span className="cal-chip__label">{ev.kind === "appointment" ? (ev.title || t("calendar.appointment")) : ev.assignment_name}</span>
      {showTherapist && ev.therapist_name && <span className="cal-chip__therapist">{ev.therapist_name}</span>}
    </button>
  );
}

// ---- Dialogs

function NewAppointmentDialog({ clinicId, date, hour, onClose }: { clinicId: string; date: string; hour: number; onClose: () => void }) {
  const t = useT();
  const create = useCreateAppointment();
  const [title, setTitle] = useState("");
  const [patientSearch, setPatientSearch] = useState("");
  const [patients, setPatients] = useState<CalendarPatient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<CalendarPatient | null>(null);
  const [apptDate, setApptDate] = useState(date);
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
      await create.mutateAsync({ patient_id: selectedPatient.id, title: title || undefined, notes: notes || undefined, date: apptDate, start_time: startTime, end_time: endTime });
      onClose();
    } catch { setError(t("calendar.createFailed")); }
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
          <div className="cal-patient-search">
            <TextField label={t("calendar.patient")} value={selectedPatient ? `${selectedPatient.family_name}, ${selectedPatient.given_name}` : patientSearch} onChange={(e) => onPatientSearch(e.target.value)} autoComplete="off" placeholder={t("calendar.searchPatient")} />
            {patients.length > 0 && !selectedPatient && (
              <ul className="cal-patient-results">
                {patients.map((p) => (
                  <li key={p.id}><button type="button" className="cal-patient-option" onClick={() => { setSelectedPatient(p); setPatients([]); }}><bdi>{p.family_name}, {p.given_name}</bdi></button></li>
                ))}
              </ul>
            )}
          </div>
          <TextField label={t("calendar.apptTitle")} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("calendar.apptTitleHint")} />
          <div className="pform__row">
            <TextField label={t("calendar.newDate")} type="date" value={apptDate} onChange={(e) => setApptDate(e.target.value)} />
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
        await reschedule.mutateAsync({ sessionId: event.id, planned_date: newDate, planned_time: newTime || null, shift_subsequent: shiftSubsequent });
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
    } catch { setError(t("calendar.rescheduleFailed")); }
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
            <TextField label={t("calendar.newDate")} type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
            <TextField label={t("calendar.newTime")} type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
          </div>
          {event.kind === "session" && (
            <label className="calendar-dialog__shift"><input type="checkbox" checked={shiftSubsequent} onChange={(e) => setShiftSubsequent(e.target.checked)} />{t("calendar.shiftSubsequent")}</label>
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
