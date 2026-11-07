import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Navigate, Outlet, RouterProvider, createBrowserRouter, createHashRouter, useLocation, useNavigate, type RouteObject } from "react-router";
import { MazeLoader } from "@emb/ui";
import { ApiError } from "./api/http.ts";
import { useMe, type Me } from "./api/queries.ts";
import { PrefsProvider, useT } from "./i18n/index.tsx";
import { ClinicProvider, useClinic } from "./lib/clinic.tsx";
import { DeviceProvider, isInstalled, useOptionalDevice } from "./device/session.tsx";
import { OfflineSignInPage } from "./routes/offline-sign-in.tsx";
import { SetupOfflinePage } from "./routes/setup-offline.tsx";
import { useBundleRefresh } from "./device/refresh.tsx";
import { SetupMfaPage, SignInPage, VerifyPage } from "./routes/auth.tsx";
import { ComingSoonPage, MorePage, NotFoundPage, SettingsPage, TodayPage } from "./routes/pages.tsx";
import { LoadError } from "./routes/shared.tsx";
import { PatientsPage } from "./routes/patients/list.tsx";
import { EditPatientPage, NewPatientPage } from "./routes/patients/form.tsx";
import { PatientFamily, PatientLayout, PatientOverview } from "./routes/patients/detail.tsx";
import { PatientProgress } from "./routes/patients/progress.tsx";
import { ConsentPage } from "./routes/patients/consent.tsx";
import { TeamPage } from "./routes/team.tsx";
import { GamePage, GamePreviewPage, LibraryPage } from "./routes/library.tsx";
import { AssignPage, ProtocolsPage, TemplateBuilderPage } from "./routes/protocols/pages.tsx";
import { useIdleTimeout } from "./lib/idle.ts";
import { useSignOut } from "./shell/ClinicShell.tsx";
import { ClinicShell } from "./shell/ClinicShell.tsx";
import { SessionPage } from "./session/SessionPage.tsx";
import { VideoEditorPage, VideosAdminPage } from "./routes/admin/videos.tsx";
import { flush } from "./session/outbox.ts";

/**
 * Staff-only area. /v1/me decides: 401 → sign in (and come back here),
 * 403 mfa_required → enrolment, otherwise the shell.
 */
export function RequireStaff({ bare = false }: { bare?: boolean }) {
  const me = useMe();
  const location = useLocation();
  const t = useT();
  const device = useOptionalDevice();
  const here = encodeURIComponent(location.pathname + location.search);
  // No connection (offline devices spec §7.5): an unlocked space runs the app; otherwise pick yourself and unlock.
  // A refetch after a failure is "pending" again; its last failure still says whether the network is down.
  const failure = me.error ?? me.failureReason;
  const offline = !me.data && failure instanceof ApiError && failure.status === 0;
  if (offline && device) {
    if (!device.ready) {
      return (
        <div className="app-fullpage">
          <MazeLoader label={t("common.loading")} />
        </div>
      );
    }
    if (device.space && device.offlineMe) return <StaffArea me={device.offlineMe} bare={bare} />;
    if (device.spaces.length) return <Navigate to={`/offline?next=${here}`} replace />;
  }
  if (me.isPending) {
    return (
      <div className="app-fullpage">
        <MazeLoader label={t("common.loading")} />
      </div>
    );
  }
  if (me.isError) {
    const e = me.error;
    if (e instanceof ApiError && e.status === 401) {
      return <Navigate to={`/sign-in?next=${here}`} replace />;
    }
    if (e instanceof ApiError && e.status === 403 && e.code === "mfa_required") return <Navigate to="/setup-mfa" replace />;
    return (
      <div className="app-fullpage app-fullpage--pad">
        <LoadError error={e} retry={() => void me.refetch()} />
      </div>
    );
  }
  return <StaffArea me={me.data} bare={bare} online />;
}

function StaffArea({ me, bare, online = false }: { me: Me; bare: boolean; online?: boolean }) {
  return (
    <ClinicProvider memberships={me.memberships}>
      <OutboxFlusher />
      {online && <OpenSpaceOnline me={me} />}
      {bare ? <BareScreen /> : <ClinicShell me={me} />}
    </ClinicProvider>
  );
}

