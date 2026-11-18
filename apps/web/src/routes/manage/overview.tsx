/** Org admin overview: the organization and its clinics. */
import { Link } from "react-router";
import { Building2 } from "lucide-react";
import { Card, Chip, DataList, EmptyState, MazeLoader, PageHeader, type Column } from "@emb/ui";
import { useOrgOverview, type OrgClinic } from "../../api/org.ts";
import { useT } from "../../i18n/index.tsx";
import { useTitle } from "../../lib/title.ts";
import { LoadError } from "../shared.tsx";
import { ClinicStatusChip, NoticeBar, useFlash } from "./common.tsx";
import { useCountryName } from "../admin/common.tsx";

export function ManageOverviewPage() {
  const t = useT();
  const overview = useOrgOverview();
  const [notice] = useFlash();
  const countryName = useCountryName();
  useTitle(t("manage.overview.title"));

  if (overview.isPending) return <MazeLoader label={t("common.loading")} />;
  if (overview.isError) return <div className="app-page"><LoadError error={overview.error} retry={() => void overview.refetch()} /></div>;

  const { organization: org, clinics } = overview.data;

  const columns: Column<OrgClinic>[] = [
    {
      id: "name",
      header: t("manage.clinics.name"),
      primary: true,
      cell: (c) => (
        <Link to={`/manage/clinics/${c.id}`} className="app-textlink">
          <bdi>{c.name}</bdi>
        </Link>
      ),
    },
    { id: "country", header: t("manage.clinics.country"), cell: (c) => countryName(c.country_code) },
    { id: "timezone", header: t("manage.clinics.timezone"), cell: (c) => <bdi dir="ltr">{c.timezone.replaceAll("_", " ")}</bdi> },
    { id: "status", header: t("manage.clinics.status"), cell: (c) => <ClinicStatusChip status={c.status} /> },
  ];

  return (
    <div className="app-page">
      <NoticeBar notice={notice} />
      <PageHeader title={org.name} eyebrow={<Chip tone="brand">{t("manage.overview.title")}</Chip>} description={t("manage.overview.description")} />
      <section className="admin-section" aria-labelledby="manage-clinics-title">
        <div className="admin-section__head">
          <h2 id="manage-clinics-title" className="app-sectiontitle">{t("manage.clinics.title")}</h2>
          <Link to="/manage/clinics/new" className="emb-btn emb-btn--secondary">
            <span>{t("manage.clinics.new")}</span>
          </Link>
        </div>
        {clinics.length === 0 ? (
          <Card>
            <EmptyState icon={<Building2 size={32} aria-hidden="true" />} title={t("manage.clinics.empty")}>
              {t("manage.clinics.emptyHint")}
            </EmptyState>
          </Card>
        ) : (
          <Card padded={false}>
            <DataList rows={clinics} columns={columns} getRowKey={(c) => c.id} caption={t("manage.clinics.caption")} />
          </Card>
        )}
      </section>
    </div>
  );
}
