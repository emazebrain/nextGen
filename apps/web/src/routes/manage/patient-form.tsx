/** Org admin patient creation form — the admin picks a clinic and optionally a therapist. */
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { LOCALES, SEXES, HANDEDNESS, type Locale } from "@emb/contracts";
import { Alert, Button, Card, CheckboxField, MazeLoader, PageHeader, SelectField, TextAreaField, TextField } from "@emb/ui";
import { ApiError } from "../../api/http.ts";
import {
  createOrgPatient,
  listOrgStaff,
  useOrgClinics,
  useOrgMutation,
  type OrgStaff,
  type CreateOrgPatientInput,
} from "../../api/org.ts";
import { useT, usePrefs, type MessageId } from "../../i18n/index.tsx";
import { useTitle } from "../../lib/title.ts";
import { BackLink, NoticeBar, useFlash, saveError } from "./common.tsx";
import { useQuery } from "@tanstack/react-query";

type Draft = {
  clinic_id: string;
  given_name: string;
  family_name: string;
  date_of_birth: string;
  preferred_locale: Locale;
  sex: string;
  handedness: string;
  alert: string;
  colour_vision_deficiency: boolean;
  therapist_id: string;
};
type Errors = Partial<Record<keyof Draft | "form", MessageId>>;

export function ManagePatientFormPage() {
  const t = useT();
  const navigate = useNavigate();
  const { locale } = usePrefs();
  const [notice] = useFlash();
  const clinics = useOrgClinics();
  useTitle(t("manage.patients.newTitle"));

  if (clinics.isPending) return <MazeLoader label={t("common.loading")} />;

  return <PatientFormInner clinics={clinics.data ?? []} locale={locale} />;
}

