import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreatePatient,
  GuardianInput,
  PatientDetail,
  PatientListItem,
  PatientStatus,
  RecordConsent,
  StaffMember,
  UpdatePatient,
} from "@emb/contracts";
import { ApiError, apiGet, apiSend } from "./http.ts";
import { usePrefs } from "../i18n/index.tsx";
import type { BrainRegion, VideoInput, VideoSummary } from "@emb/contracts";
import type { AssignInput, AssignmentView, GameSessionView, LaunchPackage, ProgressionDecisionView, TemplateDetail, TemplateInput, TemplateSummary, TodayItem } from "@emb/contracts";
import { useOptionalDevice } from "../device/session.tsx";
import { offlineOr, todayFromBundle } from "../device/bundle.ts";

export type { PatientDetail, PatientListItem, PatientStatus, StaffMember };
export type Role = "platform_admin" | "org_admin" | "clinic_manager" | "therapist" | "assistant";
export interface Membership {
  clinic_id: string | null;
  organization_id: string;
  role: Role;
  clinic_name: string | null;
}
export interface Me {
  user: { id: string; email: string; name: string };
  memberships: Membership[];
  /** Manages the platform content library (videos). */
  is_platform_admin?: boolean;
}
/** Kept for older screens: the list row. */
export type PatientRow = PatientListItem;

/** Don't retry answers that won't change: signed out, MFA missing, not found. */
const retry = (count: number, err: unknown) => {
  if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false;
  // The browser knows it's offline: retrying only delays the offline screens (offline devices spec §7.5).
  if (err instanceof ApiError && err.status === 0 && typeof navigator !== "undefined" && navigator.onLine === false) return false;
  return count < 2;
};

export const meKey = ["me"] as const;
export const patientKey = (id: string) => ["patient", id] as const;

export function useMe() {
  return useQuery({ queryKey: meKey, queryFn: ({ signal }) => apiGet<Me>("/v1/me", { signal }), retry, staleTime: 60_000 });
}

export function usePatients(clinicId: string | null, archived = false) {
  const space = useOptionalDevice()?.space ?? null;
  return useQuery({
    queryKey: ["patients", clinicId, archived],
    queryFn: ({ signal }) => {
      const q = new URLSearchParams();
      if (clinicId) q.set("clinic", clinicId);
      if (archived) q.set("archived", "1");
      const qs = q.toString();
      return offlineOr(space, `patients:${clinicId}:${archived}`, () => apiGet<{ patients: PatientListItem[] }>(`/v1/patients${qs ? `?${qs}` : ""}`, { signal }).then((r) => r.patients), (b) => (archived ? [] : b.caseload));
    },
    retry,
  });
}

export function usePatient(id: string) {
  const space = useOptionalDevice()?.space ?? null;
  return useQuery({
    queryKey: patientKey(id),
    queryFn: ({ signal }) => offlineOr(space, `patient:${id}`, () => apiGet<{ patient: PatientDetail }>(`/v1/patients/${encodeURIComponent(id)}`, { signal }).then((r) => r.patient), (b) => b.patients[id]),
    retry,
  });
}

export function useStaff(clinicId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["staff", clinicId],
    queryFn: ({ signal }) => apiGet<{ staff: StaffMember[] }>(`/v1/clinics/${clinicId}/staff`, { signal }).then((r) => r.staff),
    enabled: enabled && !!clinicId,
    retry,
    staleTime: 60_000,
  });
}

/** After any patient change: refresh lists and this patient. */
function useRefresh(id?: string) {
  const qc = useQueryClient();
  return (patient?: PatientDetail) => {
    void qc.invalidateQueries({ queryKey: ["patients"] });
    if (id && patient) qc.setQueryData(patientKey(id), patient);
    else if (id) void qc.invalidateQueries({ queryKey: patientKey(id) });
  };
}

export function useCreatePatient() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: CreatePatient) => apiSend<{ id: string }>("POST", "/v1/patients", body),
    onSuccess: () => refresh(),
  });
}

export function useUpdatePatient(id: string) {
  const refresh = useRefresh(id);
  return useMutation({
    mutationFn: (body: UpdatePatient) => apiSend<{ patient: PatientDetail }>("PATCH", `/v1/patients/${id}`, body).then((r) => r.patient),
    onSuccess: (p) => refresh(p),
  });
}

export function useArchivePatient(id: string) {
  const refresh = useRefresh(id);
  return useMutation({
    mutationFn: (archive: boolean) => apiSend<{ ok: true }>("POST", `/v1/patients/${id}/${archive ? "archive" : "restore"}`),
    onSuccess: () => refresh(),
  });
}

