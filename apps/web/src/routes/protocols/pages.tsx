/**
 * Protocols (design doc §5.4–5.5, journey T2): browse templates, build or
 * edit one, and assign a protocol to a patient (template → adjust → assign).
 */
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useIntl } from "react-intl";
import { ArrowLeft, Copy, FilePlus2, Pencil, Plus, Route as RouteIcon, Trash2 } from "lucide-react";
import type { StepInput, StepItem, TemplateDetail, TemplateSummary } from "@emb/contracts";
import { Alert, Button, Card, Chip, ConfirmDialog, EmptyState, MazeLoader, PageHeader, Segmented, SelectField, TextAreaField, TextField } from "@emb/ui";
import { ApiError } from "../../api/http.ts";
import { useAssign, useDeleteTemplate, useMe, usePatient, useSaveTemplate, useTemplate, useTemplates } from "../../api/queries.ts";
import { useAdminOrgs, useAdminClinics, type AdminOrg, type AdminClinic } from "../../api/admin.ts";
import { findGame, localText } from "../../games/registry.ts";
import { useT, usePrefs, type MessageId } from "../../i18n/index.tsx";
import { useClinic } from "../../lib/clinic.tsx";
import { calendarDate } from "../../lib/format.ts";
import { joinSteps } from "../../lib/steps.ts";
import { useTitle } from "../../lib/title.ts";
import { fullName, LoadError } from "../shared.tsx";
import { StepList, stepProblems } from "./steps.tsx";
import { NeedsConnection, useNeedsConnection } from "../../device/OfflineBanner.tsx";

type Plan = { name: string; description: string; weeks: number; sessions_per_week: number; setting: "clinic" | "home" | "mixed" };

function useGameNames() {
  const { locale } = usePrefs();
  return (ids: string[]) => ids.map((id) => (findGame(id) ? localText(findGame(id)!.manifest.name, locale) : id));
}

/** "Tunnel Rush → ▶ Colour shapes → Block Crasher": every step in order (ADR 0018). */
export function stepNames(x: { games: string[]; items?: StepItem[] }, names: (ids: string[]) => string[], locale: string) {
  if (!x.items) return names([...new Set(x.games)]).join(" · ");
  return joinSteps(x.items.map((i) => (i.kind === "video" ? `▶ ${i.title}` : names([i.game_id])[0]!)), locale);
}

function TemplateCard({ t: tpl, actions }: { t: TemplateSummary; actions?: ReactNode }) {
  const t = useT();
  const names = useGameNames();
  const { locale } = usePrefs();
  return (
    <li className="tplcard">
      <div className="tplcard__body">
        <p className="tplcard__name">{tpl.name}</p>
        <p className="app-muted">
          {t("protocols.plan", { weeks: tpl.weeks, perWeek: tpl.sessions_per_week })} · {t("builder.settingValue", { s: tpl.setting })}
        </p>
        <p className="tplcard__games">{stepNames(tpl, names, locale)}</p>
        <p className="app-muted tplcard__meta">
          <Chip>{t("protocols.visibility", { v: tpl.visibility })}</Chip>
          {tpl.owner_name && <span>{t("protocols.by", { name: tpl.owner_name })}</span>}
        </p>
      </div>
      {actions && <div className="tplcard__actions">{actions}</div>}
    </li>
  );
}

