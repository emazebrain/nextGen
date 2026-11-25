import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ConsentRequestView,
  CreatePatient,
  GuardianInput,
  PatientDetail,
  PatientListItem,
  PatientStatus,
  RecordConsent,
  RequestConsent,
  StaffMember,
  UpdatePatient,
} from "@emb/contracts";
import { ApiError, apiGet, apiSend } from "./http.ts";
import { usePrefs } from "../i18n/index.tsx";
import type { BrainRegion, VideoInput, VideoSummary } from "@emb/contracts";
import type { AssignInput, AssignmentView, GameSessionView, LaunchPackage, ProgressionDecisionView, TemplateDetail, TemplateInput, TemplateSummary, TodayItem } from "@emb/contracts";
import { useOptionalDevice } from "../device/session.tsx";
import { offlineOr, setOnlineUser, todayFromBundle } from "../device/bundle.ts";

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
  /** The app_user status: 'active', 'invited', or 'disabled'. */
  user_status?: string;
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

/** While the network is down, ask again every so often: the browser's "online" event can't be relied on. */
export const ME_RETRY_OFFLINE_MS = 15_000;

export function useMe(enabled = true) {
  return useQuery({
    queryKey: meKey,
    enabled,
    queryFn: ({ signal }) =>
      apiGet<Me>("/v1/me", { signal }).then(
        (me) => {
          setOnlineUser(me.user.id);
          return me;
        },
        (e: unknown) => {
          setOnlineUser(null);
          throw e;
        },
      ),
    retry,
    staleTime: 60_000,
    refetchInterval: (q) => (q.state.error instanceof ApiError && q.state.error.status === 0 ? ME_RETRY_OFFLINE_MS : false),
  });
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

export function useRequestConsent(patientId: string) {
  const refresh = useRefresh(patientId);
  return useMutation({
    mutationFn: (body: RequestConsent) => apiSend<{ consent_requests: ConsentRequestView[] }>("POST", `/v1/patients/${patientId}/consent-requests`, body),
    onSuccess: () => refresh(),
  });
}

export function useResendConsentRequest(patientId: string) {
  const refresh = useRefresh(patientId);
  return useMutation({
    mutationFn: (requestId: string) => apiSend<{ ok: true }>("POST", `/v1/patients/${patientId}/consent-requests/${requestId}/resend`),
    onSuccess: () => refresh(),
  });
}

export function useCancelConsentRequest(patientId: string) {
  const refresh = useRefresh(patientId);
  return useMutation({
    mutationFn: (requestId: string) => apiSend<{ ok: true }>("DELETE", `/v1/patients/${patientId}/consent-requests/${requestId}`),
    onSuccess: () => refresh(),
  });
}

export function useSendPortalInvite(patientId: string) {
  const refresh = useRefresh(patientId);
  return useMutation({
    mutationFn: (guardianId: string) => apiSend<{ invite_id: string; token: string }>("POST", `/v1/patients/${patientId}/guardians/${guardianId}/portal-invite`),
    onSuccess: () => refresh(),
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
    mutationFn: ({ id, ...change }: { id: string } & ({ status: "active" | "paused" | "cancelled" } | { setting: "clinic" | "home" | "mixed" })) =>
      apiSend<{ assignment: AssignmentView | null }>("PATCH", `/v1/assignments/${id}`, change).then((r) => r.assignment),
    onSuccess: (a) => {
      qc.setQueryData(assignmentKey(patientId), a);
      void qc.invalidateQueries({ queryKey: ["today"] });
      void qc.invalidateQueries({ queryKey: ["calendar"] });
    },
  });
}

const reviewCountKey = (clinicId: string | null) => ["reviewCount", clinicId] as const;

/** Flagged results the caller may review, as last reported by Today (offline devices spec §7.4). */
export function useReviewCount(clinicId: string | null): number {
  return useQuery({ queryKey: reviewCountKey(clinicId), queryFn: () => 0, enabled: false, initialData: 0 }).data;
}

export interface TodayAppointment {
  id: string;
  title: string;
  notes: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  color: string;
  patient_given_name: string;
  patient_family_name: string;
  patient_id: string;
}

interface TodayData {
  items: TodayItem[];
  appointments: TodayAppointment[];
}

export function useToday(clinicId: string | null) {
  const qc = useQueryClient();
  const { locale } = usePrefs();
  const space = useOptionalDevice()?.space ?? null;
  return useQuery({
    queryKey: ["today", clinicId, locale],
    queryFn: ({ signal }) =>
      offlineOr(
        space,
        `today:${clinicId}`,
        () =>
          apiGet<{ items: TodayItem[]; appointments?: TodayAppointment[]; review_count?: number }>(`/v1/today?lang=${locale}${clinicId ? `&clinic=${clinicId}` : ""}`, { signal }).then((r) => {
            qc.setQueryData(reviewCountKey(clinicId), r.review_count ?? 0);
            return { items: r.items, appointments: r.appointments ?? [] } as TodayData;
          }),
        (b, done) => ({ items: todayFromBundle(b, done), appointments: [] } as TodayData),
      ),
    retry,
  });
}

// ------------------------------------------------------------------ sessions (slice 4)

export function useLaunch() {
  // On a device set up for offline use, the launch names it: if the connection drops mid-session, anyone who may use
  // this device can send the results (offline devices review, ADR 0019).
  const device = useOptionalDevice();
  const deviceId = device?.space ? device.deviceId : null;
  return useMutation({
    mutationFn: (plannedSessionId: string) =>
      apiSend<{ launch: LaunchPackage }>("POST", `/v1/planned-sessions/${plannedSessionId}/launch`, deviceId ? { device_id: deviceId } : {}).then((r) => r.launch),
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

export interface PatientAssignment {
  id: string;
  name: string;
  status: string;
  start_date: string;
  weeks: number;
  sessions_per_week: number;
  setting: string;
  created_at: string;
}

export function usePatientAssignments(patientId: string) {
  return useQuery({
    queryKey: ["assignments", patientId],
    queryFn: ({ signal }) => apiGet<{ assignments: PatientAssignment[] }>(`/v1/patients/${patientId}/assignments`, { signal }).then((r) => r.assignments),
    retry,
  });
}

/** Count or don't count a flagged result (offline devices spec §7.4). */
export function useReview(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "accept" | "exclude" }) => apiSend<{ decision: string }>("POST", `/v1/results/${id}/review`, { decision }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: sessionsKey(patientId) });
      void qc.invalidateQueries({ queryKey: ["today"] });
    },
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

// ---------------------------------------------------------------- review queue (design doc §5.9.1)

export interface ReviewQueueItem {
  id: string;
  kind: "game" | "video";
  game_id: string | null;
  video_id: string | null;
  ended_at: string;
  accuracy: number | null;
  difficulty: number | null;
  review_reason: string;
  patient_id: string;
  given_name: string;
  family_name: string;
}

export function useReviewQueue(clinicId: string | null, patientId?: string | null) {
  return useQuery({
    queryKey: ["reviewQueue", clinicId, patientId ?? null],
    queryFn: ({ signal }) => {
      const q = new URLSearchParams();
      if (clinicId) q.set("clinic", clinicId);
      if (patientId) q.set("patient", patientId);
      const qs = q.toString();
      return apiGet<{ items: ReviewQueueItem[] }>(`/v1/review-queue${qs ? `?${qs}` : ""}`, { signal }).then((r) => r.items);
    },
    retry,
  });
}

/** Accept or exclude a flagged result from the review queue. */
export function useReviewFromQueue(clinicId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, kind, decision, note }: { id: string; kind: "game" | "video"; decision: "accept" | "exclude"; note?: string }) =>
      apiSend<{ decision: string }>("POST", `/v1/${kind === "video" ? "video-views" : "results"}/${id}/review`, { decision, ...(note ? { note } : {}) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["reviewQueue"] });
      void qc.invalidateQueries({ queryKey: ["today"] });
      void qc.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