/**
 * Signed in online: open this therapist's space on the device with the server's secret, or, the first time on this
 * device, ask them to set up offline use (offline devices spec §7.5). Runs once per user and clinic.
 */
function OpenSpaceOnline({ me }: { me: Me }) {
  useBundleRefresh();
  const device = useOptionalDevice();
  const { clinicId } = useClinic();
  const navigate = useNavigate();
  const location = useLocation();
  const key = `${me.user.id}:${clinicId ?? ""}`;
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    if (!device?.ready || !clinicId || done === key) return;
    setDone(key);
    void device.openOnline(me, clinicId).then((r) => {
      // Only an installed app asks right away (spec §7.5); in a browser tab it's offered on the Device page.
      if (r === "needs_setup" && isInstalled() && location.pathname !== "/setup-offline") {
        navigate(`/setup-offline?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
      }
    });
  }, [device, clinicId, key, done, me, navigate, location]);
  return null;
}

/** Results waiting on this device are sent once someone is signed in, and again whenever the connection returns. */
function OutboxFlusher() {
  useEffect(() => {
    void flush();
    const again = () => void flush();
    window.addEventListener("online", again);
    const timer = window.setInterval(again, 60_000);
    return () => {
      window.removeEventListener("online", again);
      window.clearInterval(timer);
    };
  }, []);
  return null;
}

/** Full-screen staff pages without app navigation (e.g. a guardian signing consent). Still locks when idle. */
function BareScreen() {
  const signOut = useSignOut();
  useIdleTimeout(() => void signOut("idle"));
  return <Outlet />;
}

export const routes: RouteObject[] = [
  { path: "/", element: <Navigate to="/today" replace /> },
  { path: "/sign-in", element: <SignInPage /> },
  { path: "/sign-in/verify", element: <VerifyPage /> },
  { path: "/setup-mfa", element: <SetupMfaPage /> },
  { path: "/offline", element: <OfflineSignInPage /> },
  {
    element: <RequireStaff bare />,
    children: [
      { path: "/patients/:id/consent", element: <ConsentPage /> },
      { path: "/library/:gameId/preview", element: <GamePreviewPage /> },
      { path: "/session/:plannedSessionId", element: <SessionPage /> },
      { path: "/setup-offline", element: <SetupOfflinePage /> },
    ],
  },
  {
    element: <RequireStaff />,
    children: [
      { path: "/today", element: <TodayPage /> },
      { path: "/patients", element: <PatientsPage /> },
      { path: "/patients/new", element: <NewPatientPage /> },
      { path: "/patients/:id/edit", element: <EditPatientPage /> },
      {
        path: "/patients/:id",
        element: <PatientLayout />,
        children: [
          { index: true, element: <PatientOverview /> },
          { path: "progress", element: <PatientProgress /> },
          { path: "family", element: <PatientFamily /> },
        ],
      },
      { path: "/team", element: <TeamPage /> },
      { path: "/calendar", element: <ComingSoonPage area="calendar" /> },
      { path: "/protocols", element: <ProtocolsPage /> },
      { path: "/protocols/new", element: <TemplateBuilderPage /> },
      { path: "/protocols/:id/edit", element: <TemplateBuilderPage /> },
      { path: "/patients/:id/assign", element: <AssignPage /> },
      { path: "/library", element: <LibraryPage /> },
      { path: "/library/:gameId", element: <GamePage /> },
      { path: "/messages", element: <ComingSoonPage area="messages" /> },
      { path: "/reports", element: <ComingSoonPage area="reports" /> },
      { path: "/admin/videos", element: <VideosAdminPage /> },
      { path: "/admin/videos/:id", element: <VideoEditorPage /> },
      { path: "/settings", element: <SettingsPage /> },
      { path: "/more", element: <MorePage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });
}

export function App({ queryClient = makeQueryClient(), hashRouting = false }: { queryClient?: QueryClient; hashRouting?: boolean }) {
  const [router] = useState(() => (hashRouting ? createHashRouter : createBrowserRouter)(routes));
  return (
    <PrefsProvider>
      <DeviceProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </DeviceProvider>
    </PrefsProvider>
  );
}

