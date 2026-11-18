/** One clinic (org admin): its details and the staff who work there. */
import { useState } from "react";
import { Link, useParams } from "react-router";
import { Button, Card, ConfirmDialog, MazeLoader, PageHeader } from "@emb/ui";
import { patchOrgClinic, useOrgClinic, useOrgMutation, type ClinicStatus } from "../../api/org.ts";
import { useT } from "../../i18n/index.tsx";
import { useTitle } from "../../lib/title.ts";
import { LoadError } from "../shared.tsx";
import { BackLink, ClinicStatusChip, NoticeBar, StaffSection, saveError, useFlash, type Notice } from "./common.tsx";
import { CountryName } from "../admin/common.tsx";

export function ManageClinicDetailPage() {
  const t = useT();
  const { id = "" } = useParams();
  const clinic = useOrgClinic(id);
  const setStatus = useOrgMutation((status: ClinicStatus) => patchOrgClinic(id, { status }));
  const [notice, setNotice] = useFlash();
  const [confirming, setConfirming] = useState(false);
  useTitle(clinic.data?.clinic.name ?? t("manage.clinics.title"));

  if (clinic.isPending) return <MazeLoader label={t("common.loading")} />;
  if (clinic.isError) {
    return (
      <div className="app-page">
        <BackLink to="/manage">{t("manage.clinics.back")}</BackLink>
        <LoadError error={clinic.error} retry={() => void clinic.refetch()} />
      </div>
    );
  }
  const c = clinic.data.clinic;
  const activate = c.status !== "active";

  const confirm = async () => {
    try {
      await setStatus.mutateAsync(activate ? "active" : "inactive");
      setNotice({ tone: "success", text: t("manage.clinics.statusChanged") });
    } catch (err) {
      setNotice({ tone: "danger", text: t(saveError(err)) });
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="app-page">
      <BackLink to="/manage">{t("manage.clinics.back")}</BackLink>
      <NoticeBar notice={notice} />
      <PageHeader
        title={c.name}
        eyebrow={<ClinicStatusChip status={c.status} />}
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirming(true)}>
              {t(activate ? "manage.clinics.activate" : "manage.clinics.deactivate")}
            </Button>
            <Link to={`/manage/clinics/${c.id}/edit`} className="emb-btn emb-btn--secondary">
              <span>{t("manage.clinics.edit")}</span>
            </Link>
          </>
        }
      />
      <Card className="admin-facts">
        <dl className="app-dl">
          <div>
            <dt>{t("manage.clinics.country")}</dt>
            <dd><CountryName code={c.country_code} /></dd>
          </div>
          <div>
            <dt>{t("manage.clinics.timezone")}</dt>
            <dd><bdi dir="ltr">{c.timezone.replaceAll("_", " ")}</bdi></dd>
          </div>
        </dl>
      </Card>

      <StaffSection staff={clinic.data.staff} newStaffHref={`/manage/staff/new?clinic=${c.id}`} onNotice={(n: Notice) => setNotice(n)} />

      {confirming && (
        <ConfirmDialog
          open
          tone={activate ? "primary" : "danger"}
          title={t(activate ? "manage.clinics.activateTitle" : "manage.clinics.deactivateTitle", { name: c.name })}
          confirmLabel={t(activate ? "manage.clinics.activate" : "manage.clinics.deactivate")}
          cancelLabel={t("common.cancel")}
          busy={setStatus.isPending}
          onConfirm={() => void confirm()}
          onCancel={() => setConfirming(false)}
        >
          {t(activate ? "manage.clinics.activateBody" : "manage.clinics.deactivateBody")}
        </ConfirmDialog>
      )}
    </div>
  );
}