// ---------------------------------------------------------------- reports (design doc §5.9.2)

export type TrendSummary = "not_enough" | "improving" | "steady" | "declining";
export type ReasonKind = "review" | "missed_home" | "missed_clinic" | "inactive" | "declining" | "stepped_down";
export interface CaseloadReason {
  kind: ReasonKind;
  count?: number;
  days?: number;
}
/** One patient on the Reports caseload (reports dashboard design 2026-11-23). */
export interface CaseloadRow {
  patient_id: string;
  given_name: string;
  family_name: string;
  /** Up to eight latest scores, oldest first; 100 is the child's own baseline. */
  scores: Array<number | null>;
  summary: TrendSummary;
  /** The last seven days. */
  week: { done: number; planned: number };
  difficulty: number | null;
  last_change: "up" | "down" | null;
  last_session_at: string | null;
  reasons: CaseloadReason[];
}
export interface ReportsOverview {
  sessions: number;
  sessions_this_week: number;
  active_patients: number;
  in_care: number;
  avg_duration_ms: number | null;
  /** Done ÷ (done + missed) planned sessions in the range; null when nothing was planned. */
  plan_followed: number | null;
  /** Six rolling weeks, oldest first. */
  weekly: Array<{ week_start: string; sessions: number; avg_duration_ms: number | null }>;
}
export interface AdherenceWeek {
  week_start: string;
  planned: number;
  done_clinic: number;
  done_home: number;
}

