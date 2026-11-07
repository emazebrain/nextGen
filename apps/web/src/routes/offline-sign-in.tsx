/**
 * Offline sign-in on a shared tablet (offline devices spec §7.5): pick yourself from this device's therapists and
 * unlock your own space with your offline password or passkey.
 */
import { useEffect, useId, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useIntl } from "react-intl";
import { Fingerprint } from "lucide-react";
import { Alert, Button, TextField } from "@emb/ui";
import { useT } from "../i18n/index.tsx";
import { useDevice } from "../device/session.tsx";
import { canUnlockOffline } from "../device/spaces.ts";
import { prfSupported } from "../device/passkey.ts";
import { useTitle } from "../lib/title.ts";
import { AuthLayout, safeNext } from "./auth.tsx";

type Problem = { kind: "wrong"; n: number } | { kind: "locked"; seconds: number } | { kind: "passkey" } | null;

export function OfflineSignInPage() {
  const t = useT();
  const intl = useIntl();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const device = useDevice();
  const [chosen, setChosen] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [passkey, setPasskey] = useState(false);
  const legend = useId();
  useTitle(t("offline.title"));

  useEffect(() => {
    void prfSupported().then(setPasskey);
  }, []);
  useEffect(() => {
    if (device.spaces.length === 1 && !chosen) setChosen(device.spaces[0]!.id);
  }, [device.spaces, chosen]);

  const info = device.spaces.find((s) => s.id === chosen) ?? null;
  const tooOld = info ? !canUnlockOffline(info) : false;

  const finish = async (cred: { password: string } | { prf: true }) => {
    if (!info) return;
    setBusy(true);
    setProblem(null);
    try {
      const r = await device.openOffline(info.id, cred);
      if ("read" in r) navigate(next, { replace: true });
      else if ("expired" in r) setProblem(null);
      else if (r.locked_ms > 0) setProblem({ kind: "locked", seconds: Math.ceil(r.locked_ms / 1000) });
      else setProblem({ kind: "wrong", n: r.tries_left });
    } catch {
      setProblem({ kind: "passkey" });
    } finally {
      setBusy(false);
    }
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (password) void finish({ password });
  };

  return (
    <AuthLayout>
      <h1 className="auth__title">{t("offline.title")}</h1>
      <p className="auth__subtitle">{t("offline.body")}</p>
      {device.ready && device.spaces.length === 0 ? (
        <Alert tone="info">{t("offline.none")}</Alert>
      ) : (
        <form className="auth__form" onSubmit={onSubmit} noValidate>
          <p id={legend} className="emb-field__label">
            {t("offline.pick")}
          </p>
          <div role="radiogroup" aria-labelledby={legend} className="offline__people">
            {device.spaces.map((s) => (
              <label key={s.id} className={chosen === s.id ? "choice__option is-selected" : "choice__option"}>
                <input
                  type="radio"
                  name="who"
                  value={s.id}
                  checked={chosen === s.id}
                  onChange={() => {
                    setChosen(s.id);
                    setPassword("");
                    setProblem(null);
                  }}
                />
                <span>
                  <bdi>{s.display_name}</bdi>
                  <span className="app-muted offline__meta">
                    {device.spaces.some((o) => o.user_id === s.user_id && o.id !== s.id) ? `${s.clinic_name} · ` : ""}
                    {t("offline.lastOnline", { date: intl.formatDate(s.last_online_at, { day: "numeric", month: "short" }) })}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {info && tooOld && (
            <Alert tone="warning">
              {t("offline.tooOld")} <Link to={`/sign-in?next=${encodeURIComponent(next)}`}>{t("offline.signInOnline")}</Link>
            </Alert>
          )}
          {info && !tooOld && (
            <>
              {problem?.kind === "wrong" && <Alert tone="danger">{t("offline.wrong", { n: problem.n })}</Alert>}
              {problem?.kind === "locked" && <Alert tone="danger">{t("offline.locked", { seconds: problem.seconds })}</Alert>}
              {problem?.kind === "passkey" && <Alert tone="warning">{t("offline.passkeyFailed")}</Alert>}
              {passkey && info.wrapped.prf && (
                <Button type="button" variant="secondary" icon={<Fingerprint size={18} aria-hidden="true" />} disabled={busy} onClick={() => void finish({ prf: true })}>
                  {t("offline.useFace")}
                </Button>
              )}
              <TextField label={t("offline.password")} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <Button type="submit" loading={busy} disabled={!password}>
                {t("offline.unlock")}
              </Button>
            </>
          )}
        </form>
      )}
    </AuthLayout>
  );
}
