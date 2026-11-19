/** Client for /v1/calendar (scheduling and calendar routes). */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend } from "./http.ts";

export interface CalendarSession {
  id: string;
  planned_date: string;
  planned_time: string | null;
  seq: number;
  week: number;
  location: string;
  status: string;
  patient_id: string;
  patient_given_name: string;
  patient_family_name: string;
  assignment_id: string;
  assignment_name: string;
  therapist_id: string;
  therapist_name: string;
}

export interface CalendarTherapist {
  id: string;
  full_name: string;
}

export interface CalendarFilters {
  clinic: string;
  from?: string;
  to?: string;
  therapist?: string;
  status?: string;
}

const enc = encodeURIComponent;

function buildQuery(filters: CalendarFilters): string {
  const parts = [`clinic=${enc(filters.clinic)}`];
  if (filters.from) parts.push(`from=${enc(filters.from)}`);
  if (filters.to) parts.push(`to=${enc(filters.to)}`);
  if (filters.therapist) parts.push(`therapist=${enc(filters.therapist)}`);
  if (filters.status) parts.push(`status=${enc(filters.status)}`);
  return parts.join("&");
}

export const listCalendarSessions = (filters: CalendarFilters, signal?: AbortSignal) =>
  apiGet<{ sessions: CalendarSession[] }>(`/v1/calendar/sessions?${buildQuery(filters)}`, signal ? { signal } : {}).then((r) => r.sessions);

export const listCalendarTherapists = (clinicId: string, signal?: AbortSignal) =>
  apiGet<{ therapists: CalendarTherapist[] }>(`/v1/calendar/therapists?clinic=${enc(clinicId)}`, signal ? { signal } : {}).then((r) => r.therapists);

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

export const useCalendarSessions = (filters: CalendarFilters) =>
  useQuery({
    queryKey: [...calKey, "sessions", filters],
    queryFn: ({ signal }) => listCalendarSessions(filters, signal),
    enabled: !!filters.clinic,
  });

export const useCalendarTherapists = (clinicId: string) =>
  useQuery({
    queryKey: [...calKey, "therapists", clinicId],
    queryFn: ({ signal }) => listCalendarTherapists(clinicId, signal),
    enabled: !!clinicId,
  });

export function useReschedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, ...data }: { sessionId: string; planned_date: string; planned_time?: string | null; shift_subsequent?: boolean }) =>
      rescheduleSession(sessionId, data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: calKey }),
  });
}
