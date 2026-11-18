/** Client for /v1/org (org-admin routes): clinics and staff within the admin's own org. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend } from "./http.ts";
import type { Role } from "./queries.ts";

export type ClinicStatus = "active" | "inactive" | "pending";
export type UserStatus = "active" | "invited" | "disabled";

export interface OrgInfo {
  id: string;
  name: string;
  region: string;
  default_locale: string;
  status: string;
  created_at: string;
}
export interface OrgClinic {
  id: string;
  organization_id: string;
  name: string;
  country_code: string;
  timezone: string;
  status: ClinicStatus;
  created_at: string;
}
export interface OrgStaff {
  id: string;
  email: string;
  full_name: string;
  status: UserStatus;
  created_at?: string;
  memberships?: Array<{ clinic_id: string | null; role: Role }>;
  role?: Role;
  clinic_id?: string | null;
}
export interface OrgOverview {
  organization: OrgInfo;
  clinics: OrgClinic[];
}
export interface ClinicDetail {
  clinic: OrgClinic;
  staff: OrgStaff[];
}
export interface StaffFilters {
  clinic_id?: string;
  status?: UserStatus;
}
export interface CreateStaffInput {
  email: string;
  full_name: string;
  role: "clinic_manager" | "therapist" | "assistant";
  clinic_id: string;
}

const enc = encodeURIComponent;

export const getOrgOverview = (signal?: AbortSignal) =>
  apiGet<OrgOverview>("/v1/org", signal ? { signal } : {});

export const listOrgClinics = (signal?: AbortSignal) =>
  apiGet<{ clinics: OrgClinic[] }>("/v1/org/clinics", signal ? { signal } : {}).then((r) => r.clinics);

export const getOrgClinic = (id: string, signal?: AbortSignal) =>
  apiGet<ClinicDetail>(`/v1/org/clinics/${enc(id)}`, signal ? { signal } : {});

export const createOrgClinic = (data: { name: string; country_code: string; timezone: string }) =>
  apiSend<{ clinic: OrgClinic }>("POST", "/v1/org/clinics", data).then((r) => r.clinic);

export const patchOrgClinic = (id: string, data: Partial<{ name: string; status: ClinicStatus; timezone: string }>) =>
  apiSend<{ clinic: OrgClinic }>("PATCH", `/v1/org/clinics/${enc(id)}`, data).then((r) => r.clinic);

export const listOrgStaff = (filters: StaffFilters, signal?: AbortSignal) => {
  const q = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as Array<[string, string]>).toString();
  return apiGet<{ staff: OrgStaff[] }>(`/v1/org/staff${q ? `?${q}` : ""}`, signal ? { signal } : {}).then((r) => r.staff);
};

export const createOrgStaff = (data: CreateStaffInput) =>
  apiSend<{ user: OrgStaff; email_sent: boolean }>("POST", "/v1/org/staff", data);

export const patchOrgStaff = (id: string, data: Partial<{ full_name: string; status: "active" | "disabled" }>) =>
  apiSend<{ user: OrgStaff }>("PATCH", `/v1/org/staff/${enc(id)}`, data).then((r) => r.user);

export const resendOrgInvite = (id: string) =>
  apiSend<{ sent: boolean }>("POST", `/v1/org/staff/${enc(id)}/resend-invite`);

// ---------------------------------------------------------------- hooks

const orgKey = ["org"] as const;

export const useOrgOverview = (enabled = true) =>
  useQuery({ queryKey: [...orgKey, "overview"], queryFn: ({ signal }) => getOrgOverview(signal), enabled });

export const useOrgClinics = (enabled = true) =>
  useQuery({ queryKey: [...orgKey, "clinics"], queryFn: ({ signal }) => listOrgClinics(signal), enabled });

export const useOrgClinic = (id: string) =>
  useQuery({ queryKey: [...orgKey, "clinic", id], queryFn: ({ signal }) => getOrgClinic(id, signal), enabled: !!id });

export const useOrgStaff = (filters: StaffFilters = {}) =>
  useQuery({ queryKey: [...orgKey, "staff", filters], queryFn: ({ signal }) => listOrgStaff(filters, signal) });

export function useOrgMutation<In, Out>(fn: (input: In) => Promise<Out>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: orgKey }) });
}
