/**
 * Forced password change (system admin spec §Forced Password Change). Someone invited by an admin signs in with a
 * temporary password; RequireStaff sends them here until they have replaced it and their account is active.
 */
import { useState, type FormEvent } from "react";
import { Navigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { Alert, Button, MazeLoader, TextField } from "@emb/ui";
import { authClient, authFailure } from "../api/auth.ts";
import { apiSend } from "../api/http.ts";
import { meKey, useMe } from "../api/queries.ts";
import { useT, type MessageId } from "../i18n/index.tsx";
import { useTitle } from "../lib/title.ts";
import { AuthLayout, failureMessage } from "./auth.tsx";

/** Matches the server's minimum (apps/api/src/auth.ts). */
const MIN_LENGTH = 12;

export function ChangePasswordPage() {
  const t = useT();
  const me = useMe();
  const qc = useQueryClient();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageId | null>(null);
  const [fieldError, setFieldError] = useState<"tooShort" | "mismatch" | null>(null);
  // The password is already replaced but the account isn't active yet (the second call failed): only retry that.
  const [changed, setChanged] = useState(false);
  useTitle(t("auth.changePassword.title"));

  if (!me.data) return <MazeLoader label={t("common.loading")} />;
  if (me.data.user_status !== "invited") return <Navigate to="/today" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!changed) {
      if (next.length < MIN_LENGTH) return setFieldError("tooShort");
      if (next !== confirm) return setFieldError("mismatch");
    }
    setFieldError(null);
    setBusy(true);
    if (!changed) {
      const { error: err } = await authClient
        .changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true })
        .catch(() => ({ error: { status: 0 } }));
      if (err) {
        setBusy(false);
        setError(failureMessage(authFailure(err), "auth.changePassword.invalid"));
        return;
      }
      setChanged(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    }
    try {
      await apiSend("PATCH", "/v1/me/status", { status: "active" });
    } catch {
      setBusy(false);
      setError("errors.generic");
      return;
    }
    // /v1/me now says "active", and the redirect above opens the app.
    await qc.invalidateQueries({ queryKey: meKey });
    setBusy(false);
  };

  return (
    <AuthLayout>
      <span className="auth__icon">
        <KeyRound size={28} aria-hidden="true" />
      </span>
      <h1 className="auth__title">{t("auth.changePassword.title")}</h1>
      <p className="auth__subtitle">{t("auth.changePassword.subtitle")}</p>
      {changed && !error && !busy && <Alert tone="success">{t("auth.changePassword.success")}</Alert>}
      {error && <Alert tone="danger">{t(error)}</Alert>}
      <form className="auth__form" onSubmit={submit} noValidate>
        <input type="email" name="username" autoComplete="username" value={me.data.user.email} readOnly hidden />
        {!changed && (
          <>
            <TextField
              label={t("auth.changePassword.currentPassword")}
              type="password"
              name="current-password"
              autoComplete="current-password"
              dir="ltr"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
            <TextField
              label={t("auth.changePassword.newPassword")}
              hint={fieldError === "tooShort" ? undefined : t("auth.changePassword.tooShort")}
              error={fieldError === "tooShort" ? t("auth.changePassword.tooShort") : undefined}
              type="password"
              name="new-password"
              autoComplete="new-password"
              dir="ltr"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            <TextField
              label={t("auth.changePassword.confirmPassword")}
              error={fieldError === "mismatch" ? t("auth.changePassword.mismatch") : undefined}
              type="password"
              name="confirm-password"
              autoComplete="new-password"
              dir="ltr"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </>
        )}
        <Button type="submit" size="lg" block loading={busy} disabled={!changed && (!current || !next || !confirm)}>
          {changed ? t("common.continue") : t("auth.changePassword.submit")}
        </Button>
      </form>
    </AuthLayout>
  );
}
