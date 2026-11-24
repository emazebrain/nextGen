/**
 * Org admin calendar — org-wide day/week/month views with clinic filter (§5.13).
 */
import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import { Button, Card, Chip, MazeLoader, PageHeader, SelectField } from "@emb/ui";
import { useOrgCalendarEvents, useOrgClinics, type OrgCalendarEvent, type OrgCalendarFilters, type OrgClinic } from "../../api/org.ts";
import { useT } from "../../i18n/index.tsx";
import { useTitle } from "../../lib/title.ts";
import { BackLink, NoticeBar, useFlash } from "./common.tsx";
import { useIntl } from "react-intl";

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}
function startOfWeek(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
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
const HOURS = Array.from({ length: 14 }, (_, i) => i + 7);

export function ManageCalendarPage() {
  const t = useT();
  const intl = useIntl();
  const [notice] = useFlash();
  useTitle(t("manage.calendar.title"));

  const [date, setDate] = useState(() => isoDate(new Date()));
  const [view, setView] = useState<ViewMode>("day");
  const [clinicFilter, setClinicFilter] = useState("");
  const clinics = useOrgClinics();

  const { from, to } = useMemo(() => {
    if (view === "day") return { from: date, to: date };
    if (view === "week") { const s = startOfWeek(date); return { from: s, to: addDays(s, 6) }; }
    return { from: startOfMonth(date), to: endOfMonth(date) };
  }, [date, view]);

  const filters: OrgCalendarFilters = { from, to, ...(clinicFilter ? { clinic: clinicFilter } : {}) };
  const events = useOrgCalendarEvents(filters);

  const navigate = (n: number) => {
    if (view === "day") setDate((d) => addDays(d, n));
    else if (view === "week") setDate((d) => addDays(d, n * 7));
    else setDate((d) => { const dt = new Date(d + "T12:00:00Z"); dt.setUTCMonth(dt.getUTCMonth() + n); return isoDate(dt); });
  };

  const goToday = () => setDate(isoDate(new Date()));
  const isToday = date === isoDate(new Date());
  const dateObj = new Date(date + "T12:00:00Z");

  const headerLabel = view === "day"
    ? intl.formatDate(dateObj, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : view === "week"
      ? `${intl.formatDate(new Date(from + "T12:00:00Z"), { day: "numeric", month: "short" })} – ${intl.formatDate(new Date(to + "T12:00:00Z"), { day: "numeric", month: "short", year: "numeric" })}`
      : intl.formatDate(dateObj, { month: "long", year: "numeric" });

  return (
    <div className="app-page">
      <BackLink to="/manage">{t("manage.overview.title")}</BackLink>
      <NoticeBar notice={notice} />
      <PageHeader title={t("manage.calendar.title")} description={t("manage.calendar.description")} />

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
          <div className="cal-view-switcher" role="group" aria-label={t("calendar.viewLabel")}>
            {(["day", "week", "month"] as ViewMode[]).map((v) => (
              <button key={v} type="button" className={`cal-view-btn ${v === view ? "cal-view-btn--active" : ""}`} onClick={() => setView(v)}>
                {t(`calendar.view.${v}`)}
              </button>
            ))}
          </div>
          <SelectField label={t("manage.calendar.clinic")} hideLabel name="clinic" value={clinicFilter} onChange={(e) => setClinicFilter(e.target.value)}>
            <option value="">{t("manage.calendar.allClinics")}</option>
            {(clinics.data ?? []).map((cl: OrgClinic) => (
              <option key={cl.id} value={cl.id}>{cl.name}</option>
            ))}
          </SelectField>
        </div>
      </div>

      {events.isPending ? (
        <MazeLoader label={t("common.loading")} />
      ) : view === "day" ? (
        <OrgDayView events={events.data ?? []} />
      ) : view === "week" ? (
        <OrgWeekView events={events.data ?? []} from={from} onDayClick={(d) => { setDate(d); setView("day"); }} />
      ) : (
        <OrgMonthView events={events.data ?? []} date={date} onDayClick={(d) => { setDate(d); setView("day"); }} />
      )}
    </div>
  );
}

// ---- Day view

function OrgDayView({ events }: { events: OrgCalendarEvent[] }) {
  const t = useT();
  const eventsByHour = new Map<number, OrgCalendarEvent[]>();
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
            {unscheduled.map((ev) => (
              <button key={ev.id} type="button" className="cal-chip">
                <bdi>{ev.patient_given_name} {ev.patient_family_name}</bdi>
                <span className="cal-chip__label">{ev.kind === "appointment" ? (ev.title || t("calendar.appointment")) : ev.assignment_name}</span>
                <span className="cal-chip__therapist">{ev.clinic_name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="cal-grid">
        {HOURS.map((hour) => {
          const hourEvents = eventsByHour.get(hour) ?? [];
          return (
            <div key={hour} className="cal-row">
              <div className="cal-row__time">{`${String(hour).padStart(2, "0")}:00`}</div>
              <div className="cal-row__slot">
                {hourEvents.map((ev) => <OrgEventCard key={ev.id} event={ev} />)}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---- Week view

function OrgWeekView({ events, from, onDayClick }: { events: OrgCalendarEvent[]; from: string; onDayClick: (d: string) => void }) {
  const intl = useIntl();
  const days = useMemo(() => daysInRange(from, addDays(from, 6)), [from]);
  const todayIso = isoDate(new Date());

  const byDateHour = new Map<string, OrgCalendarEvent[]>();
  for (const ev of events) {
    const hour = ev.start_time ? parseInt(ev.start_time.slice(0, 2), 10) : -1;
    const key = `${ev.date}:${hour}`;
    const list = byDateHour.get(key) ?? [];
    list.push(ev);
    byDateHour.set(key, list);
  }

  return (
    <div className="cal-week">
      <div className="cal-week__header">
        <div className="cal-week__time-col" />
        {days.map((d) => {
          const dt = new Date(d + "T12:00:00Z");
          return (
            <div key={d} className={`cal-week__day-header ${d === todayIso ? "cal-week__day-header--today" : ""}`} onClick={() => onDayClick(d)} style={{ cursor: "pointer" }}>
              <span className="cal-week__day-name">{intl.formatDate(dt, { weekday: "short" })}</span>
              <span className="cal-week__day-num">{dt.getUTCDate()}</span>
            </div>
          );
        })}
      </div>
      <div className="cal-week__body">
        {HOURS.map((hour) => (
          <div key={hour} className="cal-week__row">
            <div className="cal-week__time">{`${String(hour).padStart(2, "0")}:00`}</div>
            {days.map((d) => {
              const cellEvents = byDateHour.get(`${d}:${hour}`) ?? [];
              return (
                <div key={d} className="cal-week__cell" onClick={() => onDayClick(d)}>
                  {cellEvents.map((ev) => (
                    <div key={ev.id} className={`cal-week__event cal-event--${ev.kind}`}>
                      <bdi>{ev.patient_family_name.slice(0, 1)}. {ev.patient_given_name}</bdi>
                      <span className="cal-week__event-clinic">{ev.clinic_name}</span>
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

// ---- Month view

function OrgMonthView({ events, date, onDayClick }: { events: OrgCalendarEvent[]; date: string; onDayClick: (d: string) => void }) {
  const intl = useIntl();
  const todayIso = isoDate(new Date());
  const monthStart = startOfMonth(date);
  const monthEnd = endOfMonth(date);
  const gridStart = startOfWeek(monthStart);
  const gridDays = daysInRange(gridStart, addDays(gridStart, 41));

  const byDate = new Map<string, OrgCalendarEvent[]>();
  for (const ev of events) {
    const list = byDate.get(ev.date) ?? [];
    list.push(ev);
    byDate.set(ev.date, list);
  }

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(gridStart + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    return intl.formatDate(d, { weekday: "short" });
  });

  return (
    <div className="cal-month">
      <div className="cal-month__header">
        {weekDays.map((wd) => <div key={wd} className="cal-month__wday">{wd}</div>)}
      </div>
      <div className="cal-month__grid">
        {gridDays.map((d) => {
          const dayEvents = byDate.get(d) ?? [];
          const inMonth = d >= monthStart && d <= monthEnd;
          return (
            <div key={d} className={`cal-month__day ${!inMonth ? "cal-month__day--outside" : ""} ${d === todayIso ? "cal-month__day--today" : ""}`} onClick={() => onDayClick(d)}>
              <span className="cal-month__num">{new Date(d + "T12:00:00Z").getUTCDate()}</span>
              {dayEvents.length > 0 && (
                <div className="cal-month__events">
                  {dayEvents.slice(0, 3).map((ev) => (
                    <div key={ev.id} className={`cal-month__dot cal-month__dot--${ev.kind}`} title={`${ev.patient_given_name} – ${ev.clinic_name}`} />
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

function OrgEventCard({ event: ev }: { event: OrgCalendarEvent }) {
  const t = useT();
  const isAppt = ev.kind === "appointment";
  const timeRange = ev.start_time && ev.end_time
    ? `${ev.start_time.slice(0, 5)} – ${ev.end_time.slice(0, 5)}`
    : ev.start_time ? ev.start_time.slice(0, 5) : "";

  return (
    <div className={`cal-event cal-event--${ev.kind}`}>
      <div className="cal-event__header">
        <span className="cal-event__patient"><bdi>{ev.patient_given_name} {ev.patient_family_name}</bdi></span>
        {timeRange && <span className="cal-event__time">{timeRange}</span>}
      </div>
      <div className="cal-event__detail">
        {isAppt ? (ev.title || t("calendar.appointment")) : `${ev.assignment_name} · ${t("calendar.sessionLabel", { seq: ev.seq, week: ev.week })}`}
        {ev.therapist_name && <> · <bdi>{ev.therapist_name}</bdi></>}
        <> · <Chip tone="neutral">{ev.clinic_name}</Chip></>
      </div>
    </div>
  );
}
