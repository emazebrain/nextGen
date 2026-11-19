/** Org admin dashboard: stats, clinics, staff, patients at a glance. */
import { Link } from "react-router";
import { Building2, CalendarDays, Users, UserRound, Activity, Plus } from "lucide-react";
import { Card, Chip, DataList, EmptyState, MazeLoader, PageHeader, type Column } from "@emb/ui";
import { useOrgOverview, useOrgStats, useOrgStaff, useOrgPatients, type OrgClinic, type OrgStats } from "../../api/org.ts";
import { useT } from "../../i18n/index.tsx";
import { useTitle } from "../../lib/title.ts";
import { LoadError } from "../shared.tsx";
import { ClinicStatusChip, NoticeBar, useFlash } from "./common.tsx";
import { useCountryName } from "../admin/common.tsx";

export function ManageOverviewPage() {
  const t = useT();
  const overview = useOrgOverview();
  const stats = useOrgStats();
  const recentStaff = useOrgStaff({ status: "invited" });
  const recentPatients = useOrgPatients({});
  const [notice] = useFlash();
  const countryName = useCountryName();
  useTitle(t("manage.overview.title"));

  if (overview.isPending || stats.isPending) return <MazeLoader label={t("common.loading")} />;
  if (overview.isError) return <div className="app-page"><LoadError error={overview.error} retry={() => void overview.refetch()} /></div>;

  const { organization: org, clinics } = overview.data;
  const s = stats.data;

  const clinicCols: Column<OrgClinic>[] = [
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
      <PageHeader
        title={org.name}
        eyebrow={<Chip tone="brand">{t("manage.overview.orgAdmin")}</Chip>}
        description={t("manage.overview.description")}
      />

      {/* Quick nav */}
      <nav className="manage-nav" aria-label={t("manage.overview.navLabel")}>
        <Link to="/manage/clinics/new" className="manage-nav__item">
          <Building2 size={20} aria-hidden="true" />
          <span>{t("manage.clinics.new")}</span>
        </Link>
        <Link to="/manage/staff/new" className="manage-nav__item">
          <UserRound size={20} aria-hidden="true" />
          <span>{t("manage.staff.new")}</span>
        </Link>
        <Link to="/manage/patients/new" className="manage-nav__item">
          <Users size={20} aria-hidden="true" />
          <span>{t("manage.patients.new")}</span>
        </Link>
        <Link to="/manage/patients" className="manage-nav__item">
          <Users size={20} aria-hidden="true" />
          <span>{t("manage.patients.title")}</span>
        </Link>
      </nav>

      {/* Stats grid */}
      {s && (
        <div className="manage-stats">
          <StatCard icon={<Building2 size={22} />} label={t("manage.stats.clinics")} value={s.clinics.active} sub={t("manage.stats.clinicsTotal", { total: s.clinics.total })} />
          <StatCard icon={<UserRound size={22} />} label={t("manage.stats.staff")} value={s.staff.active} sub={s.staff.invited > 0 ? t("manage.stats.staffInvited", { count: s.staff.invited }) : undefined} />
          <StatCard icon={<Users size={22} />} label={t("manage.stats.patients")} value={s.patients.active} sub={s.patients.pending > 0 ? t("manage.stats.patientsPending", { count: s.patients.pending }) : undefined} />
          <StatCard icon={<CalendarDays size={22} />} label={t("manage.stats.upcoming")} value={s.sessions.upcoming} sub={t("manage.stats.completedWeek", { count: s.sessions.completed_this_week })} />
        </div>
      )}

      {/* Clinics table */}
      <section className="admin-section" aria-labelledby="manage-clinics-title">
        <div className="admin-section__head">
          <h2 id="manage-clinics-title" className="app-sectiontitle">{t("manage.clinics.title")}</h2>
          <Link to="/manage/clinics/new" className="emb-btn emb-btn--secondary">
            <Plus size={18} aria-hidden="true" /> <span>{t("manage.clinics.new")}</span>
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
            <DataList rows={clinics} columns={clinicCols} getRowKey={(c) => c.id} caption={t("manage.clinics.caption")} />
          </Card>
        )}
      </section>

      {/* Pending invitations */}
      {(recentStaff.data ?? []).length > 0 && (
        <section className="admin-section" aria-labelledby="manage-pending-title">
          <h2 id="manage-pending-title" className="app-sectiontitle">{t("manage.overview.pendingInvites")}</h2>
          <Card padded={false}>
            <DataList
              rows={recentStaff.data!}
              columns={[
                { id: "name", header: t("manage.staff.name"), primary: true, cell: (s) => <bdi>{s.full_name}</bdi> },
                { id: "email", header: t("manage.staff.email"), cell: (s) => <bdi dir="ltr">{s.email}</bdi> },
                { id: "status", header: t("manage.staff.status"), cell: () => <Chip tone="warning">{t("manage.staff.invited")}</Chip> },
              ]}
              getRowKey={(s) => s.id}
              caption={t("manage.overview.pendingInvites")}
            />
          </Card>
        </section>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: number; sub?: string | undefined }) {
  return (
    <Card className="manage-stat">
      <div className="manage-stat__icon">{icon}</div>
      <div className="manage-stat__body">
        <span className="manage-stat__value">{value}</span>
        <span className="manage-stat__label">{label}</span>
        {sub && <span className="manage-stat__sub">{sub}</span>}
      </div>
    </Card>
  );
}
