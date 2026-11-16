/** Organizations (system admin spec): the list of every organization, and one organization with its clinics and users. */
import { useState } from "react";
import { Link, useParams } from "react-router";
import { Building2, Hospital } from "lucide-react";
import { Button, Card, ConfirmDialog, DataList, EmptyState, MazeLoader, PageHeader, type Column } from "@emb/ui";
import { patchOrganization, useAdminMutation, useAdminOrg, useAdminOrgs, type AdminClinic, type AdminOrg, type OrgStatus } from "../../api/admin.ts";
import { useT, type MessageId } from "../../i18n/index.tsx";
import { useTitle } from "../../lib/title.ts";
import { LoadError } from "../shared.tsx";
import { BackLink, ClinicStatusChip, CountryName, NoticeBar, OrgStatusChip, UsersSection, saveError, useFlash } from "./common.tsx";

const routerLink = ({ href, className, children }: { href: string; className: string; children: React.ReactNode }) => (
  <Link to={href} className={className}>
    {children}
  </Link>
);

export function OrganizationsPage() {
  const t = useT();
  const orgs = useAdminOrgs();
  useTitle(t("admin.organizations.title"));
  const columns: Column<AdminOrg>[] = [
    { id: "name", header: t("admin.organizations.name"), primary: true, cell: (o) => o.name },
    { id: "region", header: t("admin.organizations.region"), cell: (o) => t("admin.organizations.regionValue", { region: o.region }) },
    { id: "locale", header: t("admin.organizations.locale"), cell: (o) => <span lang={o.default_locale}>{t(`language.${o.default_locale}`)}</span> },
    { id: "status", header: t("admin.organizations.status"), cell: (o) => <OrgStatusChip status={o.status} /> },
  ];
  return (
    <div className="app-page">
      <PageHeader
        title={t("admin.organizations.title")}
        description={t("admin.organizations.description")}
        actions={
          <Link to="/admin/organizations/new" className="emb-btn emb-btn--primary">
            <Building2 size={18} aria-hidden="true" />
            <span>{t("admin.organizations.new")}</span>
          </Link>
        }
      />
      {orgs.isPending ? (
        <MazeLoader label={t("common.loading")} />
      ) : orgs.isError ? (
        <LoadError error={orgs.error} retry={() => void orgs.refetch()} />
      ) : orgs.data.length === 0 ? (
        <EmptyState icon={<Building2 size={32} aria-hidden="true" />} title={t("admin.organizations.empty")}>
          {t("admin.organizations.emptyHint")}
        </EmptyState>
      ) : (
        <Card padded={false}>
          <DataList rows={orgs.data} columns={columns} getRowKey={(o) => o.id} caption={t("admin.organizations.caption")} getRowHref={(o) => `/admin/organizations/${o.id}`} renderLink={routerLink} />
        </Card>
      )}
    </div>
  );
}

type StatusChange = { to: OrgStatus; title: MessageId; body: MessageId; action: MessageId; danger: boolean };
const SUSPEND: StatusChange = { to: "suspended", title: "admin.organizations.suspendTitle", body: "admin.organizations.suspendBody", action: "admin.organizations.suspend", danger: true };
const CLOSE: StatusChange = { to: "closed", title: "admin.organizations.closeTitle", body: "admin.organizations.closeBody", action: "admin.organizations.close", danger: true };
const REACTIVATE: StatusChange = { to: "active", title: "admin.organizations.reactivateTitle", body: "admin.organizations.reactivateBody", action: "admin.organizations.reactivate", danger: false };

