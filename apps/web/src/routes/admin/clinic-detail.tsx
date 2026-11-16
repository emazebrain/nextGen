/** One clinic (system admin spec): its details and the people who work there. */
import { useState } from "react";
import { Link, useParams } from "react-router";
import { Button, Card, ConfirmDialog, MazeLoader, PageHeader } from "@emb/ui";
import { patchClinic, useAdminClinic, useAdminMutation, type ClinicStatus } from "../../api/admin.ts";
import { useT } from "../../i18n/index.tsx";
import { useTitle } from "../../lib/title.ts";
import { LoadError } from "../shared.tsx";
import { BackLink, ClinicStatusChip, CountryName, NoticeBar, UsersSection, saveError, useFlash } from "./common.tsx";

export function ClinicDetailPage() {
  const t = useT();
  const { id = "" } = useParams();
  const clinic = useAdminClinic(id);
  const setStatus = useAdminMutation((status: ClinicStatus) => patchClinic(id, { status }));
  const [notice, setNotice] = useFlash();
  const [confirming, setConfirming] = useState(false);
  useTitle(clinic.data?.name ?? t("admin.clinics.title"));

  if (clinic.isPending) return <MazeLoader label={t("common.loading")} />;
  if (clinic.isError) {
    return (
      <div className="app-page">
        <BackLink to="/admin/organizations">{t("admin.organizations.back")}</BackLink>
        <LoadError error={clinic.error} retry={() => void clinic.refetch()} />
      </div>
    );
  }
  const c = clinic.data;
  const activate = c.status !== "active";

  const confirm = async () => {
    try {
      await setStatus.mutateAsync(activate ? "active" : "inactive");
      setNotice({ tone: "success", text: t("admin.organizations.statusChanged") });
    } catch (err) {
      setNotice({ tone: "danger", text: t(saveError(err)) });
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="app-page">
      <BackLink to={`/admin/organizations/${c.organization_id}`}>
        <bdi>{c.organization_name ?? t("admin.organizations.back")}</bdi>
      </BackLink>
      <NoticeBar notice={notice} />
      <PageHeader
        title={c.name}
        eyebrow={<ClinicStatusChip status={c.status} />}
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirming(true)}>
              {t(activate ? "admin.clinics.activate" : "admin.clinics.deactivate")}
            </Button>
            <Link to={`/admin/clinics/${c.id}/edit`} className="emb-btn emb-btn--secondary">
              <span>{t("admin.clinics.edit")}</span>
            </Link>
          </>
        }
      />
      <Card className="admin-facts">
        <dl className="app-dl">
          <div>
            <dt>{t("admin.clinics.organization")}</dt>
            <dd>
              <Link to={`/admin/organizations/${c.organization_id}`} className="app-textlink">
                <bdi>{c.organization_name}</bdi>
              </Link>
            </dd>
          </div>
          <div>
            <dt>{t("admin.clinics.country")}</dt>
            <dd>
              <CountryName code={c.country_code} />
            </dd>
          </div>
          <div>
            <dt>{t("admin.clinics.timezone")}</dt>
            <dd>
              <bdi dir="ltr">{c.timezone.replaceAll("_", " ")}</bdi>
            </dd>
          </div>
        </dl>
      </Card>

      <UsersSection filters={{ clinic_id: c.id }} newUserHref={`/admin/users/new?org=${c.organization_id}&clinic=${c.id}`} onNotice={setNotice} />

      {confirming && (
        <ConfirmDialog
          open
          tone={activate ? "primary" : "danger"}
          title={t(activate ? "admin.clinics.activateTitle" : "admin.clinics.deactivateTitle", { name: c.name })}
          confirmLabel={t(activate ? "admin.clinics.activate" : "admin.clinics.deactivate")}
          cancelLabel={t("common.cancel")}
          busy={setStatus.isPending}
          onConfirm={() => void confirm()}
          onCancel={() => setConfirming(false)}
        >
          {t(activate ? "admin.clinics.activateBody" : "admin.clinics.deactivateBody")}
        </ConfirmDialog>
      )}
    </div>
  );
}
