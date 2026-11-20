/** Shared pieces for the org-admin manage screens: the gate, status chips, and the staff list. */
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { ArrowLeft, Building2, Pencil, Send, UserRound } from "lucide-react";
import { Alert, Avatar, Button, Card, Chip, ConfirmDialog, DataList, EmptyState, MazeLoader, TextField, type ChipTone, type Column, type Tone } from "@emb/ui";
import { patchOrgStaff, resendOrgInvite, useOrgMutation, type OrgStaff, type ClinicStatus, type UserStatus } from "../../api/org.ts";
import { ApiError } from "../../api/http.ts";
import { useMe } from "../../api/queries.ts";
import { useT, type MessageId } from "../../i18n/index.tsx";
import { LoadError } from "../shared.tsx";

/** Everything under /manage/*: org_admin only (the API says the same). */
export function ManageArea() {
  const t = useT();
  const me = useMe();
  const isOrgAdmin = me.data?.memberships.some((m) => m.role === "org_admin");
  if (!isOrgAdmin) {
    return (
      <div className="app-page">
        <EmptyState icon={<Building2 size={32} aria-hidden="true" />} title={t("manage.notAllowed")}>
          {t("manage.notAllowedHint")}
        </EmptyState>
      </div>
    );
  }
  return <Outlet />;
}

export interface Notice {
  tone: Tone;
  text: string;
}

/** A one-time message handed over by the screen the admin just came from. */
export function useFlash(): [Notice | null, (n: Notice | null) => void] {
  const location = useLocation();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => {
    const flash = (location.state as { flash?: Notice } | null)?.flash;
    if (!flash) return;
    setNotice(flash);
    navigate(location.pathname + location.search, { replace: true, state: null });
  }, [location, navigate]);
  return [notice, setNotice];
}

export function NoticeBar({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return (
    <div className="app-flash">
      <Alert tone={notice.tone}>{notice.text}</Alert>
    </div>
  );
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="app-textlink app-back">
      <ArrowLeft size={18} aria-hidden="true" className="emb-flip-rtl" />
      {children}
    </Link>
  );
}

/** What to tell the admin when a save fails. */
export function saveError(err: unknown): MessageId {
  if (err instanceof ApiError && err.status === 0) return "errors.network";
  if (err instanceof ApiError && err.status === 403) return "errors.forbidden";
  if (err instanceof ApiError && err.status === 400) return "errors.fieldsInvalid";
  return "errors.generic";
}

const clinicTone: Record<ClinicStatus, ChipTone> = { active: "success", inactive: "neutral", pending: "warning" };
export function ClinicStatusChip({ status }: { status: ClinicStatus }) {
  const t = useT();
  return <Chip tone={clinicTone[status] ?? "neutral"}>{t("manage.clinics.statusValue", { status })}</Chip>;
}

const userTone: Record<UserStatus, ChipTone> = { active: "success", invited: "warning", disabled: "neutral" };
const userLabel: Record<UserStatus, MessageId> = { active: "manage.staff.active", invited: "manage.staff.invited", disabled: "manage.staff.disabled" };
export function StaffStatusChip({ status }: { status: UserStatus }) {
  const t = useT();
  return <Chip tone={userTone[status] ?? "neutral"}>{t(userLabel[status] ?? "manage.staff.active")}</Chip>;
}

/**
 * The staff in a clinic (or the whole org). An invited person can be resent;
 * anyone but the admin themselves can be disabled / enabled.
 */
