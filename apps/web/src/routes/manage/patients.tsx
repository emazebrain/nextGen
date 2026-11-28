/** Org admin patient list: all patients across the org's clinics. */
import { Link } from "react-router";
import { Users } from "lucide-react";
import { Card, Chip, DataList, EmptyState, MazeLoader, PageHeader, SelectField, type Column, type ChipTone } from "@emb/ui";
import { useOrgClinics, useOrgPatients, type OrgPatient, type OrgClinic, type PatientFilters } from "../../api/org.ts";
import { useT } from "../../i18n/index.tsx";
import { useTitle } from "../../lib/title.ts";
import { LoadError, fullName } from "../shared.tsx";
import { BackLink, NoticeBar, useFlash } from "./common.tsx";
import { useState } from "react";

const statusTone: Record<string, ChipTone> = { active: "success", pending_consent: "warning", inactive: "neutral", discharged: "neutral" };

export function ManagePatientsPage() {
  const t = useT();
  const [notice, setNotice] = useFlash();
  const [clinicFilter, setClinicFilter] = useState("");
  const filters: PatientFilters = clinicFilter ? { clinic_id: clinicFilter } : {};
  const patients = useOrgPatients(filters);
  const clinics = useOrgClinics();
  useTitle(t("manage.patients.title"));

  if (patients.isPending || clinics.isPending) return <MazeLoader label={t("common.loading")} />;
  if (patients.isError) return <div className="app-page"><LoadError error={patients.error} retry={() => void patients.refetch()} /></div>;

  const clinicMap: Record<string, string> = {};
  for (const cl of clinics.data ?? []) clinicMap[cl.id] = cl.name;

  const columns: Column<OrgPatient>[] = [
    {
      id: "name",
      header: t("manage.patients.name"),
      primary: true,
      cell: (p) => (
        <Link to={`/patients/${p.id}`} className="app-textlink">
          <bdi>{p.given_name} {p.family_name}</bdi>
        </Link>
      ),
    },
    { id: "dob", header: t("manage.patients.dob"), cell: (p) => <bdi dir="ltr">{p.date_of_birth}</bdi> },
    { id: "clinic", header: t("manage.patients.clinic"), cell: (p) => <bdi>{p.clinic_name}</bdi> },
    { id: "therapist", header: t("patients.col.therapist"), cell: (p) => (p.therapists?.length ? <bdi>{p.therapists.join(", ")}</bdi> : <span className="app-muted">—</span>) },
    {
      id: "status",
      header: t("manage.patients.status"),
      cell: (p) => <Chip tone={statusTone[p.status] ?? "neutral"}>{t("patients.status", { status: p.status })}</Chip>,
    },
  ];

  return (
    <div className="app-page">
      <BackLink to="/manage">{t("manage.overview.title")}</BackLink>
      <NoticeBar notice={notice} />
      <PageHeader
        title={t("manage.patients.title")}
        description={t("manage.patients.description")}
      />

      <div className="admin-section__head">
        <SelectField
          label={t("manage.patients.filterClinic")}
          name="clinic_filter"
          value={clinicFilter}
          onChange={(e) => setClinicFilter(e.target.value)}
        >
          <option value="">{t("manage.patients.allClinics")}</option>
          {(clinics.data ?? []).map((cl: OrgClinic) => (
            <option key={cl.id} value={cl.id}>{cl.name}</option>
          ))}
        </SelectField>
        <Link to="/manage/patients/new" className="emb-btn emb-btn--secondary">
          <span>{t("manage.patients.new")}</span>
        </Link>
      </div>

      {patients.data.length === 0 ? (
        <Card>
          <EmptyState icon={<Users size={32} aria-hidden="true" />} title={t("manage.patients.empty")}>
            {t("manage.patients.emptyHint")}
          </EmptyState>
        </Card>
      ) : (
        <Card padded={false}>
          <DataList rows={patients.data} columns={columns} getRowKey={(p) => p.id} caption={t("manage.patients.caption")} />
        </Card>
      )}
    </div>
  );
}
