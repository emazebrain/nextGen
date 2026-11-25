/**
 * Playing a home session from the parent portal (§5.10). The guardian starts it on the Kids page, the child's page
 * or the calendar; the parent API checks the child is theirs and hands over the launch package, which arrives here
 * in the route state. Without it (an address typed in, a stale tab) there is nothing to play: back to the portal.
 * The player sends results through the parent portal's own door, so a guardian needs no staff sign-in.
 */
import { useEffect } from "react";
import { Navigate, useLocation } from "react-router";
import { MazeLoader } from "@emb/ui";
import { ApiError } from "../../api/http.ts";
import { useParentMe } from "../../api/parent.ts";
import { useT } from "../../i18n/index.tsx";
import { flush, setUploadPortal } from "../../session/outbox.ts";
import { SessionPage } from "../../session/SessionPage.tsx";

/** While a guardian is signed in: results go to the parent door, and anything still waiting is sent again. */
export function useParentUploads(signedIn: boolean) {
  useEffect(() => {
    if (!signedIn) return;
    setUploadPortal("parent");
    const again = () => void flush();
    again();
    window.addEventListener("online", again);
    const timer = window.setInterval(again, 60_000);
    return () => {
      window.removeEventListener("online", again);
      window.clearInterval(timer);
    };
  }, [signedIn]);
}

export function ParentSessionRoute() {
  const t = useT();
  const me = useParentMe();
  const location = useLocation();
  // Before the first render of the player, so its very first upload already goes to the right place.
  if (me.data) setUploadPortal("parent");
  useParentUploads(!!me.data);

  if (me.isPending) {
    return (
      <div className="app-fullpage">
        <MazeLoader label={t("common.loading")} />
      </div>
    );
  }
  if (me.isError && me.error instanceof ApiError && me.error.status === 401) return <Navigate to="/sign-in?next=/parent" replace />;
  const state = location.state as { launch?: unknown; fromParent?: boolean } | null;
  if (me.isError || !state?.launch || !state.fromParent) return <Navigate to="/parent" replace />;
  return <SessionPage />;
}
