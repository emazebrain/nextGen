/** Client for /v1/calendar (scheduling and calendar routes). */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend } from "./http.ts";

/** A unified calendar event — either a protocol session or an appointment. */
export interface CalendarEvent {
  kind: "session" | "appointment";
  id: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  seq: number;
  week: number;
  location: string;
  status: string;
  patient_id: string;
  patient_given_name: string;
  patient_family_name: string;
  assignment_id: string;
  assignment_name: string;
  title: string;
  notes: string;
  therapist_id: string;
  therapist_name: string;
  color: string;
}

export interface CalendarTherapist {
  id: string;
  full_name: string;
}

export interface CalendarPatient {
  id: string;
  given_name: string;
  family_name: string;
}

export interface CalendarFilters {
  clinic: string;
  from?: string;
  to?: string;
  therapist?: string;
}

export const APPOINTMENT_COLORS = ["blue", "green", "purple", "orange", "red", "teal", "pink", "yellow"] as const;
export type AppointmentColor = (typeof APPOINTMENT_COLORS)[number];

export interface CreateAppointmentInput {
  patient_id: string;
  title?: string | undefined;
  notes?: string | undefined;
  date: string;
  start_time: string;
  end_time: string;
  color?: AppointmentColor | undefined;
}

const enc = encodeURIComponent;

function buildQuery(filters: CalendarFilters): string {
  const parts = [`clinic=${enc(filters.clinic)}`];
  if (filters.from) parts.push(`from=${enc(filters.from)}`);
  if (filters.to) parts.push(`to=${enc(filters.to)}`);
  if (filters.therapist) parts.push(`therapist=${enc(filters.therapist)}`);
  return parts.join("&");
}

export const listCalendarEvents = (filters: CalendarFilters, signal?: AbortSignal) =>
  apiGet<{ events: CalendarEvent[] }>(`/v1/calendar/events?${buildQuery(filters)}`, signal ? { signal } : {}).then((r) => r.events);

export const listCalendarTherapists = (clinicId: string, signal?: AbortSignal) =>
  apiGet<{ therapists: CalendarTherapist[] }>(`/v1/calendar/therapists?clinic=${enc(clinicId)}`, signal ? { signal } : {}).then((r) => r.therapists);

export const searchCalendarPatients = (clinicId: string, q: string, signal?: AbortSignal) =>
  apiGet<{ patients: CalendarPatient[] }>(`/v1/calendar/patients?clinic=${enc(clinicId)}&q=${enc(q)}`, signal ? { signal } : {}).then((r) => r.patients);

export const createAppointment = (data: CreateAppointmentInput) =>
  apiSend<{ id: string }>("POST", "/v1/calendar/appointments", data);

export const updateAppointment = (id: string, data: Partial<CreateAppointmentInput & { status: string }>) =>
  apiSend<{ ok: boolean }>("PATCH", `/v1/calendar/appointments/${enc(id)}`, data);

export const rescheduleSession = (sessionId: string, data: { planned_date: string; planned_time?: string | null; shift_subsequent?: boolean }) =>
  apiSend<{ ok: boolean; shifted: number }>("PATCH", `/v1/calendar/sessions/${enc(sessionId)}`, data);

export const getExportUrl = (clinicId: string, from?: string, to?: string) => {
  const parts = [`clinic=${enc(clinicId)}`];
  if (from) parts.push(`from=${enc(from)}`);
  if (to) parts.push(`to=${enc(to)}`);
  return `/v1/calendar/export.ics?${parts.join("&")}`;
};

// ---- Hooks

const calKey = ["calendar"] as const;

export const useCalendarEvents = (filters: CalendarFilters) =>
  useQuery({
    queryKey: [...calKey, "events", filters],
    queryFn: ({ signal }) => listCalendarEvents(filters, signal),
    enabled: !!filters.clinic,
  });

export const useCalendarTherapists = (clinicId: string) =>
  useQuery({
    queryKey: [...calKey, "therapists", clinicId],
    queryFn: ({ signal }) => listCalendarTherapists(clinicId, signal),
    enabled: !!clinicId,
  });

export function useCreateAppointment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateAppointmentInput) => createAppointment(data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: calKey }),
  });
}

export function useReschedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, ...data }: { sessionId: string; planned_date: string; planned_time?: string | null; shift_subsequent?: boolean }) =>
      rescheduleSession(sessionId, data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: calKey }),
  });
}
