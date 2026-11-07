/**
 * Setting up offline use on this device (offline devices spec §7.5): an offline password (8+ characters) and, where
 * the platform supports it, a passkey. It creates the therapist's own encrypted space on the device.
 */
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Alert, Button, CheckboxField, TextField } from "@emb/ui";
import { useMe } from "../api/queries.ts";
import { useT, type MessageId } from "../i18n/index.tsx";
import { useClinic } from "../lib/clinic.tsx";
import { useTitle } from "../lib/title.ts";
import { useDevice } from "../device/session.tsx";
import { validPassword } from "../device/crypto.ts";
import { createPrfCredential, prfSupported } from "../device/passkey.ts";
import { AuthLayout, safeNext } from "./auth.tsx";

export function SetupOfflinePage() {
  const t = useT();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const me = useMe();
  const { clinics, clinicId } = useClinic();
  const device = useDevice();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [usePasskey, setUsePasskey] = useState(true);
  const [canPasskey, setCanPasskey] = useState(false);
  const [error, setError] = useState<MessageId | null>(null);
  const [busy, setBusy] = useState(false);
  useTitle(t("setupOffline.title"));

  useEffect(() => {
    void prfSupported().then(setCanPasskey);
  }, []);

  const clinic = clinics.find((c) => c.id === clinicId);
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!validPassword(password)) return setError("setupOffline.tooShort");
    if (password !== repeat) return setError("setupOffline.mismatch");
    if (!me.data || !clinic) return;
    setError(null);
    setBusy(true);
    try {
      const user = me.data.user;
      await device.setupOffline(me.data, { id: clinic.id, name: clinic.name }, {
        password,
        ...(canPasskey && usePasskey ? { makePrf: (spaceId: string) => createPrfCredential(user, spaceId) } : {}),
      });
      navigate(next, { replace: true });
    } catch {
      setError("setupOffline.failed");
    } finally {
      setBusy(false);
    }
  };
  const later = async () => {
    if (me.data) await device.skipSetup(me.data.user.id);
    navigate(next, { replace: true });
  };

  return (
    <AuthLayout>
      <h1 className="auth__title">{t("setupOffline.title")}</h1>
      <p className="auth__subtitle">{t("setupOffline.body")}</p>
      <p className="app-muted">{t("setupOffline.shared")}</p>
      <form className="auth__form" onSubmit={(e) => void onSubmit(e)} noValidate>
        {error && <Alert tone="danger">{t(error)}</Alert>}
        <TextField
          label={t("setupOffline.password")}
          type="password"
          autoComplete="new-password"
          hint={t("setupOffline.rules")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={error === "setupOffline.tooShort" || undefined}
        />
        <TextField
          label={t("setupOffline.repeat")}
          type="password"
          autoComplete="new-password"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          aria-invalid={error === "setupOffline.mismatch" || undefined}
        />
        {canPasskey && <CheckboxField label={t("setupOffline.passkey")} checked={usePasskey} onChange={(e) => setUsePasskey(e.target.checked)} />}
        <Button type="submit" loading={busy}>
          {t("setupOffline.submit")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => void later()} disabled={busy}>
          {t("setupOffline.later")}
        </Button>
      </form>
    </AuthLayout>
  );
}
