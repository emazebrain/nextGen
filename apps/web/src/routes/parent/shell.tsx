/** Parent portal shell — bottom tabs: Home · Progress · Messages (§5.10, §4.1). */
import { NavLink, Outlet, useNavigate } from "react-router";
import { Home, BarChart3, MessageSquare } from "lucide-react";
import { useT } from "../../i18n/index.tsx";
import { useParentMe, type ParentChild } from "../../api/parent.ts";
import { MazeLoader } from "@emb/ui";
import { createContext, useContext, useState, type ReactNode } from "react";

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
  if (me.isError || !me.data) {
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
        {/* Child switcher for multi-child families */}
        {children.length > 1 && (
          <div className="parent-shell__switcher">
            {children.map((child) => (
              <button
                key={child.id}
                type="button"
                className={`parent-shell__child-btn ${child.id === (activeChild?.id ?? "") ? "parent-shell__child-btn--active" : ""}`}
                onClick={() => setActiveChildId(child.id)}
              >
                {child.given_name}
              </button>
            ))}
          </div>
        )}

        <div className="parent-shell__content">
          <Outlet />
        </div>

        <nav className="parent-shell__tabs" aria-label={t("parent.nav")}>
          <NavLink to="/parent" end className="parent-shell__tab">
            <Home size={20} aria-hidden="true" />
            <span>{t("parent.home")}</span>
          </NavLink>
          <NavLink to="/parent/progress" className="parent-shell__tab">
            <BarChart3 size={20} aria-hidden="true" />
            <span>{t("parent.progress")}</span>
          </NavLink>
          <NavLink to="/parent/messages" className="parent-shell__tab">
            <MessageSquare size={20} aria-hidden="true" />
            <span>{t("parent.messages")}</span>
          </NavLink>
        </nav>
      </div>
    </ParentContext.Provider>
  );
}
