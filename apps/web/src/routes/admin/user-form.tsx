/** Invite a user (system admin spec): the API creates the account and emails a temporary password. */
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Alert, Button, Card, MazeLoader, PageHeader, SelectField, TextField } from "@emb/ui";
import { ROLES, createUser, useAdminClinics, useAdminMutation, useAdminOrgs } from "../../api/admin.ts";
import { ApiError } from "../../api/http.ts";
import type { Role } from "../../api/queries.ts";
import { useT, type MessageId } from "../../i18n/index.tsx";
import { useTitle } from "../../lib/title.ts";
import { LoadError } from "../shared.tsx";
import { BackLink, saveError } from "./common.tsx";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** These roles cover a whole organization (or the platform), so they are never tied to one clinic. */
const ORG_WIDE: Role[] = ["org_admin", "platform_admin"];

export function UserFormPage() {
  const t = useT();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const orgs = useAdminOrgs();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<Role>("therapist");
  const [orgId, setOrgId] = useState(params.get("org") ?? "");
  const [clinicId, setClinicId] = useState(params.get("clinic") ?? "");
  const clinics = useAdminClinics(orgId);
  const [errors, setErrors] = useState<Partial<Record<"email" | "full_name" | "organization", MessageId>>>({});
  const [error, setError] = useState<MessageId | null>(null);
  const save = useAdminMutation(createUser);
  useTitle(t("admin.users.new"));

  const orgWide = ORG_WIDE.includes(role);
  const clinic = orgWide ? "" : clinicId;
  const backTo = params.get("clinic") ? `/admin/clinics/${params.get("clinic")}` : orgId ? `/admin/organizations/${orgId}` : "/admin/organizations";

  if (orgs.isPending) return <MazeLoader label={t("common.loading")} />;
  if (orgs.isError) return <LoadError error={orgs.error} retry={() => void orgs.refetch()} />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const found: typeof errors = {};
    if (!EMAIL.test(email.trim())) found.email = "errors.email";
    if (!fullName.trim()) found.full_name = "errors.required";
    if (!orgId) found.organization = "errors.required";
    setErrors(found);
    if (Object.keys(found).length) {
      requestAnimationFrame(() => (document.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus());
      return;
    }
    try {
      const res = await save.mutateAsync({ email: email.trim(), full_name: fullName.trim(), role, organization_id: orgId, clinic_id: clinic || null });
      const flash = res.email_sent
        ? { tone: "success", text: t("admin.users.createdSent", { name: fullName.trim() }) }
        : { tone: "warning", text: t("admin.users.createdNotSent", { name: fullName.trim() }) };
      navigate(clinic ? `/admin/clinics/${clinic}` : `/admin/organizations/${orgId}`, { state: { flash } });
    } catch (err) {
      if (err instanceof ApiError && err.code === "email_taken") setErrors({ email: "admin.users.emailTaken" });
      else setError(saveError(err));
    }
  };

  return (
    <div className="app-page app-page--narrow">
      <BackLink to={backTo}>{t("common.back")}</BackLink>
      <PageHeader title={t("admin.users.new")} description={t("admin.users.intro")} />
      <Card>
        <form className="pform" onSubmit={(e) => void submit(e)} noValidate>
          {error && <Alert tone="danger">{t(error)}</Alert>}
          <div className="pform__row">
            <TextField
              label={t("admin.users.email")}
              name="email"
              type="email"
              autoComplete="off"
              dir="ltr"
              maxLength={254}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setErrors(({ email: _gone, ...rest }) => rest);
              }}
              error={errors.email ? t(errors.email) : undefined}
            />
            <TextField
              label={t("admin.users.name")}
              name="full_name"
              autoComplete="off"
              maxLength={255}
              value={fullName}
              onChange={(e) => {
                setFullName(e.target.value);
                setErrors(({ full_name: _gone, ...rest }) => rest);
              }}
              error={errors.full_name ? t(errors.full_name) : undefined}
            />
          </div>
          <SelectField label={t("admin.users.role")} name="role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t("shell.role", { role: r })}
              </option>
            ))}
          </SelectField>
          <div className="pform__row">
            <div>
              <SelectField
                label={t("admin.users.organization")}
                name="organization_id"
                value={orgId}
                aria-invalid={errors.organization ? true : undefined}
                aria-describedby={errors.organization ? "user-org-error" : undefined}
                onChange={(e) => {
                  setOrgId(e.target.value);
                  setClinicId("");
                  setErrors(({ organization: _gone, ...rest }) => rest);
                }}
              >
                <option value="">{t("admin.users.organizationChoose")}</option>
                {orgs.data.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </SelectField>
              {errors.organization && (
                <p className="emb-field__error" id="user-org-error">
                  {t(errors.organization)}
                </p>
              )}
            </div>
            <SelectField label={t("admin.users.clinic")} name="clinic_id" value={clinic} disabled={orgWide || !orgId} onChange={(e) => setClinicId(e.target.value)}>
              <option value="">{t("admin.users.wholeOrganization")}</option>
              {(clinics.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SelectField>
          </div>
          <div className="pform__actions">
            <Link to={backTo} className="emb-btn emb-btn--secondary">
              {t("common.cancel")}
            </Link>
            <Button type="submit" loading={save.isPending}>
              {t("admin.users.create")}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