const reportQs = (clinicId: string | null, extra: Record<string, string | number> = {}) => {
  const q = new URLSearchParams();
  if (clinicId) q.set("clinic", clinicId);
  for (const [k, v] of Object.entries(extra)) q.set(k, String(v));
  const qs = q.toString();
  return qs ? `?${qs}` : "";
};

export function useCaseload(clinicId: string | null) {
  return useQuery({
    queryKey: ["reports", "caseload", clinicId],
    queryFn: ({ signal }) => apiGet<{ patients: CaseloadRow[] }>(`/v1/reports/caseload${reportQs(clinicId)}`, { signal }).then((r) => r.patients),
    retry,
    staleTime: 60_000,
  });
}

export function useReportsOverview(clinicId: string | null, days: number) {
  return useQuery({
    queryKey: ["reports", "overview", clinicId, days],
    queryFn: ({ signal }) => apiGet<ReportsOverview>(`/v1/reports/overview${reportQs(clinicId, { days })}`, { signal }),
    retry,
    staleTime: 60_000,
  });
}

export function useAdherence(clinicId: string | null) {
  return useQuery({
    queryKey: ["reports", "adherence", clinicId],
    queryFn: ({ signal }) => apiGet<{ weeks: AdherenceWeek[] }>(`/v1/reports/adherence${reportQs(clinicId, { weeks: 6 })}`, { signal }).then((r) => r.weeks),
    retry,
    staleTime: 60_000,
  });
}

export interface ActivityBreakdown {
  game_id: string;
  count: number;
  avg_accuracy: number | null;
}

export function useActivityBreakdown(clinicId: string | null, from?: string, to?: string) {
  return useQuery({
    queryKey: ["reports", "activity-breakdown", clinicId, from, to],
    queryFn: ({ signal }) => {
      const q = new URLSearchParams();
      if (clinicId) q.set("clinic", clinicId);
      if (from) q.set("from", from);
      if (to) q.set("to", to);
      return apiGet<{ data: ActivityBreakdown[] }>(`/v1/reports/activity-breakdown?${q}`, { signal }).then((r) => r.data);
    },
    retry,
    staleTime: 60_000,
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

/** Region IDs that have at least one published video — used to filter empty options from dropdowns. */
export function useVideoRegionIds() {
  return useQuery({
    queryKey: ["video-region-ids"],
    queryFn: ({ signal }) => apiGet<{ ids: string[] }>("/v1/video-region-ids", { signal }).then((r) => new Set(r.ids)),
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