export function ProtocolsPage() {
  const t = useT();
  const { clinicId } = useClinic();
  const templates = useTemplates(clinicId);
  const remove = useDeleteTemplate();
  const [deleting, setDeleting] = useState<TemplateSummary | null>(null);
  const flash = useFlash();
  useTitle(t("nav.protocols"));

  const groups = useMemo(() => {
    const all = templates.data ?? [];
    return [
      { id: "mine", title: t("protocols.mine"), items: all.filter((x) => x.visibility === "private") },
      { id: "clinic", title: t("protocols.clinic"), items: all.filter((x) => x.visibility === "clinic") },
      { id: "platform", title: t("protocols.platform"), items: all.filter((x) => x.visibility === "platform") },
    ];
  }, [templates.data, t]);

  return (
    <div className="app-page">
      <PageHeader
        title={t("nav.protocols")}
        description={t("protocols.intro")}
        actions={
          <Link to="/protocols/new" className="emb-btn emb-btn--primary">
            <FilePlus2 size={20} aria-hidden="true" />
            <span>{t("protocols.new")}</span>
          </Link>
        }
      />
      {flash && (
        <div className="app-flash">
          <Alert tone="success">{flash}</Alert>
        </div>
      )}
      {templates.isPending ? (
        <MazeLoader label={t("common.loading")} />
      ) : templates.isError ? (
        <LoadError error={templates.error} retry={() => void templates.refetch()} />
      ) : (
        groups.map((g) => (
          <section key={g.id} className="tplgroup" aria-labelledby={`tpl-${g.id}`}>
            <h2 id={`tpl-${g.id}`} className="app-sectiontitle">
              {g.title}
            </h2>
            {g.items.length === 0 ? (
              <p className="app-muted">{t("protocols.empty")}</p>
            ) : (
              <ul className="tplgrid">
                {g.items.map((tpl) => (
                  <TemplateCard
                    key={tpl.id}
                    t={tpl}
                    actions={
                      <>
                        {tpl.can_edit && (
                          <Link to={`/protocols/${tpl.id}/edit`} className="emb-btn emb-btn--secondary" aria-label={`${t("common.edit")}: ${tpl.name}`}>
                            <Pencil size={18} aria-hidden="true" />
                            <span>{t("common.edit")}</span>
                          </Link>
                        )}
                        <Link to={`/protocols/new?from=${tpl.id}`} className="emb-btn emb-btn--ghost" aria-label={`${t("protocols.duplicate")}: ${tpl.name}`}>
                          <Copy size={18} aria-hidden="true" />
                          <span>{t("protocols.duplicate")}</span>
                        </Link>
                        {tpl.can_edit && (
                          <Button variant="ghost" icon={<Trash2 size={18} aria-hidden="true" />} aria-label={`${t("protocols.delete")}: ${tpl.name}`} onClick={() => setDeleting(tpl)}>
                            {t("protocols.delete")}
                          </Button>
                        )}
                      </>
                    }
                  />
                ))}
              </ul>
            )}
          </section>
        ))
      )}
      <ConfirmDialog
        open={!!deleting}
        title={t("protocols.delete.title", { name: deleting?.name ?? "" })}
        confirmLabel={t("protocols.delete")}
        cancelLabel={t("common.cancel")}
        tone="danger"
        busy={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
      >
        {t("protocols.delete.body")}
      </ConfirmDialog>
    </div>
  );
}

// ------------------------------------------------------------------ plan fields

function PlanFields({ plan, onChange, visibility }: { plan: Plan; onChange: (p: Plan) => void; visibility?: { value: "private" | "clinic"; onChange: (v: "private" | "clinic") => void } }) {
  const t = useT();
  return (
    <div className="pform">
      <TextField label={t("builder.name")} name="name" value={plan.name} maxLength={120} onChange={(e) => onChange({ ...plan, name: e.target.value })} />
      <TextAreaField label={t("builder.description")} hint={t("common.optional")} rows={2} maxLength={1000} value={plan.description} onChange={(e) => onChange({ ...plan, description: e.target.value })} />
      <div className="pform__row">
        <SelectField label={t("builder.weeks")} value={String(plan.weeks)} onChange={(e) => onChange({ ...plan, weeks: Number(e.target.value) })}>
          {Array.from({ length: 24 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </SelectField>
        <SelectField label={t("builder.perWeek")} value={String(plan.sessions_per_week)} onChange={(e) => onChange({ ...plan, sessions_per_week: Number(e.target.value) })}>
          {Array.from({ length: 7 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </SelectField>
      </div>
      <Segmented
        legend={t("builder.setting")}
        name="setting"
        value={plan.setting}
        onChange={(v) => onChange({ ...plan, setting: v })}
        options={(["clinic", "home", "mixed"] as const).map((s) => ({ value: s, label: t("builder.settingValue", { s }) }))}
      />
      {visibility && (
        <Segmented
          legend={t("builder.visibility")}
          name="visibility"
          value={visibility.value}
          onChange={visibility.onChange}
          options={(["private", "clinic"] as const).map((v) => ({ value: v, label: t("protocols.visibility", { v }) }))}
        />
      )}
    </div>
  );
}

const stripIds = (steps: TemplateDetail["steps"]): StepInput[] => steps.map(({ id: _i, ordinal: _o, ...s }) => s);

// ------------------------------------------------------------------ admin scope selector

type ScopeKind = "platform" | "org" | "clinic";
interface ScopeState {
  kind: ScopeKind;
  orgId: string | null;
  clinicId: string | null;
}

function ScopeSelector({ scope, onChange }: { scope: ScopeState; onChange: (s: ScopeState) => void }) {
  const t = useT();
  const orgs = useAdminOrgs();
  const clinics = useAdminClinics(scope.orgId ?? "");
  const [orgSearch, setOrgSearch] = useState("");
  const [clinicSearch, setClinicSearch] = useState("");

  const filteredOrgs = useMemo(() => {
    const list = orgs.data ?? [];
    if (!orgSearch.trim()) return list;
    const q = orgSearch.toLowerCase();
    return list.filter((o) => o.name.toLowerCase().includes(q));
  }, [orgs.data, orgSearch]);

  const filteredClinics = useMemo(() => {
    const list = clinics.data ?? [];
    if (!clinicSearch.trim()) return list;
    const q = clinicSearch.toLowerCase();
    return list.filter((c) => c.name.toLowerCase().includes(q));
  }, [clinics.data, clinicSearch]);

  return (
    <div className="scope-selector">
      <Segmented
        legend={t("builder.scope")}
        name="scope"
        value={scope.kind}
        onChange={(k) => onChange({ kind: k as ScopeKind, orgId: null, clinicId: null })}
        options={[
          { value: "platform", label: t("builder.scopePlatform") },
          { value: "org", label: t("builder.scopeOrg") },
          { value: "clinic", label: t("builder.scopeClinic") },
        ]}
      />
      {scope.kind !== "platform" && (
        <div className="scope-selector__dropdown">
          <label className="app-label">{t("builder.selectOrg")}</label>
          <input
            type="text"
            className="emb-input"
            placeholder={t("builder.searchOrg")}
            value={orgSearch}
            onChange={(e) => setOrgSearch(e.target.value)}
          />
          {orgs.isPending ? (
            <p className="app-muted">{t("common.loading")}</p>
          ) : (
            <select
              className="emb-select"
              value={scope.orgId ?? ""}
              onChange={(e) => {
                const v = e.target.value || null;
                onChange({ ...scope, orgId: v, clinicId: null });
                setClinicSearch("");
              }}
              size={Math.min(filteredOrgs.length + 1, 8)}
            >
              <option value="">{t("builder.selectOrg")}</option>
              {filteredOrgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      {scope.kind === "clinic" && scope.orgId && (
        <div className="scope-selector__dropdown">
          <label className="app-label">{t("builder.selectClinic")}</label>
          <input
            type="text"
            className="emb-input"
            placeholder={t("builder.searchClinic")}
            value={clinicSearch}
            onChange={(e) => setClinicSearch(e.target.value)}
          />
          {clinics.isPending ? (
            <p className="app-muted">{t("common.loading")}</p>
          ) : (
            <select
              className="emb-select"
              value={scope.clinicId ?? ""}
              onChange={(e) => onChange({ ...scope, clinicId: e.target.value || null })}
              size={Math.min(filteredClinics.length + 1, 8)}
            >
              <option value="">{t("builder.selectClinic")}</option>
              {filteredClinics.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ builder

export function TemplateBuilderPage() {
  const t = useT();
  const navigate = useNavigate();
  const { id } = useParams();
  const [q] = useSearchParams();
  const from = q.get("from");
  const source = useTemplate(id ?? from);
  const t2 = source.data;
  if ((id || from) && source.isPending) return <MazeLoader label={t("common.loading")} />;
  if ((id || from) && source.isError) return <LoadError error={source.error} retry={() => void source.refetch()} />;
  return <Builder key={id ?? from ?? "new"} existing={id ? t2 : undefined} copyOf={from ? t2 : undefined} onSaved={() => navigate("/protocols", { state: { flash: "saved" } })} />;
}

function Builder({ existing, copyOf, onSaved }: { existing?: TemplateDetail | undefined; copyOf?: TemplateDetail | undefined; onSaved: () => void }) {
  const offline = useNeedsConnection();
  const t = useT();
  const { clinicId } = useClinic();
  const me = useMe();
  const isAdmin = !!me.data?.is_platform_admin;
  const base = existing ?? copyOf;
  const save = useSaveTemplate(existing?.id);
  const [plan, setPlan] = useState<Plan>({
    name: copyOf ? t("protocols.copyOf", { name: copyOf.name }) : (base?.name ?? ""),
    description: base?.description ?? "",
    weeks: base?.weeks ?? 6,
    sessions_per_week: base?.sessions_per_week ?? 2,
    setting: base?.setting ?? "clinic",
  });
  const [visibility, setVisibility] = useState<"private" | "clinic">(existing && existing.visibility !== "platform" ? existing.visibility : "private");
  const [steps, setSteps] = useState<StepInput[]>(base ? stripIds(base.steps) : []);
  const [error, setError] = useState<MessageId | null>(null);

  // Admin scope: determines where the template is scoped to
  const initScope = (): ScopeState => {
    if (!isAdmin) return { kind: "clinic", orgId: null, clinicId: null };
    if (base) {
      if (base.clinic_id) return { kind: "clinic", orgId: base.organization_id, clinicId: base.clinic_id };
      if (base.organization_id) return { kind: "org", orgId: base.organization_id, clinicId: null };
      return { kind: "platform", orgId: null, clinicId: null };
    }
    return { kind: "platform", orgId: null, clinicId: null };
  };
  const [scope, setScope] = useState<ScopeState>(initScope);

  const title = existing ? t("builder.editTitle") : t("builder.newTitle");
  useTitle(title);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!plan.name.trim()) return setError("errors.fieldsInvalid");
    if (steps.length === 0 || stepProblems(steps).length) return setError("errors.fieldsInvalid");
    setError(null);
    try {
      if (isAdmin) {
        // Admin scope: derive clinic_id, organization_id and visibility from scope
        const effClinicId = scope.kind === "clinic" ? scope.clinicId : null;
        const effOrgId = scope.kind === "org" ? scope.orgId : null;
        const effVisibility = scope.kind === "clinic" ? visibility : "platform";
        await save.mutateAsync({ clinic_id: effClinicId, organization_id: effOrgId, ...plan, description: plan.description.trim() || null, visibility: effVisibility, steps });
      } else {
        await save.mutateAsync({ clinic_id: clinicId!, ...plan, description: plan.description.trim() || null, visibility, steps });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 400 ? "errors.fieldsInvalid" : err instanceof ApiError && err.status === 403 ? "errors.forbidden" : "errors.generic");
    }
  };

  return (
    <div className="app-page app-page--narrow">
      <Link to="/protocols" className="app-textlink app-back">
        <ArrowLeft size={18} aria-hidden="true" className="emb-flip-rtl" />
        {t("nav.protocols")}
      </Link>
      <PageHeader title={title} />
      <form className="builder" onSubmit={(e) => void submit(e)} noValidate>
        {error && <Alert tone="danger">{t(error)}</Alert>}
        {isAdmin && (
          <Card as="section" labelledBy="b-scope">
            <h2 id="b-scope" className="app-cardtitle">
              {t("builder.scope")}
            </h2>
            <ScopeSelector scope={scope} onChange={setScope} />
          </Card>
        )}
        <Card as="section" labelledBy="b-plan">
          <h2 id="b-plan" className="app-cardtitle">
            {t("builder.plan")}
          </h2>
          {scope.kind === "clinic" || !isAdmin ? (
            <PlanFields plan={plan} onChange={setPlan} visibility={{ value: visibility, onChange: setVisibility }} />
          ) : (
            <PlanFields plan={plan} onChange={setPlan} />
          )}
        </Card>
        <Card as="section" labelledBy="b-steps">
          <h2 id="b-steps" className="app-cardtitle">
            {t("builder.steps")}
          </h2>
          <p className="app-muted steps__hint">{t("builder.stepsHint")}</p>
          <StepList steps={steps} onChange={setSteps} />
        </Card>
        {offline && <NeedsConnection />}
        <div className="pform__actions">
          <Link to="/protocols" className="emb-btn emb-btn--secondary">
            {t("common.cancel")}
          </Link>
          <Button type="submit" size="lg" loading={save.isPending} disabled={offline}>
            {t("builder.save")}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ assign (T2)

export function AssignPage() {
  const t = useT();
  const { id = "" } = useParams();
  const patient = usePatient(id);
  const { clinicId } = useClinic();
  const templates = useTemplates(clinicId);
  const [chosen, setChosen] = useState<string | "blank" | null>(null);
  useTitle(t("assign.title"));
  if (patient.isPending || templates.isPending) return <MazeLoader label={t("common.loading")} />;
  if (patient.isError) return <LoadError error={patient.error} retry={() => void patient.refetch()} />;
  const p = patient.data;

  return (
    <div className="app-page app-page--narrow">
      <Link to={`/patients/${p.id}`} className="app-textlink app-back">
        <ArrowLeft size={18} aria-hidden="true" className="emb-flip-rtl" />
        <bdi>{fullName(p)}</bdi>
      </Link>
      <PageHeader title={t("assign.title")} eyebrow={<bdi>{fullName(p)}</bdi>} />
      {chosen === null ? (
        <Card as="section" labelledBy="a-choose">
          <h2 id="a-choose" className="app-cardtitle">
            {t("assign.choose")}
          </h2>
          <ul className="tplgrid tplgrid--single">
            {(templates.data ?? []).map((tpl) => (
              <TemplateCard
                key={tpl.id}
                t={tpl}
                actions={
                  <Button variant="secondary" onClick={() => setChosen(tpl.id)} aria-label={`${t("assign.use")}: ${tpl.name}`}>
                    {t("assign.use")}
                  </Button>
                }
              />
            ))}
          </ul>
          <Button variant="ghost" icon={<Plus size={18} aria-hidden="true" />} onClick={() => setChosen("blank")}>
            {t("assign.blank")}
          </Button>
        </Card>
      ) : (
        <AssignReview patientId={p.id} patientName={p.given_name} templateId={chosen === "blank" ? null : chosen} onBack={() => setChosen(null)} />
      )}
    </div>
  );
}

function AssignReview({ patientId, patientName, templateId, onBack }: { patientId: string; patientName: string; templateId: string | null; onBack: () => void }) {
  const tpl = useTemplate(templateId);
  const t = useT();
  if (templateId && tpl.isPending) return <MazeLoader label={t("common.loading")} />;
  if (templateId && tpl.isError) return <LoadError error={tpl.error} retry={() => void tpl.refetch()} />;
  return <AssignForm key={templateId ?? "blank"} patientId={patientId} patientName={patientName} template={tpl.data ?? null} onBack={onBack} />;
}

function AssignForm({ patientId, patientName, template, onBack }: { patientId: string; patientName: string; template: TemplateDetail | null; onBack: () => void }) {
  const offline = useNeedsConnection();
  const t = useT();
  const intl = useIntl();
  const navigate = useNavigate();
  const assign = useAssign(patientId);
  const [plan, setPlan] = useState<Plan>({
    name: template?.name ?? "",
    description: template?.description ?? "",
    weeks: template?.weeks ?? 6,
    sessions_per_week: template?.sessions_per_week ?? 2,
    setting: template?.setting ?? "clinic",
  });
  const [start, setStart] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [steps, setSteps] = useState<StepInput[]>(template ? stripIds(template.steps) : []);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!plan.name.trim() || steps.length === 0 || stepProblems(steps).length || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return setError(t("errors.fieldsInvalid"));
    setError(null);
    try {
      const a = await assign.mutateAsync({ template_id: template?.id ?? null, ...plan, description: plan.description.trim() || null, start_date: start, steps });
      const first = a.sessions[0]?.planned_date;
      navigate(`/patients/${patientId}`, {
        state: { flashText: t("assign.done", { date: first ? intl.formatDate(calendarDate(first), { weekday: "long", day: "numeric", month: "long" }) : "" }) },
      });
    } catch (err) {
      setError(err instanceof ApiError && err.code === "already_assigned" ? t("assign.already", { name: patientName }) : t("errors.generic"));
    }
  };

  return (
    <form className="builder" onSubmit={(e) => void submit(e)} noValidate>
      <Button variant="ghost" onClick={onBack} icon={<ArrowLeft size={18} aria-hidden="true" className="emb-flip-rtl" />}>
        {t("assign.back")}
      </Button>
      {error && <Alert tone="danger">{error}</Alert>}
      <Card as="section" labelledBy="a-review">
        <h2 id="a-review" className="app-cardtitle">
          {t("assign.review")}
        </h2>
        <p className="app-muted">{t("assign.reviewHint", { name: patientName })}</p>
        <div className="pform">
          <TextField label={t("assign.start")} type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          <PlanFields plan={plan} onChange={setPlan} />
        </div>
      </Card>
      <Card as="section" labelledBy="a-steps">
        <h2 id="a-steps" className="app-cardtitle">
          {t("builder.steps")}
        </h2>
        <StepList steps={steps} onChange={setSteps} />
      </Card>
      <div className="pform__actions">
        {offline && <NeedsConnection />}
        <Button type="submit" size="lg" loading={assign.isPending} disabled={offline} icon={<RouteIcon size={20} aria-hidden="true" />}>
          {t("assign.submit", { name: patientName })}
        </Button>
      </div>
    </form>
  );
}

/** Shows a one-off message handed over through navigation state (e.g. "Template saved."). */
export function useFlash(): string | null {
  const location = useLocation();
  const navigate = useNavigate();
  const t = useT();
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    const st = location.state as { flash?: string; flashText?: string } | null;
    if (!st) return;
    if (st.flashText) setFlash(st.flashText);
    else if (st.flash === "saved") setFlash(t("builder.saved"));
    navigate(location.pathname + location.search, { replace: true, state: null });
  }, [location.state, location.pathname, location.search, navigate, t]);
  return flash;
}

export function NoProtocolCard({ patientId }: { patientId: string }) {
  const t = useT();
  return (
    <Card as="section">
      <EmptyState
        icon={<RouteIcon size={28} aria-hidden="true" />}
        title={t("patient.protocol.title")}
        action={
          <Link to={`/patients/${patientId}/assign`} className="emb-btn emb-btn--primary">
            <Plus size={18} aria-hidden="true" />
            <span>{t("protocol.assign")}</span>
          </Link>
        }
      >
        {t("patient.protocol.body")}
      </EmptyState>
    </Card>
  );
}
