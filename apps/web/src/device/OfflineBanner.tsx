/**
 * Offline cues (offline devices spec §7.6, design doc §5.3 offline banner): "Showing saved data from 10:42" while
 * answers come from the device, and a guard for actions that need a connection (editing waits for project 3).
 */
import { CloudOff } from "lucide-react";
import { useIntl } from "react-intl";
import { Alert } from "@emb/ui";
import { useT } from "../i18n/index.tsx";
import { useSavedFrom } from "./bundle.ts";
import { useOptionalDevice } from "./session.tsx";

export function OfflineBanner() {
  const t = useT();
  const intl = useIntl();
  const from = useSavedFrom();
  if (!from) return null;
  return (
    <p role="status" className="offline-banner">
      <CloudOff size={16} aria-hidden="true" />
      <span>{t("offline.saved", { time: intl.formatTime(from, { hour: "2-digit", minute: "2-digit" }) })}</span>
    </p>
  );
}

/** True while the app is working from saved data: anything that writes to the server has to wait. */
export function useNeedsConnection(): boolean {
  const from = useSavedFrom();
  const device = useOptionalDevice();
  return from !== null || (!!device?.space && !device.online);
}

export function NeedsConnection() {
  const t = useT();
  return <Alert tone="info">{t("offline.needsConnection")}</Alert>;
}
