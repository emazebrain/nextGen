/** Client for /v1/admin (system admin spec): organizations, clinics and users, for platform admins. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend } from "./http.ts";
import type { Role } from "./queries.ts";

export type Region = "il" | "us" | "eu";
export type OrgStatus = "active" | "suspended" | "closed";
export type ClinicStatus = "active" | "inactive" | "pending";
export type UserStatus = "active" | "invited" | "disabled";
export const REGIONS: Region[] = ["il", "us", "eu"];
export const ORG_LOCALES = ["he", "en", "ar", "ru", "fr", "es", "zh"] as const;
export type OrgLocale = (typeof ORG_LOCALES)[number];
export const ROLES: Role[] = ["therapist", "assistant", "clinic_manager", "org_admin", "platform_admin"];

export interface AdminOrg {
  id: string;
  name: string;
  region: Region;
  default_locale: OrgLocale;
  status: OrgStatus;
  created_at: string;
}
export interface AdminClinic {
  id: string;
  organization_id: string;
  organization_name?: string;
  name: string;
  country_code: string;
  timezone: string;
  status: ClinicStatus;
  created_at: string;
  /** Printed at the top of progress reports. */
  address?: string | null;
  phone?: string | null;
  license_no?: string | null;
}
export interface AdminUser {
  id: string;
  email: string;
  full_name: string;
  status: UserStatus;
  memberships?: Array<{ organization_id: string; clinic_id: string | null; role: Role }>;
}
export interface OrgDetail {
  organization: AdminOrg;
  clinics: AdminClinic[];
  admins: AdminUser[];
}
export interface UserFilters {
  org_id?: string;
  clinic_id?: string;
  status?: UserStatus;
}
export interface CreateUserInput {
  email: string;
  full_name: string;
  role: Role;
  organization_id: string;
  clinic_id: string | null;
}

const enc = encodeURIComponent;

export const listOrganizations = (status?: OrgStatus, signal?: AbortSignal) =>
  apiGet<{ organizations: AdminOrg[] }>(`/v1/admin/organizations${status ? `?status=${status}` : ""}`, signal ? { signal } : {}).then((r) => r.organizations);
export const getOrganization = (id: string, signal?: AbortSignal) => apiGet<OrgDetail>(`/v1/admin/organizations/${enc(id)}`, signal ? { signal } : {});
export const createOrganization = (data: { name: string; region: Region; default_locale: OrgLocale }) =>
  apiSend<{ organization: AdminOrg }>("POST", "/v1/admin/organizations", data).then((r) => r.organization);
export const patchOrganization = (id: string, data: Partial<{ name: string; status: OrgStatus; default_locale: OrgLocale }>) =>
  apiSend<{ organization: AdminOrg }>("PATCH", `/v1/admin/organizations/${enc(id)}`, data).then((r) => r.organization);

export const listClinics = (orgId: string, signal?: AbortSignal) =>
  apiGet<{ clinics: AdminClinic[] }>(`/v1/admin/organizations/${enc(orgId)}/clinics`, signal ? { signal } : {}).then((r) => r.clinics);
export const getClinic = (id: string, signal?: AbortSignal) => apiGet<{ clinic: AdminClinic }>(`/v1/admin/clinics/${enc(id)}`, signal ? { signal } : {}).then((r) => r.clinic);
export const createClinic = (orgId: string, data: { name: string; country_code: string; timezone: string }) =>
  apiSend<{ clinic: AdminClinic }>("POST", `/v1/admin/organizations/${enc(orgId)}/clinics`, data).then((r) => r.clinic);
export const patchClinic = (id: string, data: Partial<{ name: string; status: ClinicStatus; timezone: string; address: string | null; phone: string | null; license_no: string | null }>) =>
  apiSend<{ clinic: AdminClinic }>("PATCH", `/v1/admin/clinics/${enc(id)}`, data).then((r) => r.clinic);

export const listUsers = (filters: UserFilters, signal?: AbortSignal) => {
  const q = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as Array<[string, string]>).toString();
  return apiGet<{ users: AdminUser[] }>(`/v1/admin/users${q ? `?${q}` : ""}`, signal ? { signal } : {}).then((r) => r.users);
};
export const createUser = (data: CreateUserInput) => apiSend<{ user: AdminUser; email_sent: boolean }>("POST", "/v1/admin/users", data);
export const patchUser = (id: string, data: Partial<{ full_name: string; status: "active" | "disabled" }>) =>
  apiSend<{ user: AdminUser }>("PATCH", `/v1/admin/users/${enc(id)}`, data).then((r) => r.user);
export const resendInvite = (id: string) => apiSend<{ sent: boolean }>("POST", `/v1/admin/users/${enc(id)}/resend-invite`);

// ---------------------------------------------------------------- hooks

const adminKey = ["admin"] as const;

export const useAdminOrgs = (enabled = true) => useQuery({ queryKey: [...adminKey, "orgs"], queryFn: ({ signal }) => listOrganizations(undefined, signal), enabled });
export const useAdminOrg = (id: string, enabled = true) =>
  useQuery({ queryKey: [...adminKey, "org", id], queryFn: ({ signal }) => getOrganization(id, signal), enabled: enabled && !!id });
export const useAdminClinics = (orgId: string) => useQuery({ queryKey: [...adminKey, "clinics", orgId], queryFn: ({ signal }) => listClinics(orgId, signal), enabled: !!orgId });
export const useAdminClinic = (id: string) => useQuery({ queryKey: [...adminKey, "clinic", id], queryFn: ({ signal }) => getClinic(id, signal), enabled: !!id });
export const useAdminUsers = (filters: UserFilters) => useQuery({ queryKey: [...adminKey, "users", filters], queryFn: ({ signal }) => listUsers(filters, signal) });

/** Any admin change can show up on several screens, so every admin query is refreshed after one. */
export function useAdminMutation<In, Out>(fn: (input: In) => Promise<Out>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: adminKey }) });
}
