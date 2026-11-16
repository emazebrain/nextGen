/** Create or edit an organization (system admin spec). The region is chosen once: it is where the data lives. */
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Alert, Button, Card, MazeLoader, PageHeader, SelectField, TextField } from "@emb/ui";
import { ORG_LOCALES, REGIONS, createOrganization, patchOrganization, useAdminMutation, useAdminOrg, type AdminOrg, type OrgLocale, type Region } from "../../api/admin.ts";
import { useT, type MessageId } from "../../i18n/index.tsx";
import { useTitle } from "../../lib/title.ts";
import { LoadError } from "../shared.tsx";
import { BackLink, saveError } from "./common.tsx";

export function OrgFormPage() {
  const t = useT();
  const { id } = useParams();
  const existing = useAdminOrg(id ?? "", !!id);
  if (id && existing.isPending) return <MazeLoader label={t("common.loading")} />;
  if (id && existing.isError) return <LoadError error={existing.error} retry={() => void existing.refetch()} />;
  return <OrgForm {...(id && existing.data ? { existing: existing.data.organization } : {})} />;
}

function OrgForm({ existing }: { existing?: AdminOrg }) {
  const t = useT();
  const navigate = useNavigate();
  const [name, setName] = useState(existing?.name ?? "");
  const [region, setRegion] = useState<Region>(existing?.region ?? "il");
  const [locale, setLocale] = useState<OrgLocale>(existing?.default_locale ?? "he");
  const [nameError, setNameError] = useState(false);
  const [error, setError] = useState<MessageId | null>(null);
  const save = useAdminMutation(() =>
    existing ? patchOrganization(existing.id, { name: name.trim(), default_locale: locale }) : createOrganization({ name: name.trim(), region, default_locale: locale }),
  );
  const title = existing ? t("admin.organizations.edit") : t("admin.organizations.new");
  useTitle(title);
  const backTo = existing ? `/admin/organizations/${existing.id}` : "/admin/organizations";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setNameError(true);
      requestAnimationFrame(() => (document.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus());
      return;
    }
    try {
      const org = await save.mutateAsync(undefined);
      navigate(`/admin/organizations/${org.id}`, { state: { flash: { tone: "success", text: t(existing ? "admin.organizations.saved" : "admin.organizations.created") } } });
    } catch (err) {
      setError(saveError(err));
    }
  };

  return (
    <div className="app-page app-page--narrow">
      <BackLink to={backTo}>{existing ? <bdi>{existing.name}</bdi> : t("admin.organizations.back")}</BackLink>
      <PageHeader title={title} />
      <Card>
        <form className="pform" onSubmit={(e) => void submit(e)} noValidate>
          {error && <Alert tone="danger">{t(error)}</Alert>}
          <TextField
            label={t("admin.organizations.name")}
            name="name"
            autoComplete="off"
            maxLength={255}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(false);
            }}
            error={nameError ? t("errors.required") : undefined}
          />
          <div className="pform__row">
            <div>
              <SelectField label={t("admin.organizations.region")} name="region" value={region} disabled={!!existing} aria-describedby="org-region-hint" onChange={(e) => setRegion(e.target.value as Region)}>
                {REGIONS.map((r) => (
                  <option key={r} value={r}>
                    {t("admin.organizations.regionValue", { region: r })}
                  </option>
                ))}
              </SelectField>
              <p className="app-check__hint" id="org-region-hint">
                {t("admin.organizations.regionHint")}
              </p>
            </div>
            <SelectField label={t("admin.organizations.locale")} name="default_locale" value={locale} onChange={(e) => setLocale(e.target.value as OrgLocale)}>
              {ORG_LOCALES.map((l) => (
                <option key={l} value={l} lang={l}>
                  {t(`language.${l}`)}
                </option>
              ))}
            </SelectField>
          </div>
          <div className="pform__actions">
            <Link to={backTo} className="emb-btn emb-btn--secondary">
              {t("common.cancel")}
            </Link>
            <Button type="submit" loading={save.isPending}>
              {existing ? t("admin.organizations.save") : t("admin.organizations.create")}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
