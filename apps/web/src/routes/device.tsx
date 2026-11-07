/**
 * Settings → This device (offline devices spec §7.6): whether games and videos play from this device or from the
 * network, what's stored and how much space it takes, Download everything, the therapists who use this device, and
 * installing the app.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { useIntl } from "react-intl";
import { CloudDownload, Trash2 } from "lucide-react";
import type { LibraryManifest } from "@emb/contracts";
import { Alert, Button, Card, Chip, ConfirmDialog, PageHeader } from "@emb/ui";
import { apiGet, apiSend } from "../api/http.ts";
import { useMe } from "../api/queries.ts";
import { useT } from "../i18n/index.tsx";
import { useClinic } from "../lib/clinic.tsx";
import { useTitle } from "../lib/title.ts";
import { getContentMode, removeDownloadedVideos, setContentMode, storedSummary, type ContentMode } from "../device/content.ts";
import { getMeta, setMeta } from "../device/db.ts";
import { syncDeviceVideos } from "../device/bundle.ts";
import { useInstall } from "../device/install.ts";
import { useRefreshState } from "../device/refresh.tsx";
import { useDevice } from "../device/session.tsx";
import { listSpaces, removeSpace, type SpaceInfo } from "../device/spaces.ts";
import { retryNeedsHelp, useOutboxStatus } from "../session/outbox.ts";

export function DevicePage() {
  const t = useT();
  const intl = useIntl();
  const me = useMe();
  const device = useDevice();
  const { isManager, clinicId } = useClinic();
  const install = useInstall();
  const refresh = useRefreshState();
  const outbox = useOutboxStatus();
  const modeName = useId();
  const [mode, setMode] = useState<ContentMode | null>(null);
  const [stored, setStored] = useState<{ videos: number; bytes: number; last_update: string | null }>({ videos: 0, bytes: 0, last_update: null });
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [library, setLibrary] = useState<LibraryManifest["videos"] | null>(null);
  const [asking, setAsking] = useState<"download" | "remove" | { space: SpaceInfo } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [spaces, setSpaces] = useState<SpaceInfo[]>([]);
  useTitle(t("device.title"));

  const mb = (bytes: number) => intl.formatNumber(bytes / 1_000_000, { style: "unit", unit: "megabyte", maximumFractionDigits: bytes < 10_000_000 ? 1 : 0 });
  const chosen = useRef(false);
  const load = async () => {
    // Once someone picks a mode here, a reload (the device finishing its own loading) mustn't put the old one back.
    const m = await getContentMode();
    if (!chosen.current) setMode(m);
    setStored(await storedSummary());
    setSpaces(await listSpaces());
    const e = await navigator.storage?.estimate?.().catch(() => undefined);
    if (e?.quota) setUsage({ usage: e.usage ?? 0, quota: e.quota });
  };
  useEffect(() => {
    void load();
    void apiGet<LibraryManifest>("/v1/offline/library").then((l) => setLibrary(l.videos), () => setLibrary(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device.spaces]);

  const choose = async (m: ContentMode) => {
    chosen.current = true;
    setMode(m);
    await setContentMode(m);
    if (m === "local") void runSync();
  };
  const runSync = async () => {
    setProblem(null);
    setProgress({ done: 0, total: 0 });
    try {
      const r = await syncDeviceVideos((done, total) => setProgress({ done, total }));
      if (r && r.skipped_for_space.length) setProblem(t("device.noSpace", { size: mb(r.skipped_for_space.reduce((n, v) => n + v.bytes, 0)) }));
      else if (r && r.failed.length) setProblem(t("device.someFailed", { count: r.failed.length }));
    } finally {
      setProgress(null);
      await load();
    }
  };
  const libraryBytes = (library ?? []).reduce((n, v) => n + v.bytes, 0);
  const myId = me.data?.user.id ?? device.space?.info.user_id ?? null;

  const removeOne = async (s: SpaceInfo) => {
    const id = device.deviceId ?? (await getMeta<string>("device_id"));
    if (s.user_id === myId && device.space?.id === s.id) await device.signOut();
    else {
      if (id) await apiSend("DELETE", `/v1/devices/${id}/spaces/${s.id}`).catch(() => undefined);
      await removeSpace(s.id);
      await device.refreshSpaces();
    }
    setSpaces(await listSpaces());
  };
  const canRemove = (s: SpaceInfo) => s.user_id === myId || (isManager && s.clinic_id === clinicId);
  const own = spaces.some((s) => s.user_id === myId);

  return (
    <div className="app-page app-page--narrow">
      <PageHeader title={t("device.title")} eyebrow={<Link to="/settings">{t("settings.title")}</Link>} />
      <div className="settings">
        <Card as="section" labelledBy="dev-content">
          <h2 id="dev-content" className="app-cardtitle">
            {t("device.content")}
          </h2>
          <fieldset className="choice">
            <legend className="emb-field__label">{t("device.playFrom")}</legend>
            {(["local", "network"] as const).map((m) => (
              <label key={m} className={mode === m ? "choice__option is-selected" : "choice__option"}>
                <input type="radio" name={modeName} value={m} checked={mode === m} onChange={() => void choose(m)} />
                <span>
                  <strong>{t(m === "local" ? "device.mode.local" : "device.mode.network")}</strong>
                  <span className="app-muted device__hint">{t(m === "local" ? "device.mode.localHint" : "device.mode.networkHint")}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {mode === "network" && <p className="app-muted">{t("device.networkNote")}</p>}
          <dl className="app-dl device__storage">
            <div>
              <dt>{t("device.videosStored")}</dt>
              <dd>{t("device.videosValue", { count: stored.videos, size: mb(stored.bytes) })}</dd>
            </div>
            <div>
              <dt>{t("device.games")}</dt>
              <dd>{t("device.gamesValue")}</dd>
            </div>
            {usage && (
              <div>
                <dt>{t("device.space")}</dt>
                <dd>{t("device.spaceValue", { used: mb(usage.usage), free: mb(Math.max(0, usage.quota - usage.usage)) })}</dd>
              </div>
            )}
            <div>
              <dt>{t("device.lastUpdate")}</dt>
              <dd>{stored.last_update ? intl.formatDate(stored.last_update, { dateStyle: "medium", timeStyle: "short" }) : t("device.never")}</dd>
            </div>
          </dl>
          {problem && <Alert tone="warning">{problem}</Alert>}
          {progress && (
            <div className="video-editor__progress" role="status">
              <progress max={progress.total || 1} value={progress.done} aria-label={t("device.downloading")} />
              <span>{t("device.downloadingCount", { done: progress.done, total: progress.total })}</span>
            </div>
          )}
          <div className="settings__actions">
            <Button icon={<CloudDownload size={18} aria-hidden="true" />} disabled={!library || !!progress} onClick={() => setAsking("download")}>
              {t("device.downloadAll", { size: mb(libraryBytes) })}
            </Button>
            <Button variant="secondary" icon={<Trash2 size={18} aria-hidden="true" />} disabled={!stored.videos || !!progress} onClick={() => setAsking("remove")}>
              {t("device.removeVideos")}
            </Button>
            <Button variant="ghost" loading={refresh.refreshing} disabled={!device.space} onClick={() => void refresh.refreshNow().then(load)}>
              {t("device.updateNow")}
            </Button>
          </div>
          {(outbox.waiting > 0 || outbox.needsHelp > 0) && (
            <p className="app-muted">
              {t("sync.waiting", { count: outbox.waiting })}
              {outbox.needsHelp > 0 && ` · ${t("sync.needsHelp", { count: outbox.needsHelp })}`}
            </p>
          )}
          {outbox.needsHelp > 0 && (
            <Button variant="secondary" onClick={() => void retryNeedsHelp()}>
              {t("common.retry")}
            </Button>
          )}
        </Card>

        <Card as="section" labelledBy="dev-people">
          <h2 id="dev-people" className="app-cardtitle">
            {t("device.people")}
          </h2>
          {!own && me.data && (
            <Alert tone="info">
              {t("device.notSetUp")} <Link to="/setup-offline?next=/settings/device">{t("setupOffline.submit")}</Link>
            </Alert>
          )}
          <ul className="plainlist device__people" aria-label={t("device.people")}>
            {spaces.map((s) => (
              <li key={s.id} className="device__person">
                <span>
                  <bdi>{s.display_name}</bdi>
                  <span className="app-muted device__hint">
                    {s.clinic_name} · {t("offline.lastOnline", { date: intl.formatDate(s.last_online_at, { day: "numeric", month: "short" }) })}
                  </span>
                </span>
                {canRemove(s) && (
                  <Button variant="ghost" aria-label={t("device.removeSpaceOf", { name: s.display_name })} onClick={() => setAsking({ space: s })}>
                    {t("device.remove")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <Card as="section" labelledBy="dev-install">
          <h2 id="dev-install" className="app-cardtitle">
            {t("device.install")}
          </h2>
          {install.installed ? (
            <Chip tone="success">{t("device.installed")}</Chip>
          ) : install.canPrompt ? (
            <Button onClick={() => void install.prompt()}>{t("device.installButton")}</Button>
          ) : (
            <p className="app-muted">{t(install.ios ? "device.installIos" : "device.installOther")}</p>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={asking === "download"}
        title={t("device.downloadAll.title")}
        confirmLabel={t("device.downloadAll.confirm")}
        cancelLabel={t("common.cancel")}
        onCancel={() => setAsking(null)}
        onConfirm={() => {
          setAsking(null);
          void setMeta("library_wanted", library).then(() => (mode === "local" ? runSync() : choose("local")));
        }}
      >
        {t("device.downloadAll.body", { size: mb(libraryBytes), count: library?.length ?? 0 })}
      </ConfirmDialog>
      <ConfirmDialog
        open={asking === "remove"}
        title={t("device.removeVideos.title")}
        confirmLabel={t("device.removeVideos")}
        cancelLabel={t("common.cancel")}
        tone="danger"
        onCancel={() => setAsking(null)}
        onConfirm={() => {
          setAsking(null);
          void setMeta("library_wanted", null)
            .then(() => removeDownloadedVideos())
            .then(load);
        }}
      >
        {t("device.removeVideos.body")}
      </ConfirmDialog>
      <ConfirmDialog
        open={typeof asking === "object" && asking !== null}
        title={t("device.removeSpace.title", { name: typeof asking === "object" && asking ? asking.space.display_name : "" })}
        confirmLabel={t("device.remove")}
        cancelLabel={t("common.cancel")}
        tone="danger"
        onCancel={() => setAsking(null)}
        onConfirm={() => {
          const s = typeof asking === "object" && asking ? asking.space : null;
          setAsking(null);
          if (s) void removeOne(s);
        }}
      >
        {t("device.removeSpace.body")}
      </ConfirmDialog>
    </div>
  );
}

