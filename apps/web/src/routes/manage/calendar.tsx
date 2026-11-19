/**
 * Org admin calendar — org-wide view of all sessions and appointments (§5.13).
 * Filter by clinic; shows clinic name on each event.
 */
import { useState } from "react";
import { Link } from "react-router";
import { CalendarDays, ChevronLeft, ChevronRight, MapPin, Play } from "lucide-react";
import { Button, Card, Chip, EmptyState, MazeLoader, PageHeader, SelectField } from "@emb/ui";
import {
  useOrgCalendarEvents,
  useOrgClinics,
  type OrgCalendarEvent,
  type OrgCalendarFilters,
  type OrgClinic,
} from "../../api/org.ts";
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

const HOURS = Array.from({ length: 14 }, (_, i) => i + 7); // 07:00–20:00

export function ManageCalendarPage() {
  const t = useT();
  const intl = useIntl();
  const [notice] = useFlash();
  useTitle(t("manage.calendar.title"));

  const [date, setDate] = useState(() => isoDate(new Date()));
  const [clinicFilter, setClinicFilter] = useState("");

  const clinics = useOrgClinics();

  const filters: OrgCalendarFilters = {
    from: date,
    to: date,
    ...(clinicFilter ? { clinic: clinicFilter } : {}),
  };

  const events = useOrgCalendarEvents(filters);

  const prev = () => setDate((d) => addDays(d, -1));
  const next = () => setDate((d) => addDays(d, 1));
  const today = () => setDate(isoDate(new Date()));

  const dateObj = new Date(date + "T12:00:00Z");
  const isToday = date === isoDate(new Date());

  // Group events by hour
  const eventsByHour = new Map<number, OrgCalendarEvent[]>();
  for (const ev of events.data ?? []) {
    const hour = ev.start_time ? parseInt(ev.start_time.slice(0, 2), 10) : -1;
    const list = eventsByHour.get(hour) ?? [];
    list.push(ev);
    eventsByHour.set(hour, list);
  }
  const unscheduled = eventsByHour.get(-1) ?? [];

  return (
    <div className="app-page">
      <BackLink to="/manage">{t("manage.overview.title")}</BackLink>
      <NoticeBar notice={notice} />
      <PageHeader title={t("manage.calendar.title")} description={t("manage.calendar.description")} />

      {/* Toolbar */}
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
      ) : (
        <>
          {/* Unscheduled strip */}
          {unscheduled.length > 0 && (
            <div className="cal-unscheduled">
              <span className="cal-unscheduled__label">{t("calendar.unscheduled")}</span>
              <div className="cal-unscheduled__items">
                {unscheduled.map((ev) => (
                  <button key={ev.id} type="button" className="cal-chip">
                    <bdi>{ev.patient_given_name} {ev.patient_family_name}</bdi>
                    <span className="cal-chip__label">
                      {ev.kind === "appointment" ? (ev.title || t("calendar.appointment")) : ev.assignment_name}
                    </span>
                    <span className="cal-chip__therapist">{ev.clinic_name}</span>
                  </button>
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
                <div key={hour} className="cal-row">
                  <div className="cal-row__time">{timeLabel}</div>
                  <div className={`cal-row__slot ${hourEvents.length > 0 ? "cal-row__slot--has-events" : ""}`}>
                    {hourEvents.map((ev) => (
                      <OrgEventCard key={ev.id} event={ev} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function OrgEventCard({ event: ev }: { event: OrgCalendarEvent }) {
  const t = useT();
  const isAppt = ev.kind === "appointment";
  const timeRange = ev.start_time && ev.end_time
    ? `${ev.start_time.slice(0, 5)} – ${ev.end_time.slice(0, 5)}`
    : ev.start_time
      ? ev.start_time.slice(0, 5)
      : "";

  return (
    <div className={`cal-event cal-event--${ev.kind}`}>
      <div className="cal-event__header">
        <span className="cal-event__patient">
          <bdi>{ev.patient_family_name}, {ev.patient_given_name}</bdi>
        </span>
        {timeRange && <span className="cal-event__time">{timeRange}</span>}
      </div>
      <div className="cal-event__detail">
        {isAppt
          ? (ev.title || t("calendar.appointment"))
          : `${ev.assignment_name} · ${t("calendar.sessionLabel", { seq: ev.seq, week: ev.week })}`}
        {ev.therapist_name && <> · <bdi>{ev.therapist_name}</bdi></>}
        <> · <Chip tone="neutral">{ev.clinic_name}</Chip></>
      </div>
    </div>
  );
}
