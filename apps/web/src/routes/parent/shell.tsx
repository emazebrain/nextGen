/** Parent portal shell — bottom tabs: Kids · Calendar · Results (§5.10, §4.1). */
import { NavLink, Navigate, Outlet } from "react-router";
import { Users, CalendarDays, BarChart3 } from "lucide-react";
import { useT } from "../../i18n/index.tsx";
import { useParentMe, type ParentChild } from "../../api/parent.ts";
import { ApiError } from "../../api/http.ts";
import { MazeLoader } from "@emb/ui";
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

export function ParentShell() {
  const t = useT();
  const me = useParentMe();
  const [activeChildId, setActiveChildId] = useState<string>("");

  if (me.isPending) return <MazeLoader label={t("common.loading")} />;
  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      return <Navigate to="/sign-in?next=/parent" replace />;
    }
    return (
      <div className="parent-shell">
        <div className="app-page" style={{ textAlign: "center", paddingBlockStart: "4rem" }}>
          <p>{t("errors.generic")}</p>
        </div>
      </div>
    );
  }
  if (!me.data) {
    return (
      <div className="parent-shell">
        <div className="app-page" style={{ textAlign: "center", paddingBlockStart: "4rem" }}>
          <p>{t("errors.generic")}</p>
        </div>
      </div>
    );
  }

  const children = me.data.children;
  const activeChild = children.find((c) => c.id === activeChildId) ?? children[0] ?? null;

  return (
    <ParentContext.Provider value={{ children, activeChild, setActiveChildId }}>
      <div className="parent-shell">
        <div className="parent-shell__content">
          <Outlet />
        </div>

        <nav className="parent-shell__tabs" aria-label={t("parent.nav")}>
          <NavLink to="/parent" end className="parent-shell__tab">
            <Users size={20} aria-hidden="true" />
            <span>{t("parent.kids")}</span>
          </NavLink>
          <NavLink to="/parent/calendar" className="parent-shell__tab">
            <CalendarDays size={20} aria-hidden="true" />
            <span>{t("parent.calendar")}</span>
          </NavLink>
          <NavLink to="/parent/results" className="parent-shell__tab">
            <BarChart3 size={20} aria-hidden="true" />
            <span>{t("parent.results")}</span>
          </NavLink>
        </nav>
      </div>
    </ParentContext.Provider>
  );
}
