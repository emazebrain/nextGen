/**
 * The therapist's app shell (design doc §4): seven rail destinations, Settings
 * in the account menu, four bottom tabs + More on phones, a clinic switcher
 * and help in the same place on every page (WCAG 3.2.6).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  CircleHelp,
  House,
  LayoutGrid,
  LogOut,
  MessageSquare,
  Route as RouteIcon,
  Settings as SettingsIcon,
  Users,
  UsersRound,
  Film,
} from "lucide-react";
import { AppShell, Avatar, Disclosure, Logo, SelectField, type ShellNavItem } from "@emb/ui";
import { authClient } from "../api/auth.ts";
import type { Me } from "../api/queries.ts";
import { useT, type MessageId } from "../i18n/index.tsx";
import { useClinic } from "../lib/clinic.tsx";
import { useIdleTimeout } from "../lib/idle.ts";
import { useOptionalDevice } from "../device/session.tsx";
import { OfflineBanner } from "../device/OfflineBanner.tsx";
import { SyncStatus } from "../device/SyncStatus.tsx";

const NAV: Array<{ id: string; path: string; label: MessageId; icon: ShellNavItem["icon"] }> = [
  { id: "today", path: "/today", label: "nav.today", icon: House },
  { id: "patients", path: "/patients", label: "nav.patients", icon: Users },
  { id: "calendar", path: "/calendar", label: "nav.calendar", icon: CalendarDays },
  { id: "protocols", path: "/protocols", label: "nav.protocols", icon: RouteIcon },
  { id: "library", path: "/library", label: "nav.library", icon: BookOpen },
  { id: "messages", path: "/messages", label: "nav.messages", icon: MessageSquare },
  { id: "reports", path: "/reports", label: "nav.reports", icon: BarChart3 },
];
const PHONE_TABS = ["today", "patients", "calendar", "messages"];

export function useSignOut() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const device = useOptionalDevice();
  return async (reason: "signed_out" | "idle") => {
    // Offline, an idle lock goes back to "who's using the tablet?" (offline devices spec §7.5).
    if (reason === "idle" && device && !navigator.onLine && device.spaces.length) {
      device.lock();
      qc.clear();
      navigate("/offline?reason=idle", { replace: true });
      return;
    }
    // Signing out removes this therapist's own space from the device; an idle lock only locks it.
    if (reason === "signed_out") await device?.signOut();
    else device?.lock();
    await authClient.signOut().catch(() => {});
    qc.clear();
    navigate(`/sign-in?reason=${reason}`, { replace: true });
  };
}

export function ClinicShell({ me }: { me: Me }) {
  const t = useT();
  const location = useLocation();
  const signOut = useSignOut();
  const { clinics, clinicId, setClinicId, isManager } = useClinic();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("emb.rail") === "collapsed";
    } catch {
      return false;
    }
  });

  useIdleTimeout(() => void signOut("idle"));

  // Move focus to the page on navigation so screen readers start at the new content.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [location.pathname]);

  const items: ShellNavItem[] = NAV.map((n) => ({ id: n.id, href: n.path, label: t(n.label), icon: n.icon }));
  // The content library is for platform admins only (ADR 0018).
  if (me.is_platform_admin) items.push({ id: "videos", href: "/admin/videos", label: t("nav.videos"), icon: Film });
  const more: ShellNavItem = { id: "more", href: "/more", label: t("nav.more"), icon: LayoutGrid };
  const isActive = (item: ShellNavItem) => location.pathname === item.href || location.pathname.startsWith(`${item.href}/`);
  const role = clinics.find((c) => c.id === clinicId)?.roles[0] ?? me.memberships[0]?.role;

  const toggleRail = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem("emb.rail", c ? "expanded" : "collapsed");
      } catch {
        /* not remembered */
      }
      return !c;
    });

  return (
    <AppShell
      brand={
        <Link to="/today" className="app-brandlink" aria-label="eMazeBrain">
          <Logo collapsed={collapsed} />
        </Link>
      }
      navLabel={t("nav.main")}
      tabsLabel={t("nav.tabs")}
      items={items}
      tabIds={PHONE_TABS}
      more={more}
      isActive={(i) => (i.id === "more" ? ["/more", "/protocols", "/library", "/reports", "/settings", "/team"].some((p) => location.pathname.startsWith(p)) : isActive(i))}
      renderLink={({ href: to, className, children, ...rest }) => (
        <Link to={to} className={className} {...rest}>
          {children}
        </Link>
      )}
      skipLabel={t("nav.skip")}
      railCollapsed={collapsed}
      onToggleRail={toggleRail}
      toggleLabels={{ collapse: t("nav.collapse"), expand: t("nav.expand") }}
      topBar={
        <>
          <div className="app-topbar__start">
            <Link to="/today" className="app-topbar__mobilebrand" aria-label="eMazeBrain">
              <Logo collapsed size={28} />
            </Link>
            {clinics.length > 1 ? (
              <SelectField label={t("shell.clinic")} hideLabel value={clinicId ?? ""} onChange={(e) => setClinicId(e.target.value)} className="app-clinicswitch">
                {clinics.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </SelectField>
            ) : clinics[0] ? (
              <span className="app-clinicname">{clinics[0].name}</span>
            ) : null}
          </div>
          <div className="app-topbar__end">
            <SyncStatus />
            <Disclosure label={t("shell.help")} trigger={<CircleHelp size={22} aria-hidden="true" className="app-topbar__icon" />}>
              {() => (
                <div className="app-help">
                  <p className="app-help__title">{t("shell.help.title")}</p>
                  <p className="app-help__body">{t("shell.help.body")}</p>
                </div>
              )}
            </Disclosure>
            <Disclosure label={t("shell.account")} trigger={<Avatar name={me.user.name} size={36} />}>
              {(close) => (
                <div role="group" aria-label={t("shell.account")}>
                  <div className="app-account">
                    <Avatar name={me.user.name} size={44} />
                    <div className="app-account__text">
                      <p className="app-account__name">{me.user.name}</p>
                      <p className="app-account__meta">
                        <bdi dir="ltr">{me.user.email}</bdi>
                      </p>
                      {role && <p className="app-account__meta">{t("shell.role", { role })}</p>}
                    </div>
                  </div>
                  <hr className="emb-menusep" />
                  {isManager && (
                    <MenuLink to="/team" onDone={close} icon={<UsersRound size={20} aria-hidden="true" />}>
                      {t("nav.team")}
                    </MenuLink>
                  )}
                  <MenuLink to="/settings" onDone={close} icon={<SettingsIcon size={20} aria-hidden="true" />}>
                    {t("nav.settings")}
                  </MenuLink>
                  <button type="button" className="emb-menuitem" onClick={() => void signOut("signed_out")}>
                    <LogOut size={20} aria-hidden="true" className="emb-flip-rtl" />
                    {t("common.signOut")}
                  </button>
                </div>
              )}
            </Disclosure>
          </div>
        </>
      }
    >
      <OfflineBanner />
      <Outlet />
    </AppShell>
  );
}

function MenuLink({ to, onDone, icon, children }: { to: string; onDone: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <Link to={to} className="emb-menuitem" onClick={onDone}>
      {icon}
      {children}
    </Link>
  );
}