export function useSaveGuardian(patientId: string) {
  const refresh = useRefresh(patientId);
  return useMutation({
    mutationFn: ({ guardianId, body }: { guardianId?: string; body: GuardianInput }): Promise<unknown> =>
      guardianId
        ? apiSend<{ ok: true }>("PATCH", `/v1/patients/${patientId}/guardians/${guardianId}`, body)
        : apiSend<{ id: string }>("POST", `/v1/patients/${patientId}/guardians`, body),
    onSuccess: () => refresh(),
  });
}

export function useRemoveGuardian(patientId: string) {
  const refresh = useRefresh(patientId);
  return useMutation({
    mutationFn: (guardianId: string) => apiSend<{ ok: true }>("DELETE", `/v1/patients/${patientId}/guardians/${guardianId}`),
    onSuccess: () => refresh(),
  });
}

export function useRecordConsent(patientId: string) {
  const refresh = useRefresh(patientId);
  return useMutation({
    mutationFn: (body: RecordConsent) => apiSend<{ patient: PatientDetail }>("POST", `/v1/patients/${patientId}/consents`, body).then((r) => r.patient),
    onSuccess: (p) => refresh(p),
  });
}

// ---------------------------------------------------------------- protocols (slice 3)
export type { AssignmentView, TemplateDetail, TemplateSummary, TodayItem };

export function useTemplates(clinicId: string | null) {
  const { locale } = usePrefs(); // video titles in the steps come back in this language
  const space = useOptionalDevice()?.space ?? null;
  return useQuery({
    queryKey: ["templates", clinicId, locale],
    queryFn: ({ signal }) =>
      offlineOr(space, `templates:${clinicId}`, () => apiGet<{ templates: TemplateSummary[] }>(`/v1/templates?lang=${locale}${clinicId ? `&clinic=${clinicId}` : ""}`, { signal }).then((r) => r.templates), (b) => b.templates),
    retry,
  });
}

export function useTemplate(id: string | null) {
  const space = useOptionalDevice()?.space ?? null;
  return useQuery({
    queryKey: ["template", id],
    queryFn: ({ signal }) => offlineOr(space, `template:${id}`, () => apiGet<{ template: TemplateDetail }>(`/v1/templates/${id}`, { signal }).then((r) => r.template)),
    enabled: !!id,
    retry,
  });
}

