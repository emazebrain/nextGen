/** Invite a new staff member (org admin). */
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Alert, Button, Card, MazeLoader, PageHeader, SelectField, TextField } from "@emb/ui";
import { createOrgStaff, useOrgClinics, useOrgMutation, type CreateStaffInput, type OrgClinic } from "../../api/org.ts";
import { ApiError } from "../../api/http.ts";
import { useT, type MessageId } from "../../i18n/index.tsx";
import { useTitle } from "../../lib/title.ts";
import { LoadError } from "../shared.tsx";
import { BackLink, saveError } from "./common.tsx";

const ASSIGNABLE_ROLES = ["therapist", "assistant", "clinic_manager"] as const;

export function ManageStaffFormPage() {
  const t = useT();
  const [params] = useSearchParams();
  const preClinic = params.get("clinic") ?? "";
  const clinics = useOrgClinics();
  useTitle(t("manage.staff.new"));

  if (clinics.isPending) return <MazeLoader label={t("common.loading")} />;
  if (clinics.isError) return <LoadError error={clinics.error} retry={() => void clinics.refetch()} />;

  return <StaffForm clinics={clinics.data} preClinic={preClinic} />;
}

function StaffForm({ clinics, preClinic }: { clinics: OrgClinic[]; preClinic: string }) {
  const t = useT();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<CreateStaffInput["role"]>("therapist");
  const [clinicId, setClinicId] = useState(preClinic);
  const [errors, setErrors] = useState<Partial<Record<"email" | "full_name" | "role" | "clinic_id", MessageId>>>({});
  const [error, setError] = useState<MessageId | null>(null);
  const save = useOrgMutation(() => createOrgStaff({ email: email.trim(), full_name: fullName.trim(), role, clinic_id: clinicId }));

  const backTo = preClinic ? `/manage/clinics/${preClinic}` : "/manage";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const found: typeof errors = {};
    if (!email.trim()) found.email = "errors.required";
    if (!fullName.trim()) found.full_name = "errors.required";
    if (!clinicId) found.clinic_id = "manage.staff.clinicRequired";
    setErrors(found);
    if (Object.keys(found).length) {
      setError("errors.fieldsInvalid");
      return;
    }
    try {
      const res = await save.mutateAsync(undefined);
      const flashText = t(res.email_sent ? "manage.staff.createdSent" : "manage.staff.createdNotSent", { name: fullName.trim() });
      navigate(backTo, { state: { flash: { tone: "success", text: flashText } } });
    } catch (err) {
      if (err instanceof ApiError && err.code === "email_taken") setErrors({ email: "manage.staff.emailTaken" });
      else setError(saveError(err));
    }
  };

  return (
    <div className="app-page app-page--narrow">
      <BackLink to={backTo}>
        <bdi>{t("manage.staff.title")}</bdi>
      </BackLink>
      <PageHeader title={t("manage.staff.new")} description={t("manage.staff.intro")} />
      <Card>
        <form className="pform" onSubmit={(e) => void submit(e)} noValidate>
          {error && <Alert tone="danger">{t(error)}</Alert>}
          <TextField
            label={t("manage.staff.email")}
            name="email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setErrors(({ email: _gone, ...rest }) => rest);
            }}
            error={errors.email ? t(errors.email) : undefined}
          />
          <TextField
            label={t("manage.staff.name")}
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
          <div className="pform__row">
            <SelectField
              label={t("manage.staff.role")}
              name="role"
              value={role}
              onChange={(e) => setRole(e.target.value as CreateStaffInput["role"])}
            >
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {t("manage.staff.roleValue", { role: r })}
                </option>
              ))}
            </SelectField>
            <div>
              <SelectField
                label={t("manage.staff.clinic")}
                name="clinic_id"
                value={clinicId}
                aria-invalid={errors.clinic_id ? true : undefined}
                aria-describedby={errors.clinic_id ? "staff-clinic-error" : undefined}
                onChange={(e) => {
                  setClinicId(e.target.value);
                  setErrors(({ clinic_id: _gone, ...rest }) => rest);
                }}
              >
                <option value="">{t("manage.staff.clinicChoose")}</option>
                {clinics.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </SelectField>
              {errors.clinic_id && (
                <p className="emb-field__error" id="staff-clinic-error">
                  {t(errors.clinic_id)}
                </p>
              )}
            </div>
          </div>
          <div className="pform__actions">
            <Link to={backTo} className="emb-btn emb-btn--secondary">
              {t("common.cancel")}
            </Link>
            <Button type="submit" loading={save.isPending}>
              {t("manage.staff.create")}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