export function OrgDetailPage() {
  const t = useT();
  const { id = "" } = useParams();
  const detail = useAdminOrg(id);
  const setStatus = useAdminMutation((status: OrgStatus) => patchOrganization(id, { status }));
  const [notice, setNotice] = useFlash();
  const [pending, setPending] = useState<StatusChange | null>(null);
  useTitle(detail.data?.organization.name ?? t("admin.organizations.title"));

  if (detail.isPending) return <MazeLoader label={t("common.loading")} />;
  if (detail.isError) {
    return (
      <div className="app-page">
        <BackLink to="/admin/organizations">{t("admin.organizations.back")}</BackLink>
        <LoadError error={detail.error} retry={() => void detail.refetch()} />
      </div>
    );
  }
  const { organization: org, clinics } = detail.data;
  const changes = org.status === "active" ? [SUSPEND, CLOSE] : org.status === "suspended" ? [REACTIVATE, CLOSE] : [REACTIVATE];

  const confirm = async (change: StatusChange) => {
    try {
      await setStatus.mutateAsync(change.to);
      setNotice({ tone: "success", text: t("admin.organizations.statusChanged") });
    } catch (err) {
      setNotice({ tone: "danger", text: t(saveError(err)) });
    } finally {
      setPending(null);
    }
  };

  const clinicColumns: Column<AdminClinic>[] = [
    { id: "name", header: t("admin.clinics.name"), primary: true, cell: (c) => c.name },
    { id: "country", header: t("admin.clinics.country"), cell: (c) => <CountryName code={c.country_code} /> },
    { id: "timezone", header: t("admin.clinics.timezone"), cell: (c) => <bdi dir="ltr">{c.timezone}</bdi> },
    { id: "status", header: t("admin.clinics.status"), cell: (c) => <ClinicStatusChip status={c.status} /> },
  ];

  return (
    <div className="app-page">
      <BackLink to="/admin/organizations">{t("admin.organizations.back")}</BackLink>
      <NoticeBar notice={notice} />
      <PageHeader
        title={org.name}
        eyebrow={<OrgStatusChip status={org.status} />}
        description={`${t("admin.organizations.regionValue", { region: org.region })} · ${t(`language.${org.default_locale}`)}`}
        actions={
          <>
            {changes.map((c) => (
              <Button key={c.to} variant="ghost" onClick={() => setPending(c)}>
                {t(c.action)}
              </Button>
            ))}
            <Link to={`/admin/organizations/${org.id}/edit`} className="emb-btn emb-btn--secondary">
              <span>{t("admin.organizations.edit")}</span>
            </Link>
          </>
        }
      />

      <section className="admin-section" aria-labelledby="admin-clinics-title">
        <div className="admin-section__head">
          <h2 id="admin-clinics-title" className="app-sectiontitle">
            {t("admin.clinics.title")}
          </h2>
          <Link to={`/admin/organizations/${org.id}/clinics/new`} className="emb-btn emb-btn--secondary">
            <span>{t("admin.clinics.new")}</span>
          </Link>
        </div>
        {clinics.length === 0 ? (
          <Card>
            <EmptyState icon={<Hospital size={32} aria-hidden="true" />} title={t("admin.clinics.empty")}>
              {t("admin.clinics.emptyHint")}
            </EmptyState>
          </Card>
        ) : (
          <Card padded={false}>
            <DataList rows={clinics} columns={clinicColumns} getRowKey={(c) => c.id} caption={t("admin.clinics.caption")} getRowHref={(c) => `/admin/clinics/${c.id}`} renderLink={routerLink} />
          </Card>
        )}
      </section>

      <UsersSection filters={{ org_id: org.id }} newUserHref={`/admin/users/new?org=${org.id}`} clinicNames={Object.fromEntries(clinics.map((c) => [c.id, c.name]))} onNotice={setNotice} />

      {pending && (
        <ConfirmDialog
          open
          tone={pending.danger ? "danger" : "primary"}
          title={t(pending.title, { name: org.name })}
          confirmLabel={t(pending.action)}
          cancelLabel={t("common.cancel")}
          busy={setStatus.isPending}
          onConfirm={() => void confirm(pending)}
          onCancel={() => setPending(null)}
        >
          {t(pending.body)}
        </ConfirmDialog>
      )}
    </div>
  );
}