export function StaffSection({
  staff,
  newStaffHref,
  clinicNames,
  onNotice,
}: {
  staff: OrgStaff[];
  newStaffHref: string;
  clinicNames?: Record<string, string>;
  onNotice: (n: Notice) => void;
}) {
  const t = useT();
  const me = useMe();
  const resend = useOrgMutation(resendOrgInvite);
  const setStatus = useOrgMutation(({ id, status }: { id: string; status: "active" | "disabled" }) => patchOrgStaff(id, { status }));
  const editName = useOrgMutation(({ id, full_name }: { id: string; full_name: string }) => patchOrgStaff(id, { full_name }));
  const [disabling, setDisabling] = useState<OrgStaff | null>(null);
  const [editing, setEditing] = useState<OrgStaff | null>(null);

  const onResend = async (u: OrgStaff) => {
    const ok = await resend.mutateAsync(u.id).then(
      (r) => r.sent,
      () => false,
    );
    onNotice(ok ? { tone: "success", text: t("manage.staff.resendSuccess") } : { tone: "danger", text: t("manage.staff.resendFailed") });
  };
  const change = async (u: OrgStaff, status: "active" | "disabled") => {
    try {
      await setStatus.mutateAsync({ id: u.id, status });
      onNotice({ tone: "success", text: t("manage.staff.changed", { name: u.full_name }) });
    } catch (err) {
      onNotice({ tone: "danger", text: t(saveError(err)) });
    } finally {
      setDisabling(null);
    }
  };

  const columns: Column<OrgStaff>[] = [
    { id: "name", header: t("manage.staff.name"), primary: true, cell: (u) => u.full_name },
    { id: "email", header: t("manage.staff.email"), cell: (u) => <bdi dir="ltr">{u.email}</bdi> },
    {
      id: "role",
      header: t("manage.staff.role"),
      cell: (u) => (
        <span className="chips">
          {(u.memberships ?? []).map((m, i) => (
            <Chip key={i} tone={m.role === "therapist" || m.role === "assistant" ? "neutral" : "brand"}>
              {t("manage.staff.roleValue", { role: m.role })}
            </Chip>
          ))}
        </span>
      ),
    },
    ...(clinicNames
      ? [
          {
            id: "clinic",
            header: t("manage.staff.clinic"),
            cell: (u: OrgStaff) => [...new Set((u.memberships ?? []).map((m) => (m.clinic_id ? (clinicNames[m.clinic_id] ?? "") : "")))].filter(Boolean).join(", "),
          },
        ]
      : []),
    { id: "status", header: t("manage.staff.status"), cell: (u) => <StaffStatusChip status={u.status} /> },
    {
      id: "actions",
      header: t("manage.staff.actions"),
      cell: (u) => (
        <span className="admin-rowactions">
          <Button
            variant="ghost"
            icon={<Pencil size={16} aria-hidden="true" />}
            aria-label={t("manage.staff.editFor", { name: u.full_name })}
            onClick={() => setEditing(u)}
          >
            {t("common.edit")}
          </Button>
          {u.status === "invited" && (
            <Button
              variant="secondary"
              icon={<Send size={16} aria-hidden="true" className="emb-flip-rtl" />}
              aria-label={t("manage.staff.resendFor", { name: u.full_name })}
              loading={resend.isPending && resend.variables === u.id}
              onClick={() => void onResend(u)}
            >
              {t("manage.staff.resendInvite")}
            </Button>
          )}
          {u.status === "disabled" ? (
            <Button variant="secondary" aria-label={t("manage.staff.enableFor", { name: u.full_name })} loading={setStatus.isPending && setStatus.variables?.id === u.id} onClick={() => void change(u, "active")}>
              {t("manage.staff.enable")}
            </Button>
          ) : (
            u.id !== me.data?.user.id && (
              <Button variant="ghost" aria-label={t("manage.staff.disableFor", { name: u.full_name })} onClick={() => setDisabling(u)}>
                {t("manage.staff.disable")}
              </Button>
            )
          )}
        </span>
      ),
    },
  ];

  return (
    <section className="admin-section" aria-labelledby="manage-staff-title">
      <div className="admin-section__head">
        <h2 id="manage-staff-title" className="app-sectiontitle">
          {t("manage.staff.title")}
        </h2>
        <Link to={newStaffHref} className="emb-btn emb-btn--secondary">
          <span>{t("manage.staff.new")}</span>
        </Link>
      </div>
      {staff.length === 0 ? (
        <Card>
          <EmptyState icon={<UserRound size={32} aria-hidden="true" />} title={t("manage.staff.empty")}>
            {t("manage.staff.emptyHint")}
          </EmptyState>
        </Card>
      ) : (
        <Card padded={false}>
          <DataList rows={staff} columns={columns} getRowKey={(u) => u.id} caption={t("manage.staff.caption")} leading={(u) => <Avatar name={u.full_name} size={36} />} />
        </Card>
      )}
      {disabling && (
        <ConfirmDialog
          open
          tone="danger"
          title={t("manage.staff.disableTitle", { name: disabling.full_name })}
          confirmLabel={t("manage.staff.disableConfirm")}
          cancelLabel={t("common.cancel")}
          busy={setStatus.isPending}
          onConfirm={() => void change(disabling, "disabled")}
          onCancel={() => setDisabling(null)}
        >
          {t("manage.staff.disableBody")}
        </ConfirmDialog>
      )}
      {editing && (
        <EditStaffDialog
          staff={editing}
          busy={editName.isPending}
          onSave={async (newName) => {
            try {
              await editName.mutateAsync({ id: editing.id, full_name: newName });
              onNotice({ tone: "success", text: t("manage.staff.editSuccess", { name: newName }) });
              setEditing(null);
            } catch (err) {
              onNotice({ tone: "danger", text: t(saveError(err)) });
            }
          }}
          onCancel={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function EditStaffDialog({ staff, busy, onSave, onCancel }: { staff: OrgStaff; busy: boolean; onSave: (name: string) => void; onCancel: () => void }) {
  const t = useT();
  const [name, setName] = useState(staff.full_name);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed) onSave(trimmed);
  };
  return (
    <ConfirmDialog
      open
      tone="primary"
      title={t("manage.staff.editTitle", { name: staff.full_name })}
      confirmLabel={t("common.save")}
      cancelLabel={t("common.cancel")}
      busy={busy}
      onConfirm={() => { const trimmed = name.trim(); if (trimmed) onSave(trimmed); }}
      onCancel={onCancel}
    >
      <form onSubmit={submit} noValidate>
        <TextField label={t("manage.staff.nameLabel")} name="staff-name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      </form>
    </ConfirmDialog>
  );
}