function PatientFormInner({
  clinics,
  locale,
}: {
  clinics: Array<{ id: string; name: string }>;
  locale: string;
}) {
  const t = useT();
  const navigate = useNavigate();
  const mutation = useOrgMutation(createOrgPatient);
  const [errors, setErrors] = useState<Errors>({});
  const [duplicate, setDuplicate] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => ({
    clinic_id: clinics[0]?.id ?? "",
    given_name: "",
    family_name: "",
    date_of_birth: "",
    preferred_locale: (locale as Locale) ?? "en",
    sex: "",
    handedness: "",
    alert: "",
    colour_vision_deficiency: false,
    therapist_id: "",
  }));

  // Load therapists for the selected clinic
  const therapists = useQuery({
    queryKey: ["org", "staff", { clinic_id: draft.clinic_id, role: "therapist" }],
    queryFn: async ({ signal }) => {
      if (!draft.clinic_id) return [];
      const staff = await listOrgStaff({ clinic_id: draft.clinic_id }, signal);
      return staff.filter((s: OrgStaff) =>
        (s.memberships ?? []).some((m) => m.clinic_id === draft.clinic_id && (m.role === "therapist" || m.role === "clinic_manager")),
      );
    },
    enabled: !!draft.clinic_id,
  });

  const busy = mutation.isPending;

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
    if (duplicate && (k === "given_name" || k === "family_name" || k === "date_of_birth")) setDuplicate(false);
    // Reset therapist when clinic changes
    if (k === "clinic_id") setDraft((d) => ({ ...d, clinic_id: v as string, therapist_id: "" }));
  };

  const submit = async (e: FormEvent, allowDuplicate = false) => {
    e.preventDefault();
    const errs: Errors = {};
    if (!draft.clinic_id) errs.clinic_id = "errors.required";
    if (!draft.given_name.trim()) errs.given_name = "errors.required";
    if (!draft.family_name.trim()) errs.family_name = "errors.required";
    if (!draft.date_of_birth) errs.date_of_birth = "errors.required";
    if (Object.keys(errs).length) {
      setErrors({ ...errs, form: "errors.fieldsInvalid" });
      requestAnimationFrame(() => (document.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus());
      return;
    }

    const body: CreateOrgPatientInput = {
      clinic_id: draft.clinic_id,
      given_name: draft.given_name.trim(),
      family_name: draft.family_name.trim(),
      date_of_birth: draft.date_of_birth,
      preferred_locale: draft.preferred_locale,
      sex: draft.sex || null,
      handedness: draft.handedness || null,
      alert: draft.alert.trim() || null,
      colour_vision_deficiency: draft.colour_vision_deficiency,
      ...(draft.therapist_id ? { therapist_id: draft.therapist_id } : {}),
      ...(allowDuplicate ? { allow_duplicate: true } : {}),
    };

    try {
      const { id } = await mutation.mutateAsync(body);
      navigate("/manage/patients", {
        state: { flash: { tone: "success", text: t("manage.patients.created") } },
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === "possible_duplicate") setDuplicate(true);
      else setErrors({ form: saveError(err) });
    }
  };

  const err = (k: keyof Draft) => (errors[k] ? t(errors[k]!) : undefined);

  return (
    <div className="app-page app-page--narrow">
      <BackLink to="/manage/patients">{t("manage.patients.title")}</BackLink>
      <PageHeader title={t("manage.patients.newTitle")} description={t("manage.patients.newIntro")} />
      <Card>
        <form className="pform" onSubmit={(e) => void submit(e)} noValidate>
          {errors.form && <Alert tone="danger">{t(errors.form)}</Alert>}
          {duplicate && (
            <Alert
              tone="warning"
              title={t("patientForm.duplicate.title")}
              action={
                <Button variant="secondary" onClick={(e) => void submit(e as unknown as FormEvent, true)} loading={busy}>
                  {t("patientForm.duplicate.action")}
                </Button>
              }
            >
              {t("patientForm.duplicate.body")}
            </Alert>
          )}

          <SelectField
            label={t("manage.patients.clinic")}
            name="clinic_id"
            value={draft.clinic_id}
            onChange={(e) => set("clinic_id", e.target.value)}
          >
            {clinics.length === 0 && <option value="">{t("manage.patients.noClinic")}</option>}
            {clinics.map((cl) => (
              <option key={cl.id} value={cl.id}>{cl.name}</option>
            ))}
          </SelectField>

          <div className="pform__row">
            <TextField label={t("patientForm.givenName")} name="given_name" autoComplete="off" value={draft.given_name} onChange={(e) => set("given_name", e.target.value)} error={err("given_name")} />
            <TextField label={t("patientForm.familyName")} name="family_name" autoComplete="off" value={draft.family_name} onChange={(e) => set("family_name", e.target.value)} error={err("family_name")} />
          </div>
          <div className="pform__row">
            <TextField
              label={t("patientForm.dob")}
              name="date_of_birth"
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              value={draft.date_of_birth}
              onChange={(e) => set("date_of_birth", e.target.value)}
              error={err("date_of_birth")}
            />
            <SelectField label={t("patientForm.language")} name="preferred_locale" value={draft.preferred_locale} onChange={(e) => set("preferred_locale", e.target.value as Locale)}>
              {LOCALES.map((l) => (
                <option key={l} value={l} lang={l}>
                  {t(`language.${l}`)}
                </option>
              ))}
            </SelectField>
          </div>

          {(therapists.data ?? []).length > 0 && (
            <SelectField
              label={t("manage.patients.therapist")}
              name="therapist_id"
              value={draft.therapist_id}
              onChange={(e) => set("therapist_id", e.target.value)}
            >
              <option value="">{t("manage.patients.therapistDefault")}</option>
              {(therapists.data ?? []).map((s: OrgStaff) => (
                <option key={s.id} value={s.id}>{s.full_name}</option>
              ))}
            </SelectField>
          )}

          <details className="pform__more">
            <summary>{t("patientForm.more")}</summary>
            <div className="pform__moreBody">
              <div className="pform__row">
                <SelectField label={t("patientForm.sex")} name="sex" value={draft.sex} onChange={(e) => set("sex", e.target.value)}>
                  <option value="">{t("common.notSet")}</option>
                  {SEXES.map((s) => (
                    <option key={s} value={s}>{t("patientForm.sexValue", { sex: s })}</option>
                  ))}
                </SelectField>
                <SelectField label={t("patientForm.handedness")} name="handedness" value={draft.handedness} onChange={(e) => set("handedness", e.target.value)}>
                  <option value="">{t("common.notSet")}</option>
                  {HANDEDNESS.map((h) => (
                    <option key={h} value={h}>{t("patientForm.handValue", { hand: h })}</option>
                  ))}
                </SelectField>
              </div>
              <TextAreaField label={t("patientForm.alert")} hint={t("patientForm.alertHint")} name="alert" maxLength={500} rows={2} value={draft.alert} onChange={(e) => set("alert", e.target.value)} />
              <CheckboxField label={t("patientForm.cvd")} hint={t("patientForm.cvdHint")} checked={draft.colour_vision_deficiency} onChange={(e) => set("colour_vision_deficiency", e.target.checked)} />
            </div>
          </details>

          <div className="pform__actions">
            <Link to="/manage/patients" className="emb-btn emb-btn--secondary">
              {t("common.cancel")}
            </Link>
            <Button type="submit" loading={busy}>
              {t("manage.patients.submitNew")}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
