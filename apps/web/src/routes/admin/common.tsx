/** Pieces the admin screens share: the platform-admin gate, status chips, notices and the users list. */
import { useEffect, useState, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { ArrowLeft, Building2, Send, UserRound } from "lucide-react";
import { Alert, Avatar, Button, Card, Chip, ConfirmDialog, DataList, EmptyState, MazeLoader, type ChipTone, type Column, type Tone } from "@emb/ui";
import { patchUser, resendInvite, useAdminMutation, useAdminUsers, type AdminUser, type ClinicStatus, type OrgStatus, type UserFilters, type UserStatus } from "../../api/admin.ts";
import { ApiError } from "../../api/http.ts";
import { useMe } from "../../api/queries.ts";
import { usePrefs, useT, type MessageId } from "../../i18n/index.tsx";
import { LoadError } from "../shared.tsx";

/** Everything under /admin/organizations, /admin/clinics and /admin/users: platform admins only (the API says the same). */
export function AdminArea() {
  const t = useT();
  const me = useMe();
  if (!me.data?.is_platform_admin) {
    return (
      <div className="app-page">
        <EmptyState icon={<Building2 size={32} aria-hidden="true" />} title={t("admin.notAllowed")}>
          {t("admin.notAllowedHint")}
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
    // Shown once: a reload or Back doesn't repeat it.
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

/** A country's name in the reader's language, from its two-letter code. */
export function useCountryName() {
  const { locale } = usePrefs();
  return (code: string) => {
    try {
      return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
    } catch {
      return code;
    }
  };
}
export function CountryName({ code }: { code: string }) {
  return <>{useCountryName()(code)}</>;
}

const orgTone: Record<OrgStatus, ChipTone> = { active: "success", suspended: "warning", closed: "neutral" };
const orgLabel: Record<OrgStatus, MessageId> = { active: "admin.organizations.statusActive", suspended: "admin.organizations.statusSuspended", closed: "admin.organizations.statusClosed" };
export function OrgStatusChip({ status }: { status: OrgStatus }) {
  const t = useT();
  return <Chip tone={orgTone[status] ?? "neutral"}>{t(orgLabel[status] ?? "admin.organizations.statusActive")}</Chip>;
}

const clinicTone: Record<ClinicStatus, ChipTone> = { active: "success", inactive: "neutral", pending: "warning" };
export function ClinicStatusChip({ status }: { status: ClinicStatus }) {
  const t = useT();
  return <Chip tone={clinicTone[status] ?? "neutral"}>{t("admin.clinics.statusValue", { status })}</Chip>;
}

const userTone: Record<UserStatus, ChipTone> = { active: "success", invited: "warning", disabled: "neutral" };
const userLabel: Record<UserStatus, MessageId> = { active: "admin.users.active", invited: "admin.users.invited", disabled: "admin.users.disabled" };
export function UserStatusChip({ status }: { status: UserStatus }) {
  const t = useT();
  return <Chip tone={userTone[status] ?? "neutral"}>{t(userLabel[status] ?? "admin.users.active")}</Chip>;
}

/**
 * The people in an organization or a clinic. An invited person can be sent a fresh invitation; anyone but the
 * admin themselves can be disabled (after confirming) and enabled again.
 */
export function UsersSection({ filters, newUserHref, clinicNames, onNotice }: { filters: UserFilters; newUserHref: string; clinicNames?: Record<string, string>; onNotice: (n: Notice) => void }) {
  const t = useT();
  const me = useMe();
  const users = useAdminUsers(filters);
  const resend = useAdminMutation(resendInvite);
  const setStatus = useAdminMutation(({ id, status }: { id: string; status: "active" | "disabled" }) => patchUser(id, { status }));
  const [disabling, setDisabling] = useState<AdminUser | null>(null);

  const onResend = async (u: AdminUser) => {
    const ok = await resend.mutateAsync(u.id).then(
      (r) => r.sent,
      () => false,
    );
    onNotice(ok ? { tone: "success", text: t("admin.users.resendSuccess") } : { tone: "danger", text: t("admin.users.resendFailed") });
  };
  const change = async (u: AdminUser, status: "active" | "disabled") => {
    try {
      await setStatus.mutateAsync({ id: u.id, status });
      onNotice({ tone: "success", text: t("admin.users.changed", { name: u.full_name }) });
    } catch (err) {
      onNotice({ tone: "danger", text: t(saveError(err)) });
    } finally {
      setDisabling(null);
    }
  };

  const columns: Column<AdminUser>[] = [
    { id: "name", header: t("admin.users.name"), primary: true, cell: (u) => u.full_name },
    { id: "email", header: t("admin.users.email"), cell: (u) => <bdi dir="ltr">{u.email}</bdi> },
    {
      id: "role",
      header: t("admin.users.role"),
      cell: (u) => (
        <span className="chips">
          {(u.memberships ?? []).map((m, i) => (
            <Chip key={i} tone={m.role === "therapist" || m.role === "assistant" ? "neutral" : "brand"}>
              {t("shell.role", { role: m.role })}
            </Chip>
          ))}
        </span>
      ),
    },
    ...(clinicNames
      ? [
          {
            id: "clinic",
            header: t("admin.users.clinic"),
            cell: (u: AdminUser) => [...new Set((u.memberships ?? []).map((m) => (m.clinic_id ? (clinicNames[m.clinic_id] ?? "") : t("admin.users.wholeOrganization"))))].filter(Boolean).join(", "),
          },
        ]
      : []),
    { id: "status", header: t("admin.users.status"), cell: (u) => <UserStatusChip status={u.status} /> },
    {
      id: "actions",
      header: t("admin.users.actions"),
      cell: (u) => (
        <span className="admin-rowactions">
          {u.status === "invited" && (
            <Button
              variant="secondary"
              icon={<Send size={16} aria-hidden="true" className="emb-flip-rtl" />}
              aria-label={t("admin.users.resendFor", { name: u.full_name })}
              loading={resend.isPending && resend.variables === u.id}
              onClick={() => void onResend(u)}
            >
              {t("admin.users.resendInvite")}
            </Button>
          )}
          {u.status === "disabled" ? (
            <Button variant="secondary" aria-label={t("admin.users.enableFor", { name: u.full_name })} loading={setStatus.isPending && setStatus.variables?.id === u.id} onClick={() => void change(u, "active")}>
              {t("admin.users.enable")}
            </Button>
          ) : (
            u.id !== me.data?.user.id && (
              <Button variant="ghost" aria-label={t("admin.users.disableFor", { name: u.full_name })} onClick={() => setDisabling(u)}>
                {t("admin.users.disable")}
              </Button>
            )
          )}
        </span>
      ),
    },
  ];

  return (
    <section className="admin-section" aria-labelledby="admin-users-title">
      <div className="admin-section__head">
        <h2 id="admin-users-title" className="app-sectiontitle">
          {t("admin.users.title")}
        </h2>
        <Link to={newUserHref} className="emb-btn emb-btn--secondary">
          <span>{t("admin.users.new")}</span>
        </Link>
      </div>
      {users.isPending ? (
        <MazeLoader label={t("common.loading")} />
      ) : users.isError ? (
        <LoadError error={users.error} retry={() => void users.refetch()} />
      ) : users.data.length === 0 ? (
        <Card>
          <EmptyState icon={<UserRound size={32} aria-hidden="true" />} title={t("admin.users.empty")}>
            {t("admin.users.emptyHint")}
          </EmptyState>
        </Card>
      ) : (
        <Card padded={false}>
          <DataList rows={users.data} columns={columns} getRowKey={(u) => u.id} caption={t("admin.users.caption")} leading={(u) => <Avatar name={u.full_name} size={36} />} />
        </Card>
      )}
      {disabling && (
        <ConfirmDialog
          open
          tone="danger"
          title={t("admin.users.disableTitle", { name: disabling.full_name })}
          confirmLabel={t("admin.users.disableConfirm")}
          cancelLabel={t("common.cancel")}
          busy={setStatus.isPending}
          onConfirm={() => void change(disabling, "disabled")}
          onCancel={() => setDisabling(null)}
        >
          {t("admin.users.disableBody")}
        </ConfirmDialog>
      )}
    </section>
  );
}
