/**
 * One patient (design doc §5.3): a header that stays on every patient tab
 * (name, age, status, alerts), then Overview and Family & consent.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate, useOutletContext, useParams } from "react-router";
import { useIntl } from "react-intl";
import { ArchiveRestore, ArrowLeft, Archive, Mail, MoreHorizontal, Pencil, Plus, RefreshCw, Route as RouteIcon, ShieldCheck, SearchX, UserRound, Unlink, X } from "lucide-react";
import { guardianFields, CONSENT_PURPOSES, LOCALES, RELATIONSHIPS, type ConsentRequestView, type GuardianInput, type Locale, type Relationship } from "@emb/contracts";
import {
  Alert,
  Avatar,
  Button,
  Card,
  CheckboxField,
  Chip,
  ConfirmDialog,
  Disclosure,
  EmptyState,
  MazeLoader,
  SelectField,
  TabNav,
  TextField,
} from "@emb/ui";
import { ApiError } from "../../api/http.ts";
import { useArchivePatient, useCancelConsentRequest, usePatient, useRemoveGuardian, useRequestConsent, useResendConsentRequest, useSaveGuardian, type PatientDetail } from "../../api/queries.ts";
import { useT, usePrefs, type MessageId } from "../../i18n/index.tsx";
import { useClinic } from "../../lib/clinic.tsx";
import { calendarDate } from "../../lib/format.ts";
import { useTitle } from "../../lib/title.ts";
import { fullName, LoadError, StatusChip, useAge } from "../shared.tsx";
import { issuesToErrors } from "./form.tsx";
import { ProtocolCard } from "./protocol-card.tsx";

type Ctx = { patient: PatientDetail };
export const usePatientCtx = () => useOutletContext<Ctx>();

function BackLink() {
  const t = useT();
  return (
    <Link to="/patients" className="app-textlink app-back">
      <ArrowLeft size={18} aria-hidden="true" className="emb-flip-rtl" />
      {t("patient.back")}
    </Link>
  );
}

/** Header + tabs, shared by every patient tab. */
export function PatientLayout() {
  const t = useT();
  const { id = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const patient = usePatient(id);
  const age = useAge();
  const { isManager } = useClinic();
  const archive = useArchivePatient(id);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const p = patient.data;
  useTitle(p ? fullName(p) : t("patients.title"));

  // One-time message handed over by the page we came from ("Patient added").
  useEffect(() => {
    const st = location.state as { flash?: string; flashText?: string } | null;
    const f = st?.flash;
    if (f === "created") setFlash(t("patient.created"));
    else if (f === "saved") setFlash(t("patient.saved"));
    else if (st?.flashText) setFlash(st.flashText);
    if (st) navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate, t]);

  if (patient.isPending) return <MazeLoader label={t("common.loading")} />;
  if (patient.isError) {
    const notFound = patient.error instanceof ApiError && patient.error.status === 404;
    return (
      <div className="app-page">
        <BackLink />
        <h1 className="emb-vh">{t(notFound ? "patient.notFound.title" : "errors.generic")}</h1>
        {notFound ? (
          <Card>
            <EmptyState icon={<SearchX size={28} aria-hidden="true" />} title={t("patient.notFound.title")}>
              {t("patient.notFound.body")}
            </EmptyState>
          </Card>
        ) : (
          <LoadError error={patient.error} retry={() => void patient.refetch()} />
        )}
      </div>
    );
  }
  if (!p) return null;

  const base = `/patients/${p.id}`;
  const tabs = [
    { href: base, label: t("patient.tab.overview"), active: location.pathname === base },
    { href: `${base}/progress`, label: t("patient.tab.progress"), active: location.pathname === `${base}/progress` },
    { href: `${base}/family`, label: t("patient.tab.family"), active: location.pathname === `${base}/family` },
  ];

  return (
    <div className="app-page">
      <BackLink />
      {flash && (
        <div className="app-flash">
          <Alert tone="success">{flash}</Alert>
        </div>
      )}
      <header className="phead">
        <Avatar name={fullName(p)} size={64} />
        <div className="phead__text">
          <h1 className="phead__name">
            <bdi>{fullName(p)}</bdi>
          </h1>
          <p className="phead__meta">
            <span>{age(p.date_of_birth)}</span>
            <StatusChip status={p.status} />
          </p>
        </div>
        {!p.archived && (
          <div className="phead__actions">
            <Link to={`${base}/edit`} className="emb-btn emb-btn--secondary">
              <Pencil size={18} aria-hidden="true" />
              <span>{t("common.edit")}</span>
            </Link>
            {isManager && (
              <Disclosure label={t("patient.actions")} trigger={<MoreHorizontal size={22} aria-hidden="true" className="app-topbar__icon" />}>
                {(close) => (
                  <button
                    type="button"
                    className="emb-menuitem"
                    onClick={() => {
                      close();
                      setConfirmArchive(true);
                    }}
                  >
                    <Archive size={20} aria-hidden="true" />
                    {t("patient.archive")}
                  </button>
                )}
              </Disclosure>
            )}
          </div>
        )}
      </header>
      <div className="phead__notices">
        {p.archived && (
          <Alert
            tone="info"
            title={t("patient.archivedBanner")}
            action={
              isManager ? (
                <Button variant="secondary" icon={<ArchiveRestore size={18} aria-hidden="true" />} loading={archive.isPending} onClick={() => archive.mutate(false)}>
                  {t("patient.restore")}
                </Button>
              ) : undefined
            }
          />
        )}
        {p.alert && (
          <Alert tone="warning" title={t("patient.alert")}>
            {p.alert}
          </Alert>
        )}
        {!p.archived && (p.status === "pending_consent" || p.status === "consent_legacy") && (
          <Alert
            tone="info"
            title={t("patient.pending.title")}
            action={
              <Link to={`${base}/consent`} className="emb-btn emb-btn--primary">
                <ShieldCheck size={18} aria-hidden="true" />
                <span>{t("consent.record")}</span>
              </Link>
            }
          >
            {t("patient.pending.body")}
          </Alert>
        )}
      </div>
      <TabNav
        label={t("patient.tabs")}
        tabs={tabs}
        renderLink={({ href, className, children, ...rest }) => (
          <Link to={href} className={className} {...rest}>
            {children}
          </Link>
        )}
      />
      <Outlet context={{ patient: p } satisfies Ctx} />
      <ConfirmDialog
        open={confirmArchive}
        title={t("patient.archive.title", { name: fullName(p) })}
        confirmLabel={t("patient.archive")}
        cancelLabel={t("common.cancel")}
        busy={archive.isPending}
        onCancel={() => setConfirmArchive(false)}
        onConfirm={() =>
          archive.mutate(true, {
            onSuccess: () => {
              setConfirmArchive(false);
              navigate("/patients");
            },
          })
        }
      >
        {t("patient.archive.body")}
      </ConfirmDialog>
    </div>
  );
}

// ------------------------------------------------------------------ Overview

export function PatientOverview() {
  const t = useT();
  const intl = useIntl();
  const { patient: p } = usePatientCtx();
  const age = useAge();
  return (
    <div className="pgrid">
      <Card as="section" labelledBy="p-details">
        <h2 id="p-details" className="app-cardtitle">
          {t("patient.details")}
        </h2>
        <dl className="app-dl">
          <Row label={t("patient.dob")}>
            <span className="emb-tnum">{intl.formatDate(calendarDate(p.date_of_birth), { day: "numeric", month: "long", year: "numeric" })}</span>
          </Row>
          <Row label={t("patient.age")}>{age(p.date_of_birth)}</Row>
          <Row label={t("patient.status")}>
            <StatusChip status={p.status} />
          </Row>
          <Row label={t("patient.language")}>
            <span lang={p.preferred_locale}>{t(`language.${p.preferred_locale}`)}</span>
          </Row>
          <Row label={t("patient.sex")}>{p.sex ? t("patientForm.sexValue", { sex: p.sex }) : t("common.notSet")}</Row>
          <Row label={t("patient.handedness")}>{p.handedness ? t("patientForm.handValue", { hand: p.handedness }) : t("common.notSet")}</Row>
          <Row label={t("patient.cvd")}>{t("patient.cvdValue", { cvd: p.colour_vision_deficiency ? "yes" : "no" })}</Row>
        </dl>
      </Card>
      <div className="pstack">
        <ProtocolCard patientId={p.id} archived={p.archived} canPlay={p.can_play} />
        <Card as="section" labelledBy="p-team">
          <h2 id="p-team" className="app-cardtitle">
            {t("patient.careTeam")}
          </h2>
          <ul className="plainlist">
            {p.care_team.map((m) => (
              <li key={`${m.user_id}-${m.role}`} className="person">
                <Avatar name={m.full_name} size={36} />
                <span className="person__name">{m.full_name}</span>
                <Chip>{t("patient.careRole", { role: m.role })}</Chip>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// ------------------------------------------------------------------ Family & consent

export function PatientFamily() {
  const t = useT();
  const intl = useIntl();
  const { patient: p } = usePatientCtx();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [unlinking, setUnlinking] = useState<{ id: string; name: string } | null>(null);
  const [showConsentForm, setShowConsentForm] = useState(false);
  const [cancellingReq, setCancellingReq] = useState<ConsentRequestView | null>(null);
  const remove = useRemoveGuardian(p.id);
  const resend = useResendConsentRequest(p.id);
  const cancelReq = useCancelConsentRequest(p.id);
  const consents = new Map(p.consents.map((c) => [c.purpose, c]));
  const hasLegal = p.guardians.some((g) => g.is_legal_guardian);
  const anyConsent = p.consents.length > 0;
  const pendingReqs = p.consent_requests.filter((r) => r.status === "pending");
  const completedReqs = p.consent_requests.filter((r) => r.status !== "pending");

  return (
    <div className="pgrid pgrid--even">
      <Card as="section" labelledBy="p-guardians">
        <div className="app-cardrow">
          <h2 id="p-guardians" className="app-cardtitle">
            {t("family.guardians")}
          </h2>
          {!p.archived && editing === null && (
            <Button variant="secondary" icon={<Plus size={18} aria-hidden="true" />} onClick={() => setEditing("new")}>
              {t("family.addGuardian")}
            </Button>
          )}
        </div>
        {editing === "new" && <GuardianForm patientId={p.id} onDone={() => setEditing(null)} />}
        {p.guardians.length === 0 && editing !== "new" ? (
          <p className="app-muted">{t("family.noGuardians")}</p>
        ) : (
          <ul className="plainlist">
            {p.guardians.map((g) =>
              editing === g.id ? (
                <li key={g.id}>
                  <GuardianForm patientId={p.id} guardian={g} onDone={() => setEditing(null)} />
                </li>
              ) : (
                <li key={g.id} className="guardian">
                  <UserRound size={22} aria-hidden="true" className="guardian__icon" />
                  <div className="guardian__text">
                    <p className="guardian__name">
                      <bdi>{g.full_name}</bdi>
                      {g.is_legal_guardian && <Chip tone="brand">{t("guardian.legalChip")}</Chip>}
                    </p>
                    <p className="app-muted">
                      {t("guardian.relValue", { rel: g.relationship })}
                      {g.phone && (
                        <>
                          {" · "}
                          <bdi dir="ltr">{g.phone}</bdi>
                        </>
                      )}
                      {g.email && (
                        <>
                          {" · "}
                          <bdi dir="ltr">{g.email}</bdi>
                        </>
                      )}
                    </p>
                  </div>
                  {!p.archived && editing === null && (
                    <div className="guardian__actions">
                      <Button variant="ghost" icon={<Pencil size={18} aria-hidden="true" />} onClick={() => setEditing(g.id)} aria-label={t("family.editGuardian", { name: g.full_name })}>
                        {t("common.edit")}
                      </Button>
                      <Button variant="ghost" icon={<Unlink size={18} aria-hidden="true" />} onClick={() => setUnlinking({ id: g.id, name: g.full_name })}>
                        {t("guardian.unlink")}
                      </Button>
                    </div>
                  )}
                </li>
              ),
            )}
          </ul>
        )}
      </Card>

      <Card as="section" labelledBy="p-consent">
        <div className="app-cardrow">
          <h2 id="p-consent" className="app-cardtitle">
            {t("consent.title")}
          </h2>
          {!p.archived && hasLegal && (
            <Link to={`/patients/${p.id}/consent`} className={anyConsent ? "emb-btn emb-btn--secondary" : "emb-btn emb-btn--primary"}>
              <ShieldCheck size={18} aria-hidden="true" />
              <span>{t(anyConsent ? "consent.update" : "consent.record")}</span>
            </Link>
          )}
        </div>
        {!hasLegal && <p className="app-muted">{t("consentFlow.noLegal")}</p>}
        <ul className="consentlist">
          {CONSENT_PURPOSES.map((purpose) => {
            const c = consents.get(purpose);
            return (
              <li key={purpose} className="consentlist__item">
                <div>
                  <p className="consentlist__purpose">{t("consent.purpose", { purpose })}</p>
                  {c && (
                    <p className="app-muted">
                      {t("consent.by", {
                        guardian: c.guardian_name ?? c.signer_name ?? "",
                        date: intl.formatDate(new Date(c.signed_at), { day: "numeric", month: "short", year: "numeric" }),
                      })}
                    </p>
                  )}
                </div>
                <Chip tone={c?.decision === "granted" ? "success" : c?.decision === "withdrawn" ? "danger" : "neutral"}>{t("consent.state", { decision: c?.decision ?? "none" })}</Chip>
              </li>
            );
          })}
        </ul>
      </Card>

      {!p.archived && (
        <Card as="section" labelledBy="p-consentreq" className="pgrid__full">
          <div className="app-cardrow">
            <h2 id="p-consentreq" className="app-cardtitle">
              {t("consentReq.title")}
            </h2>
            {!showConsentForm && (
              <Button variant="secondary" icon={<Mail size={18} aria-hidden="true" />} onClick={() => setShowConsentForm(true)}>
                {t("consentReq.sendShort")}
              </Button>
            )}
          </div>
          {showConsentForm && (
            <ConsentRequestForm patientId={p.id} guardians={p.guardians} onDone={() => setShowConsentForm(false)} />
          )}
          {pendingReqs.length > 0 && (
            <ul className="plainlist">
              {pendingReqs.map((r) => (
                <li key={r.id} className="consentreq">
                  <Mail size={20} aria-hidden="true" className="consentreq__icon" />
                  <div className="consentreq__text">
                    <p className="consentreq__name">
                      <bdi>{r.guardian_name}</bdi>
                      <Chip tone="warning">{t("consentReq.pending")}</Chip>
                    </p>
                    <p className="app-muted">
                      <bdi dir="ltr">{r.guardian_email}</bdi>
                      {" · "}
                      {t("consentReq.sentAt", { date: intl.formatDate(new Date(r.sent_at), { day: "numeric", month: "short" }) })}
                    </p>
                  </div>
                  <div className="consentreq__actions">
                    <Button variant="ghost" icon={<RefreshCw size={16} aria-hidden="true" />} loading={resend.isPending} onClick={() => resend.mutate(r.id)}>
                      {t("consentReq.resend")}
                    </Button>
                    <Button variant="ghost" icon={<X size={16} aria-hidden="true" />} onClick={() => setCancellingReq(r)}>
                      {t("consentReq.cancel")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {completedReqs.length > 0 && (
            <ul className="plainlist">
              {completedReqs.map((r) => (
                <li key={r.id} className="consentreq consentreq--done">
                  <Mail size={20} aria-hidden="true" className="consentreq__icon" />
                  <div className="consentreq__text">
                    <p className="consentreq__name">
                      <bdi>{r.guardian_name}</bdi>
                      <Chip tone={r.status === "completed" ? "success" : "neutral"}>{t(`consentReq.${r.status}`)}</Chip>
                    </p>
                    <p className="app-muted">
                      <bdi dir="ltr">{r.guardian_email}</bdi>
                      {r.completed_at && (
                        <>
                          {" · "}
                          {t("consentReq.completedAt", { date: intl.formatDate(new Date(r.completed_at), { day: "numeric", month: "short" }) })}
                        </>
                      )}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {p.consent_requests.length === 0 && !showConsentForm && (
            <p className="app-muted">{t("consentReq.noEmail")}</p>
          )}
        </Card>
      )}

      <ConfirmDialog
        open={!!cancellingReq}
        title={t("consentReq.cancel.title")}
        confirmLabel={t("consentReq.cancel")}
        cancelLabel={t("common.cancel")}
        tone="danger"
        busy={cancelReq.isPending}
        onCancel={() => setCancellingReq(null)}
        onConfirm={() => cancellingReq && cancelReq.mutate(cancellingReq.id, { onSuccess: () => setCancellingReq(null) })}
      >
        {t("consentReq.cancel.body")}
      </ConfirmDialog>

      <ConfirmDialog
        open={!!unlinking}
        title={t("guardian.unlink.title", { name: unlinking?.name ?? "" })}
        confirmLabel={t("guardian.unlink")}
        cancelLabel={t("common.cancel")}
        tone="danger"
        busy={remove.isPending}
        onCancel={() => setUnlinking(null)}
        onConfirm={() => unlinking && remove.mutate(unlinking.id, { onSuccess: () => setUnlinking(null) })}
      >
        {t("guardian.unlink.body")}
      </ConfirmDialog>
    </div>
  );
}

function GuardianForm({ patientId, guardian, onDone }: { patientId: string; guardian?: PatientDetail["guardians"][number]; onDone: () => void }) {
  const t = useT();
  const { locale } = usePrefs();
  const save = useSaveGuardian(patientId);
  const [g, setG] = useState({
    full_name: guardian?.full_name ?? "",
    relationship: (guardian?.relationship ?? "mother") as Relationship,
    is_legal_guardian: guardian?.is_legal_guardian ?? true,
    phone: guardian?.phone ?? "",
    email: guardian?.email ?? "",
    preferred_locale: (guardian?.preferred_locale ?? locale) as Locale,
  });
  const [errors, setErrors] = useState<Partial<Record<string, MessageId>>>({});
  const set = <K extends keyof typeof g>(k: K, v: (typeof g)[K]) => {
    setG((x) => ({ ...x, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined, form: undefined }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: GuardianInput = { ...g, phone: g.phone.trim() || null, email: g.email.trim() || null };
    const parsed = guardianFields.safeParse(body);
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues) as Record<string, MessageId>);
      return;
    }
    try {
      await save.mutateAsync({ ...(guardian ? { guardianId: guardian.id } : {}), body: parsed.data });
      onDone();
    } catch (err) {
      setErrors({ form: err instanceof ApiError && err.status === 400 ? "errors.fieldsInvalid" : "errors.generic" });
    }
  };

  return (
    <form className="gform" onSubmit={(e) => void submit(e)} noValidate aria-label={guardian ? t("family.editGuardian", { name: guardian.full_name }) : t("family.addGuardian")}>
      {errors.form && <Alert tone="danger">{t(errors.form)}</Alert>}
      <TextField label={t("guardian.fullName")} name="guardian_name" autoComplete="off" value={g.full_name} onChange={(e) => set("full_name", e.target.value)} error={errors.full_name ? t(errors.full_name) : undefined} />
      <div className="pform__row">
        <SelectField label={t("guardian.relationship")} name="relationship" value={g.relationship} onChange={(e) => set("relationship", e.target.value as Relationship)}>
          {RELATIONSHIPS.map((r) => (
            <option key={r} value={r}>
              {t("guardian.relValue", { rel: r })}
            </option>
          ))}
        </SelectField>
        <SelectField label={t("guardian.language")} name="guardian_locale" value={g.preferred_locale} onChange={(e) => set("preferred_locale", e.target.value as Locale)}>
          {LOCALES.map((l) => (
            <option key={l} value={l} lang={l}>
              {t(`language.${l}`)}
            </option>
          ))}
        </SelectField>
      </div>
      <div className="pform__row">
        <TextField label={t("guardian.phone")} name="phone" type="tel" inputMode="tel" autoComplete="off" dir="ltr" value={g.phone} onChange={(e) => set("phone", e.target.value)} error={errors.phone ? t(errors.phone) : undefined} />
        <TextField label={t("guardian.email")} name="email" type="email" inputMode="email" autoComplete="off" dir="ltr" value={g.email} onChange={(e) => set("email", e.target.value)} error={errors.email ? t(errors.email) : undefined} />
      </div>
      <CheckboxField label={t("guardian.legal")} checked={g.is_legal_guardian} onChange={(e) => set("is_legal_guardian", e.target.checked)} />
      <div className="pform__actions">
        <Button variant="secondary" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" loading={save.isPending}>
          {guardian ? t("common.save") : t("guardian.add")}
        </Button>
      </div>
    </form>
  );
}

function ConsentRequestForm({ patientId, guardians, onDone }: { patientId: string; guardians: PatientDetail["guardians"]; onDone: () => void }) {
  const t = useT();
  const { locale } = usePrefs();
  const send = useRequestConsent(patientId);
  const [g, setG] = useState({
    full_name: "",
    email: "",
    phone: "",
    relationship: "mother" as Relationship,
    preferred_locale: locale as Locale,
  });
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [prefill, setPrefill] = useState("");
  const set = <K extends keyof typeof g>(k: K, v: (typeof g)[K]) => {
    setG((x) => ({ ...x, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined, form: undefined }));
  };

  const handlePrefill = (guardianId: string) => {
    setPrefill(guardianId);
    const found = guardians.find((x) => x.id === guardianId);
    if (found) {
      setG({
        full_name: found.full_name,
        email: found.email ?? "",
        phone: found.phone ?? "",
        relationship: found.relationship,
        preferred_locale: found.preferred_locale,
      });
      setErrors({});
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!g.full_name.trim()) errs.full_name = "required";
    if (!g.email.trim()) errs.email = "required";
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    try {
      await send.mutateAsync({
        guardians: [{
          full_name: g.full_name.trim(),
          email: g.email.trim(),
          relationship: g.relationship,
          phone: g.phone.trim() || null,
          preferred_locale: g.preferred_locale,
        }],
      });
      onDone();
    } catch (err) {
      setErrors({ form: err instanceof ApiError && err.status === 400 ? "errors.fieldsInvalid" : "errors.generic" });
    }
  };

  const legalGuardians = guardians.filter((x) => x.is_legal_guardian && x.email);

  return (
    <form className="gform" onSubmit={(e) => void submit(e)} noValidate aria-label={t("consentReq.formTitle")}>
      <p className="app-muted">{t("consentReq.formHint")}</p>
      {errors.form && <Alert tone="danger">{t(errors.form as MessageId)}</Alert>}
      {legalGuardians.length > 0 && (
        <SelectField label={t("consentReq.guardianName")} name="prefill" value={prefill} onChange={(e) => handlePrefill(e.target.value)}>
          <option value="">{t("consentReq.guardianName")}</option>
          {legalGuardians.map((x) => (
            <option key={x.id} value={x.id}>{x.full_name}</option>
          ))}
        </SelectField>
      )}
      <TextField label={t("consentReq.guardianName")} name="consent_name" autoComplete="off" value={g.full_name} onChange={(e) => set("full_name", e.target.value)} error={errors.full_name ? t("errors.required") : undefined} />
      <TextField label={t("consentReq.guardianEmail")} name="consent_email" type="email" inputMode="email" autoComplete="off" dir="ltr" value={g.email} onChange={(e) => set("email", e.target.value)} error={errors.email ? t("errors.required") : undefined} />
      <div className="pform__row">
        <TextField label={t("consentReq.guardianPhone")} name="consent_phone" type="tel" inputMode="tel" autoComplete="off" dir="ltr" value={g.phone} onChange={(e) => set("phone", e.target.value)} />
        <SelectField label={t("consentReq.relationship")} name="consent_rel" value={g.relationship} onChange={(e) => set("relationship", e.target.value as Relationship)}>
          {RELATIONSHIPS.map((r) => (
            <option key={r} value={r}>{t("guardian.relValue", { rel: r })}</option>
          ))}
        </SelectField>
      </div>
      <SelectField label={t("consentReq.language")} name="consent_locale" value={g.preferred_locale} onChange={(e) => set("preferred_locale", e.target.value as Locale)}>
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>{t(`language.${l}`)}</option>
        ))}
      </SelectField>
      <div className="pform__actions">
        <Button variant="secondary" onClick={onDone}>{t("common.cancel")}</Button>
        <Button type="submit" loading={send.isPending} icon={<Mail size={18} aria-hidden="true" />}>{t("consentReq.sendShort")}</Button>
      </div>
    </form>
  );
}
