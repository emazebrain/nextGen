/** Parent portal shell: a header (clinic, language, sign out) and bottom tabs: Kids · Calendar · Results · Messages (§5.10, §5.11, §4.1). */
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Users, CalendarDays, BarChart3, Languages, LogOut, MessageSquare } from "lucide-react";
import { useParentUploads } from "./play.tsx";
import { useT, usePrefs } from "../../i18n/index.tsx";
import { useParentMe, type ParentChild } from "../../api/parent.ts";
import { ApiError } from "../../api/http.ts";
import { Alert, Button, Logo, MazeLoader } from "@emb/ui";
import { authClient } from "../../api/auth.ts";
import { useParentThreads } from "../../api/messaging.ts";
import { createContext, useContext, useState } from "react";

interface ParentContextValue {
  children: ParentChild[];
  activeChild: ParentChild | null;
  setActiveChildId: (id: string) => void;
}

const ParentContext = createContext<ParentContextValue>({
  children: [],
  activeChild: null,
  setActiveChildId: () => {},
});

export function useParentContext() {
  return useContext(ParentContext);
}

/** The other language's own name, so a parent who cannot read the current one can still find it. */
const LANGUAGE_NAME = { en: "English", he: "עברית" } as const;

export function ParentShell() {
  const t = useT();
  const me = useParentMe();
  const navigate = useNavigate();
  const onChildPage = useLocation().pathname.startsWith("/parent/children/");
  const qc = useQueryClient();
  const { locale, setLocale } = usePrefs();
  const [activeChildId, setActiveChildId] = useState<string>("");
  // Unread messages show on the tab; a failure here must never block the portal.
  const threads = useParentThreads();
  const unread = (threads.data ?? []).reduce((n, th) => n + th.unread_count, 0);

  const signOut = async () => {
    await authClient.signOut().catch(() => {});
    qc.clear();
    navigate("/sign-in?reason=signed_out", { replace: true });
  };
  const other = locale === "he" ? "en" : "he";
  const header = (clinic: string | null) => (
    <header className="parent-shell__header">
      <span className="parent-shell__brand">
        <Logo collapsed size={28} />
        {clinic && <bdi className="parent-shell__clinic">{clinic}</bdi>}
      </span>
      <span className="parent-shell__actions">
        <button type="button" className="parent-shell__action" onClick={() => setLocale(other)} lang={other}>
          <Languages size={18} aria-hidden="true" />
          <span>{LANGUAGE_NAME[other]}</span>
        </button>
        <button type="button" className="parent-shell__action parent-shell__action--signout" onClick={() => void signOut()}>
          <LogOut size={18} aria-hidden="true" className="emb-flip-rtl" />
          <span>{t("common.signOut")}</span>
        </button>
      </span>
    </header>
  );

  useParentUploads(!!me.data);
  if (me.isPending) return <MazeLoader label={t("common.loading")} />;
  if (me.isError && me.error instanceof ApiError && me.error.status === 401) return <Navigate to="/sign-in?next=/parent" replace />;
  if (me.isError || !me.data) {
    return (
      <div className="parent-shell">
        {header(null)}
        <main className="parent-shell__content">
          <div className="app-page app-page--narrow">
            <Alert tone="danger" title={t("parent.loadError.title")}>
              <p>{t("parent.loadError.body")}</p>
              <Button variant="secondary" onClick={() => void me.refetch()} loading={me.isFetching}>
                {t("common.retry")}
              </Button>
            </Alert>
          </div>
        </main>
      </div>
    );
  }

  const children = me.data.children;
  const activeChild = children.find((c) => c.id === activeChildId) ?? children[0] ?? null;
  // One clinic for every child (the usual case) is named in the header; otherwise each child's card names its own.
  const clinics = [...new Set(children.map((c) => c.clinic_name).filter(Boolean))];

  return (
    <ParentContext.Provider value={{ children, activeChild, setActiveChildId }}>
      <div className="parent-shell">
        {header(clinics.length === 1 ? clinics[0]! : null)}
        <main className="parent-shell__content">
          <Outlet />
        </main>

        <nav className="parent-shell__tabs" aria-label={t("parent.nav")}>
          {/* A child's own page belongs to the Kids tab. */}
          <NavLink to="/parent" end className={({ isActive }) => `parent-shell__tab${isActive || onChildPage ? " active" : ""}`}>
            <Users size={22} aria-hidden="true" />
            <span>{t("parent.kids")}</span>
          </NavLink>
          <NavLink to="/parent/calendar" className="parent-shell__tab">
            <CalendarDays size={22} aria-hidden="true" />
            <span>{t("parent.calendar")}</span>
          </NavLink>
          <NavLink to="/parent/results" className="parent-shell__tab">
            <BarChart3 size={22} aria-hidden="true" />
            <span>{t("parent.results")}</span>
          </NavLink>
          <NavLink to="/parent/messages" className="parent-shell__tab">
            <span className="parent-shell__tabicon">
              <MessageSquare size={22} aria-hidden="true" />
              {unread > 0 && <span className="parent-shell__badge emb-tnum">{unread}</span>}
            </span>
            <span>
              {t("parent.messages")}
              {unread > 0 && <span className="emb-vh"> {t("parent.unread", { count: unread })}</span>}
            </span>
          </NavLink>
        </nav>
      </div>
    </ParentContext.Provider>
  );
}
