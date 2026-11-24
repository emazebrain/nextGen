/** Client for /v1/parent (parent portal routes). */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend } from "./http.ts";
import type { GameSessionView, LaunchPackage } from "@emb/contracts";

export interface ParentChild {
  id: string;
  given_name: string;
  family_name: string;
  date_of_birth: string;
  status: string;
  preferred_locale: string;
  relationship: string;
  clinic_name: string;
}

export interface ParentGuardian {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  preferred_locale: string;
  has_pin: boolean;
}

export interface ParentMe {
  user: { id: string; email: string; name: string };
  guardians: ParentGuardian[];
  children: ParentChild[];
}

export interface ChildProgress {
  patient: { id: string; given_name: string; family_name: string; status: string };
  stats: { total_sessions: number; last_session: string | null };
  protocols: Array<{
    id: string;
    title: string;
    status: string;
    started_at: string;
    total_sessions: number;
    completed_sessions: number;
  }>;
}

export interface PortalInviteInfo {
  guardian_name: string;
  guardian_email: string;
  clinic_name: string;
  preferred_locale: string;
  has_existing_account?: boolean;
}

// ---- API functions

export const getParentMe = (signal?: AbortSignal) =>
  apiGet<ParentMe>("/v1/parent/me", signal ? { signal } : {});

export const getChildProgress = (childId: string, signal?: AbortSignal) =>
  apiGet<ChildProgress>(`/v1/parent/children/${encodeURIComponent(childId)}/progress`, signal ? { signal } : {});

export const setPin = (guardianId: string, pin: string) =>
  apiSend<{ ok: boolean }>("PUT", "/v1/parent/pin", { guardian_id: guardianId, pin });

export const requestDataExport = (childId: string, type: "export" | "deletion") =>
  apiSend<{ ok: boolean; message: string }>("POST", "/v1/parent/data-request", { child_id: childId, type });

/** Public: look up a portal invite by token (no auth required). */
export async function getPortalInvite(token: string): Promise<PortalInviteInfo> {
  const res = await fetch(`/api/parent-portal/${encodeURIComponent(token)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.error ?? "unknown"), { status: res.status, code: body.error });
  }
  return res.json();
}

/** Public: register a parent account from a portal invite (no auth required). */
export async function registerParent(token: string, password: string): Promise<{ ok: boolean; user_id: string }> {
  const res = await fetch(`/api/parent-portal/${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.error ?? "unknown"), { status: res.status, code: body.error });
  }
  return res.json();
}

// ---- Hooks

const parentKey = ["parent"] as const;

export const useParentMe = (enabled = true) =>
  useQuery({ queryKey: [...parentKey, "me"], queryFn: ({ signal }) => getParentMe(signal), enabled });

export const useChildProgress = (childId: string) =>
  useQuery({
    queryKey: [...parentKey, "progress", childId],
    queryFn: ({ signal }) => getChildProgress(childId, signal),
    enabled: !!childId,
  });

// ---- Home session types & hooks

export interface HomePlannedSession {
  id: string;
  seq: number;
  week: number;
  status: string;
  planned_date: string;
  location: string;
  assignment_id: string;
  assignment_name: string;
  assignment_status?: string;
  total?: number;
  completed?: number;
  completed_at?: string | null;
}

export interface ChildSessions {
  upcoming: HomePlannedSession[];
  recent: HomePlannedSession[];
}

/** A coming appointment the clinic set for the child. Guardians only read these; the staff's notes are never sent. */
export interface ChildAppointment {
  id: string;
  date: string;
  /** "HH:MM" */
  start_time: string;
  end_time: string;
  title: string;
  clinic_name: string;
}

export const getChildAppointments = (childId: string, signal?: AbortSignal) =>
  apiGet<{ appointments: ChildAppointment[] }>(`/v1/parent/children/${encodeURIComponent(childId)}/appointments`, signal ? { signal } : {}).then((r) => r.appointments);

export const getChildSessions = (childId: string, signal?: AbortSignal) =>
  apiGet<ChildSessions>(`/v1/parent/children/${encodeURIComponent(childId)}/sessions`, signal ? { signal } : {});

export const getChildHistory = (childId: string, signal?: AbortSignal) =>
  apiGet<{ sessions: GameSessionView[] }>(`/v1/parent/children/${encodeURIComponent(childId)}/history`, signal ? { signal } : {});

export const launchHomeSession = (childId: string, sessionId: string) =>
  apiSend<{ launch: LaunchPackage }>("POST", `/v1/parent/children/${encodeURIComponent(childId)}/sessions/${encodeURIComponent(sessionId)}/launch`, {});

export const useChildSessions = (childId: string) =>
  useQuery({
    queryKey: [...parentKey, "sessions", childId],
    queryFn: ({ signal }) => getChildSessions(childId, signal),
    enabled: !!childId,
  });

export const useChildAppointments = (childId: string) =>
  useQuery({
    queryKey: [...parentKey, "appointments", childId],
    queryFn: ({ signal }) => getChildAppointments(childId, signal),
    enabled: !!childId,
  });

export const useChildHistory = (childId: string) =>
  useQuery({
    queryKey: [...parentKey, "history", childId],
    queryFn: ({ signal }) => getChildHistory(childId, signal),
    enabled: !!childId,
  });

export const useLaunchHomeSession = (childId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => launchHomeSession(childId, sessionId),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: [...parentKey, "sessions", childId] }); },
  });
};
