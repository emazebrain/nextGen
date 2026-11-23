/** Client for progress reports (migration 0042): issued by staff, read by staff and, once shared, by the family. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend } from "./http.ts";
import type { Locale } from "../i18n/index.tsx";

export type ReportAudience = "family" | "formal";
export type ReportTrend = "not_enough" | "improving" | "steady" | "declining";

/** The figures stored with a report, exactly as they stood when it was issued. */
export interface ProgressReportData {
  patient: { given_name: string; family_name: string; date_of_birth: string };
  clinic: { name: string; address: string | null; phone: string | null; license_no: string | null };
  author: { name: string };
  totals: { sessions: number; minutes: number; days_active: number; clinic_sessions: number; home_sessions: number };
  plan: { planned: number; done: number; missed: number };
  activities: Array<{ game_id: string; sessions: number; avg_accuracy: number | null; first_difficulty: number; last_difficulty: number }>;
  trend: { summary: ReportTrend; points: Array<{ ended_at: string; score: number | null }> };
  changes: Array<{ decided_at: string; game_id: string; action: "up" | "down"; from: number; to: number }>;
}

export interface ProgressReportSummary {
  id: string;
  patient_id: string;
  created_at: string;
  period_from: string;
  period_to: string;
  audience: ReportAudience;
  locale: Locale;
  shared_with_family: boolean;
  author_name: string;
}
export interface ProgressReport extends ProgressReportSummary {
  summary: string;
  data: ProgressReportData;
}
export interface NewProgressReport {
  from: string;
  to: string;
  audience: ReportAudience;
  locale: Locale;
  summary: string;
  shared_with_family: boolean;
}

const enc = encodeURIComponent;
const listKey = (patientId: string) => ["progress-reports", patientId] as const;
const oneKey = (id: string) => ["progress-report", id] as const;

export function useProgressReports(patientId: string) {
  return useQuery({
    queryKey: listKey(patientId),
    queryFn: ({ signal }) => apiGet<{ reports: ProgressReportSummary[] }>(`/v1/patients/${enc(patientId)}/progress-reports`, { signal }).then((r) => r.reports ?? []),
    retry: false,
  });
}

export function useProgressReport(id: string) {
  return useQuery({
    queryKey: oneKey(id),
    queryFn: ({ signal }) => apiGet<{ report: ProgressReport }>(`/v1/progress-reports/${enc(id)}`, { signal }).then((r) => r.report),
    retry: false,
  });
}

export function useCreateProgressReport(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NewProgressReport) => apiSend<{ report: ProgressReport }>("POST", `/v1/patients/${enc(patientId)}/progress-reports`, body).then((r) => r.report),
    onSuccess: (r) => {
      qc.setQueryData(oneKey(r.id), r);
      void qc.invalidateQueries({ queryKey: listKey(patientId) });
    },
  });
}

export function useShareProgressReport(report: { id: string; patient_id: string }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (shared: boolean) => apiSend<{ report: ProgressReportSummary }>("PATCH", `/v1/progress-reports/${enc(report.id)}`, { shared_with_family: shared }).then((r) => r.report),
    onSuccess: (r) => {
      qc.setQueryData<ProgressReport>(oneKey(report.id), (old) => (old ? { ...old, shared_with_family: r.shared_with_family } : old));
      void qc.invalidateQueries({ queryKey: listKey(report.patient_id) });
    },
  });
}

// ---- parent portal

export function useChildReports(childId: string) {
  return useQuery({
    queryKey: ["parent", "reports", childId],
    queryFn: ({ signal }) => apiGet<{ reports: ProgressReportSummary[] }>(`/v1/parent/children/${enc(childId)}/reports`, { signal }).then((r) => r.reports ?? []),
    retry: false,
  });
}

export function useParentReport(id: string) {
  return useQuery({
    queryKey: ["parent", "report", id],
    queryFn: ({ signal }) => apiGet<{ report: ProgressReport }>(`/v1/parent/reports/${enc(id)}`, { signal }).then((r) => r.report),
    retry: false,
  });
}
