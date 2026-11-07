/**
 * The shell's sync status (offline devices spec §7.6): offline, results waiting to be sent (or a sign-in needed to
 * send them), content updating, and an app update ready to apply.
 */
import { CloudOff, RefreshCw, UploadCloud } from "lucide-react";
import { Button, Chip } from "@emb/ui";
import { useT } from "../i18n/index.tsx";
import { useOutboxStatus } from "../session/outbox.ts";
import { useRefreshState } from "./refresh.tsx";
import { useAppUpdate } from "./update.ts";
import { useOptionalDevice } from "./session.tsx";
import { useSavedFrom } from "./bundle.ts";

export function SyncStatus() {
  const t = useT();
  const device = useOptionalDevice();
  const outbox = useOutboxStatus();
  const refresh = useRefreshState();
  const update = useAppUpdate();
  const savedFrom = useSavedFrom();
  const offline = savedFrom !== null || (device ? !device.online : false);
  return (
    <span className="sync-status" aria-live="polite">
      {offline && (
        <Chip tone="neutral" icon={<CloudOff size={14} aria-hidden="true" />}>
          {t("sync.offline")}
        </Chip>
      )}
      {outbox.waiting > 0 && (
        <Chip tone="warning" icon={<UploadCloud size={14} aria-hidden="true" />}>
          {outbox.needsSignIn && !offline ? t("sync.signIn") : t("sync.waiting", { count: outbox.waiting })}
        </Chip>
      )}
      {refresh.refreshing && (
        <Chip tone="neutral" icon={<RefreshCw size={14} aria-hidden="true" />}>
          {t("sync.updating")}
        </Chip>
      )}
      {update.ready && (
        <Button variant="secondary" onClick={() => update.apply()}>
          {t("sync.applyUpdate")}
        </Button>
      )}
    </span>
  );
}
