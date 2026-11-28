/**
 * Patients list (design doc §5.3): search, one clinic at a time, archived view for managers.
 * Each row shows what a therapist decides with (how it is going, the week's plan, last played), and the list can be
 * narrowed to the patients worth a look: the same rule as Reports and Today.
 */
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { useIntl } from "react-intl";
import { Archive, Plus, Search, SearchX, TriangleAlert, Users, X } from "lucide-react";
import { Avatar, Button, Card, DataList, EmptyState, MazeLoader, PageHeader, Segmented, type Column } from "@emb/ui";
import { useCaseload, usePatients, type CaseloadRow, type PatientListItem } from "../../api/queries.ts";
import { useT } from "../../i18n/index.tsx";
import { useClinic } from "../../lib/clinic.tsx";
import { matchesQuery } from "../../lib/format.ts";
import { useTitle } from "../../lib/title.ts";
import { fullName, LoadError, StatusChip, useAge } from "../shared.tsx";
import { TREND_LABEL } from "../reports/look.tsx";

export function PatientsPage() {
  const t = useT();
  const intl = useIntl();
  const { clinicId, isManager } = useClinic();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const archived = isManager && params.get("view") === "archived";
  const patients = usePatients(clinicId, archived);
  const age = useAge();
  useTitle(t("patients.title"));

  const setParam = (key: string, value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  const lookOnly = !archived && params.get("look") === "1";
  // The caseload facts are an addition: if they cannot be loaded the list still works, with dashes.
  const caseload = useCaseload(archived ? null : clinicId);
  const facts = useMemo(() => new Map<string, CaseloadRow>((archived ? [] : caseload.data ?? []).map((r) => [r.patient_id, r])), [caseload.data, archived]);
  const lookCount = useMemo(() => (patients.data ?? []).filter((p) => (facts.get(p.id)?.reasons.length ?? 0) > 0).length, [patients.data, facts]);
  const rows = useMemo(
    () => (patients.data ?? []).filter((p) => matchesQuery([p.given_name, p.family_name, fullName(p)], query) && (!lookOnly || (facts.get(p.id)?.reasons.length ?? 0) > 0)),
    [patients.data, query, lookOnly, facts],
  );
  const relative = useMemo(() => new Intl.RelativeTimeFormat(intl.locale, { numeric: "auto" }), [intl.locale]);
  const lastSeen = (s: string | null) => (s ? relative.format(-Math.max(0, Math.floor((Date.now() - Date.parse(s)) / 86_400_000)), "day") : t("reports.caseload.never"));
  const dash = <span className="app-muted">—</span>;

  const columns: Column<PatientListItem>[] = [
    {
      id: "name",
      header: t("patients.col.name"),
      primary: true,
      cell: (p) => (
        <span className="plist-name">
          <bdi>{fullName(p)}</bdi>
          {p.has_alert && (
            <span className="plist-alert" title={t("patients.hasAlert")}>
              <TriangleAlert size={16} aria-hidden="true" />
              <span className="emb-vh">{t("patients.hasAlert")}</span>
            </span>
          )}
        </span>
      ),
    },
    { id: "age", header: t("patients.col.age"), cell: (p) => age(p.date_of_birth) },
    {
      id: "therapist",
      header: t("patients.col.therapist"),
      cell: (p) => (p.therapists?.length ? <bdi>{intl.formatList(p.therapists, { type: "conjunction", style: "narrow" })}</bdi> : dash),
    },
    ...(archived
      ? []
      : ([
          { id: "trend", header: t("reports.col.trend"), cell: (p) => (facts.get(p.id) ? t(TREND_LABEL[facts.get(p.id)!.summary]) : dash) },
          {
            id: "week",
            header: t("reports.col.week"),
            cell: (p) => {
              const f = facts.get(p.id);
              return f ? <span className="emb-tnum">{f.week.planned > 0 ? t("reports.caseload.week", { done: f.week.done, planned: f.week.planned }) : t("reports.caseload.weekNone")}</span> : dash;
            },
          },
          { id: "last", header: t("reports.col.last"), hideOnCard: true, cell: (p) => (facts.get(p.id) ? <span className="emb-tnum">{lastSeen(facts.get(p.id)!.last_session_at)}</span> : dash) },
        ] satisfies Column<PatientListItem>[])),
    { id: "status", header: t("patients.col.status"), cell: (p) => <StatusChip status={p.status} /> },
  ];

  const total = patients.data?.length ?? 0;
  const addButton = (
    <Link to="/patients/new" className="emb-btn emb-btn--primary">
      <Plus size={20} aria-hidden="true" />
      <span>{t("patients.add")}</span>
    </Link>
  );

  return (
    <div className="app-page">
      <PageHeader title={t("patients.title")} description={patients.data && !archived ? t("patients.count", { count: total }) : undefined} actions={archived ? undefined : addButton} />
      {isManager && (
        <div className="plist-view">
          <Segmented
            legend={<span className="emb-vh">{t("patients.view")}</span>}
            name="patients-view"
            value={archived ? "archived" : "current"}
            onChange={(v) => setParam("view", v === "archived" ? "archived" : "")}
            options={[
              { value: "current", label: t("patients.view.current") },
              { value: "archived", label: t("patients.view.archived") },
            ]}
          />
        </div>
      )}
      {patients.isPending ? (
        <MazeLoader label={t("common.loading")} />
      ) : patients.isError ? (
        <LoadError error={patients.error} retry={() => void patients.refetch()} />
      ) : total === 0 ? (
        <Card>
          {archived ? (
            <EmptyState icon={<Archive size={28} aria-hidden="true" />} title={t("patients.archivedEmpty.title")}>
              {t("patients.archivedEmpty.body")}
            </EmptyState>
          ) : (
            <EmptyState icon={<Users size={28} aria-hidden="true" />} title={t("patients.empty.title")} action={addButton}>
              {t("patients.empty.body")}
            </EmptyState>
          )}
        </Card>
      ) : (
        <>
          <div className="app-toolbar" role="search">
            <label className="app-search">
              <Search size={20} aria-hidden="true" className="app-search__icon" />
              <span className="emb-vh">{t("patients.search")}</span>
              <input
                type="search"
                className="emb-input app-search__input"
                placeholder={t("patients.searchPlaceholder")}
                value={query}
                onChange={(e) => setParam("q", e.target.value)}
                enterKeyHint="search"
                autoComplete="off"
              />
            </label>
            {!archived && lookCount > 0 && (
              <button type="button" className={`app-filterchip${lookOnly ? " is-on" : ""}`} aria-pressed={lookOnly} onClick={() => setParam("look", lookOnly ? "" : "1")}>
                {t("patients.lookOnly", { count: lookCount })}
              </button>
            )}
            <span className="app-muted" aria-live="polite">
              {query || lookOnly ? t("patients.results", { count: rows.length }) : ""}
            </span>
          </div>
          {rows.length === 0 ? (
            <Card>
              <EmptyState
                icon={<SearchX size={28} aria-hidden="true" />}
                title={query ? t("patients.noMatch.title", { query }) : t("patients.results", { count: 0 })}
                action={
                  <Button
                    variant="secondary"
                    icon={<X size={18} aria-hidden="true" />}
                    onClick={() =>
                      setParams(
                        (prev) => {
                          const next = new URLSearchParams(prev);
                          next.delete("q");
                          next.delete("look");
                          return next;
                        },
                        { replace: true },
                      )
                    }
                  >
                    {t("patients.noMatch.clear")}
                  </Button>
                }
              >
                {t("patients.noMatch.body")}
              </EmptyState>
            </Card>
          ) : (
            <DataList
              rows={rows}
              columns={columns}
              getRowKey={(p) => p.id}
              caption={t("patients.caption")}
              getRowHref={(p) => `/patients/${p.id}`}
              renderLink={({ href, className, children }) => (
                <Link to={href} className={className}>
                  {children}
                </Link>
              )}
              leading={(p) => <Avatar name={fullName(p)} size={40} />}
            />
          )}
        </>
      )}
    </div>
  );
}
