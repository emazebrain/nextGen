/**
 * Add or edit a patient (design doc §5.3): name and date of birth are enough;
 * everything else is optional and tucked under "More details". The same zod
 * schema the API uses checks the form before it is sent.
 */
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft } from "lucide-react";
import { createPatient, LOCALES, SEXES, HANDEDNESS, type CreatePatient, type Locale } from "@emb/contracts";
import { Alert, Button, Card, CheckboxField, MazeLoader, PageHeader, SelectField, TextAreaField, TextField } from "@emb/ui";
import { ApiError } from "../../api/http.ts";
import { useCreatePatient, useMe, usePatient, useStaff, useUpdatePatient, type PatientDetail } from "../../api/queries.ts";
import { useT, usePrefs, type MessageId } from "../../i18n/index.tsx";
import { useClinic } from "../../lib/clinic.tsx";
import { useTitle } from "../../lib/title.ts";
import { fullName, LoadError } from "../shared.tsx";
import { NeedsConnection, useNeedsConnection } from "../../device/OfflineBanner.tsx";

type Draft = {
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

const messageFor = (path: string): MessageId =>
  path === "date_of_birth" ? "errors.dob" : path === "email" ? "errors.email" : path === "phone" ? "errors.phone" : "errors.required";

export function issuesToErrors(issues: Array<{ path: string | PropertyKey[] }>): Errors {
  const out: Errors = {};
  for (const i of issues) {
    const path = Array.isArray(i.path) ? String(i.path[0] ?? "") : String(i.path).split(".")[0]!;
    if (path && !(path in out)) (out as Record<string, MessageId>)[path] = messageFor(path);
  }
  return out;
}

export function NewPatientPage() {
  return <PatientFormPage />;
}

export function EditPatientPage() {
  const { id = "" } = useParams();
  const patient = usePatient(id);
  const t = useT();
  if (patient.isPending) return <MazeLoader label={t("common.loading")} />;
  if (patient.isError) return <LoadError error={patient.error} retry={() => void patient.refetch()} />;
  return <PatientFormPage existing={patient.data} />;
}

function PatientFormPage({ existing }: { existing?: PatientDetail }) {
  const offline = useNeedsConnection();
  const t = useT();
  const navigate = useNavigate();
  const { locale } = usePrefs();
  const { clinicId, isManager } = useClinic();
  const me = useMe();
  const staff = useStaff(clinicId, isManager && !existing);
  const create = useCreatePatient();
  const update = useUpdatePatient(existing?.id ?? "");
  const [errors, setErrors] = useState<Errors>({});
  const [duplicate, setDuplicate] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => ({
    given_name: existing?.given_name ?? "",
    family_name: existing?.family_name ?? "",
    date_of_birth: existing?.date_of_birth ?? "",
    preferred_locale: existing?.preferred_locale ?? (locale as Locale),
    sex: existing?.sex ?? "",
    handedness: existing?.handedness ?? "",
    alert: existing?.alert ?? "",
    colour_vision_deficiency: existing?.colour_vision_deficiency ?? false,
    therapist_id: "",
  }));
  const title = existing ? t("patientForm.editTitle") : t("patientForm.newTitle");
  useTitle(title);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
    if (duplicate && (k === "given_name" || k === "family_name" || k === "date_of_birth")) setDuplicate(false);
  };

  const therapists = (staff.data ?? []).filter((s) => s.roles.includes("therapist"));
  // Managers pick the primary therapist: themselves if they also treat patients, else the first therapist.
  const chosenTherapist = isManager && !existing
    ? draft.therapist_id || (therapists.some((s) => s.id === me.data?.user.id) ? me.data!.user.id : (therapists[0]?.id ?? ""))
    : "";
  const busy = create.isPending || update.isPending;

  const submit = async (e: FormEvent, allowDuplicate = false) => {
    e.preventDefault();
    const body: CreatePatient = {
      clinic_id: existing?.clinic_id ?? clinicId ?? "",
      given_name: draft.given_name,
      family_name: draft.family_name,
      date_of_birth: draft.date_of_birth,
      preferred_locale: draft.preferred_locale,
      sex: (draft.sex || null) as CreatePatient["sex"],
      handedness: (draft.handedness || null) as CreatePatient["handedness"],
      alert: draft.alert.trim() || null,
      colour_vision_deficiency: draft.colour_vision_deficiency,
      ...(chosenTherapist ? { therapist_id: chosenTherapist } : {}),
      ...(allowDuplicate ? { allow_duplicate: true } : {}),
    };
    const parsed = createPatient.safeParse(body);
    if (!parsed.success) {
      setErrors({ ...issuesToErrors(parsed.error.issues), form: "errors.fieldsInvalid" });
      requestAnimationFrame(() => (document.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus());
      return;
    }
    setErrors({});
    try {
      if (existing) {
        const { clinic_id: _c, therapist_id: _t, allow_duplicate: _a, ...patch } = parsed.data;
        await update.mutateAsync(patch);
        navigate(`/patients/${existing.id}`, { state: { flash: "saved" } });
      } else {
        const { id } = await create.mutateAsync(parsed.data);
        navigate(`/patients/${id}`, { state: { flash: "created" } });
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "possible_duplicate") setDuplicate(true);
      else if (err instanceof ApiError && err.status === 400) setErrors({ ...issuesToErrors(err.issues), form: "errors.fieldsInvalid" });
      else if (err instanceof ApiError && err.status === 403) setErrors({ form: "errors.forbidden" });
      else setErrors({ form: err instanceof ApiError && err.status === 0 ? "errors.network" : "errors.generic" });
    }
  };

  const err = (k: keyof Draft) => (errors[k] ? t(errors[k]!) : undefined);
  const backTo = existing ? `/patients/${existing.id}` : "/patients";

  return (
    <div className="app-page app-page--narrow">
      <Link to={backTo} className="app-textlink app-back">
        <ArrowLeft size={18} aria-hidden="true" className="emb-flip-rtl" />
        {existing ? <bdi>{fullName(existing)}</bdi> : t("patient.back")}
      </Link>
      <PageHeader title={title} description={existing ? undefined : t("patientForm.intro")} />
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
          {isManager && !existing && (
            <SelectField label={t("patientForm.therapist")} name="therapist_id" value={chosenTherapist} onChange={(e) => set("therapist_id", e.target.value)}>
              {therapists.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                </option>
              ))}
            </SelectField>
          )}
          <details className="pform__more" open={!!existing}>
            <summary>{t("patientForm.more")}</summary>
            <div className="pform__moreBody">
              <div className="pform__row">
                <SelectField label={t("patientForm.sex")} name="sex" value={draft.sex} onChange={(e) => set("sex", e.target.value)}>
                  <option value="">{t("common.notSet")}</option>
                  {SEXES.map((s) => (
                    <option key={s} value={s}>
                      {t("patientForm.sexValue", { sex: s })}
                    </option>
                  ))}
                </SelectField>
                <SelectField label={t("patientForm.handedness")} name="handedness" value={draft.handedness} onChange={(e) => set("handedness", e.target.value)}>
                  <option value="">{t("common.notSet")}</option>
                  {HANDEDNESS.map((h) => (
                    <option key={h} value={h}>
                      {t("patientForm.handValue", { hand: h })}
                    </option>
                  ))}
                </SelectField>
              </div>
              <TextAreaField label={t("patientForm.alert")} hint={t("patientForm.alertHint")} name="alert" maxLength={500} rows={2} value={draft.alert} onChange={(e) => set("alert", e.target.value)} />
              <CheckboxField label={t("patientForm.cvd")} hint={t("patientForm.cvdHint")} checked={draft.colour_vision_deficiency} onChange={(e) => set("colour_vision_deficiency", e.target.checked)} />
            </div>
          </details>
          <div className="pform__actions">
            <Link to={backTo} className="emb-btn emb-btn--secondary">
              {t("common.cancel")}
            </Link>
            {offline && <NeedsConnection />}
            <Button type="submit" loading={busy} disabled={offline}>
              {existing ? t("patientForm.submitEdit") : t("patientForm.submitNew")}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