export function useSaveTemplate(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TemplateInput) =>
      (id ? apiSend<{ template: TemplateDetail }>("PUT", `/v1/templates/${id}`, body) : apiSend<{ template: TemplateDetail }>("POST", "/v1/templates", body)).then((r) => r.template),
    onSuccess: (t) => {
      void qc.invalidateQueries({ queryKey: ["templates"] });
      qc.setQueryData(["template", t.id], t);
    },
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiSend<{ ok: true }>("DELETE", `/v1/templates/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["templates"] }),
  });
}

export const assignmentKey = (patientId: string) => ["assignment", patientId] as const;

export function useAssignment(patientId: string) {
  const space = useOptionalDevice()?.space ?? null;
  return useQuery({
    queryKey: assignmentKey(patientId),
    queryFn: ({ signal }) =>
      offlineOr(space, `assignment:${patientId}`, () => apiGet<{ assignment: AssignmentView | null }>(`/v1/patients/${patientId}/assignment`, { signal }).then((r) => r.assignment), (b) => {
        if (!b.caseload.some((p) => p.id === patientId)) return undefined;
        const aid = b.packages.find((p) => p.patient.id === patientId)?.assignment.id;
        return (aid && b.assignments.find((a) => a.id === aid)) || null;
      }),
    retry,
  });
}

export function useAssign(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AssignInput) => apiSend<{ assignment: AssignmentView }>("POST", `/v1/patients/${patientId}/assignment`, body).then((r) => r.assignment),
    onSuccess: (a) => {
      qc.setQueryData(assignmentKey(patientId), a);
      void qc.invalidateQueries({ queryKey: ["today"] });
    },
  });
}

export function useUpdateAssignment(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "paused" | "cancelled" }) =>
      apiSend<{ assignment: AssignmentView | null }>("PATCH", `/v1/assignments/${id}`, { status }).then((r) => r.assignment),
    onSuccess: (a) => {
      qc.setQueryData(assignmentKey(patientId), a);
      void qc.invalidateQueries({ queryKey: ["today"] });
    },
  });
}

export function useToday(clinicId: string | null) {
  const { locale } = usePrefs();
  const space = useOptionalDevice()?.space ?? null;
  return useQuery({
    queryKey: ["today", clinicId, locale],
    queryFn: ({ signal }) => offlineOr(space, `today:${clinicId}`, () => apiGet<{ items: TodayItem[] }>(`/v1/today?lang=${locale}${clinicId ? `&clinic=${clinicId}` : ""}`, { signal }).then((r) => r.items), (b, done) => todayFromBundle(b, done)),
    retry,
  });
}

// ------------------------------------------------------------------ sessions (slice 4)

export function useLaunch() {
  return useMutation({
    mutationFn: (plannedSessionId: string) => apiSend<{ launch: LaunchPackage }>("POST", `/v1/planned-sessions/${plannedSessionId}/launch`).then((r) => r.launch),
  });
}

export const sessionsKey = (patientId: string) => ["sessions", patientId] as const;

export function usePatientSessions(patientId: string) {
  const space = useOptionalDevice()?.space ?? null;
  return useQuery({
    queryKey: sessionsKey(patientId),
    queryFn: ({ signal }) => offlineOr(space, `sessions:${patientId}`, () => apiGet<{ sessions: GameSessionView[] }>(`/v1/patients/${patientId}/sessions`, { signal }).then((r) => r.sessions)),
    retry,
  });
}

export function useProgression(patientId: string) {
  const space = useOptionalDevice()?.space ?? null;
  return useQuery({
    queryKey: ["progression", patientId],
    queryFn: ({ signal }) => offlineOr(space, `progression:${patientId}`, () => apiGet<{ decisions: ProgressionDecisionView[] }>(`/v1/patients/${patientId}/progression`, { signal }).then((r) => r.decisions)),
    retry,
  });
}

// ---------------------------------------------------------------- video library (ADR 0018)

export function useBrainRegions(lang: string) {
  return useQuery({
    queryKey: ["brain-regions", lang],
    queryFn: ({ signal }) => apiGet<{ regions: BrainRegion[] }>(`/v1/brain-regions?lang=${lang}`, { signal }).then((r) => r.regions),
    retry,
    staleTime: 10 * 60_000,
  });
}

export interface VideoFilters {
  lang: string;
  q?: string;
  region?: string | null;
  /** A lobe or area code, in both hemispheres. */
  code?: string | null;
  all?: boolean;
}

export function useVideos(f: VideoFilters, enabled = true) {
  return useQuery({
    queryKey: ["videos", f.lang, f.q ?? "", f.region ?? "", f.code ?? "", !!f.all],
    queryFn: ({ signal }) => {
      const q = new URLSearchParams({ lang: f.lang });
      if (f.q?.trim()) q.set("q", f.q.trim());
      if (f.region) q.set("region", f.region);
      if (f.code) q.set("code", f.code);
      if (f.all) q.set("all", "1");
      return apiGet<{ videos: VideoSummary[] }>(`/v1/videos?${q}`, { signal }).then((r) => r.videos);
    },
    enabled,
    retry,
  });
}

export function useVideo(id: string | null, lang: string) {
  return useQuery({
    queryKey: ["video", id, lang],
    queryFn: ({ signal }) => apiGet<{ video: VideoSummary }>(`/v1/videos/${id}?lang=${lang}`, { signal }).then((r) => r.video),
    enabled: !!id,
    retry,
  });
}

export function useSaveVideo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input, lang }: { id: string | null; input: VideoInput; lang: string }) =>
      apiSend<{ video: VideoSummary }>(id ? "PUT" : "POST", id ? `/v1/admin/videos/${id}?lang=${lang}` : `/v1/admin/videos?lang=${lang}`, input).then((r) => r.video),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["videos"] }),
  });
}

/** Uploads a video file with progress (fetch can't report upload progress). Resolves with the updated video. */
export function uploadVideoFile(id: string, file: File, onProgress: (fraction: number) => void): Promise<VideoSummary> {
  // The demo build answers in the browser (fetch is patched there), so it can't use XMLHttpRequest.
  if (import.meta.env.MODE === "demo")
    return fetch(`/v1/admin/videos/${id}/file`, { method: "PUT", body: file, headers: { "content-type": file.type } }).then(async (r) => {
      onProgress(1);
      const body = await r.json();
      if (!r.ok) throw new ApiError(r.status, body?.error ?? "unknown");
      return body.video as VideoSummary;
    });
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/v1/admin/videos/${id}/file`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("content-type", file.type || "video/mp4");
    xhr.setRequestHeader("accept", "application/json");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      const body = (() => {
        try {
          return JSON.parse(xhr.responseText);
        } catch {
          return null;
        }
      })();
      if (xhr.status >= 200 && xhr.status < 300) resolve(body.video as VideoSummary);
      else reject(new ApiError(xhr.status, body?.error ?? "unknown", body?.requestId));
    };
    xhr.onerror = () => reject(new ApiError(0, "network"));
    xhr.send(file);
  });
}
