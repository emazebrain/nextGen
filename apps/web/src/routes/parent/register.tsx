/** Parent portal registration — from a portal invite link (§5.10). */
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, MazeLoader, PageHeader, TextField } from "@emb/ui";
import { getPortalInvite, registerParent } from "../../api/parent.ts";
import { useT, type MessageId } from "../../i18n/index.tsx";
import { useTitle } from "../../lib/title.ts";

interface InviteInfo {
  guardian_name: string;
  guardian_email: string;
  clinic_name: string;
  has_existing_account?: boolean;
}

export function ParentRegisterPage() {
  const t = useT();
  const { token } = useParams<{ token: string }>();
  useTitle(t("parent.register.title"));

  const invite = useQuery({
    queryKey: ["portal-invite", token],
    queryFn: () => getPortalInvite(token!) as Promise<InviteInfo>,
    enabled: !!token,
    retry: false,
  });

  if (!token) return <div className="app-page"><p>{t("errors.generic")}</p></div>;
  if (invite.isPending) return <MazeLoader label={t("common.loading")} />;
  if (invite.isError) {
    const code = (invite.error as { code?: string })?.code;
    const msg = code === "already_accepted" || code === "already_registered"
      ? t("parent.register.alreadyUsed")
      : code === "cancelled"
        ? t("parent.register.cancelled")
        : t("parent.register.invalid");
    return (
      <div className="app-page app-page--narrow" style={{ paddingBlockStart: "4rem" }}>
        <Card><Alert tone="danger">{msg}</Alert></Card>
      </div>
    );
  }

  // If the user already has an account, show a message instead of the registration form
  if (invite.data.has_existing_account) {
    return <ExistingAccountPage invite={invite.data} token={token} />;
  }

  return <RegisterForm token={token} invite={invite.data} />;
}

function ExistingAccountPage({ invite, token }: { invite: InviteInfo; token: string }) {
  const t = useT();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [linked, setLinked] = useState(false);

  const linkAccount = async () => {
    setBusy(true);
    try {
      // Call the register endpoint which will detect the existing account and just link it
      await registerParent(token, "__existing__");
      setLinked(true);
    } catch {
      // If it fails, just direct them to sign in
      setLinked(true);
    } finally {
      setBusy(false);
    }
  };

  if (linked) {
    return (
      <div className="app-page app-page--narrow" style={{ paddingBlockStart: "4rem", textAlign: "center" }}>
        <Card>
          <h2>{t("parent.register.linkedTitle")}</h2>
          <p style={{ marginBlockEnd: "1.5rem" }}>{t("parent.register.linkedBody")}</p>
          <div className="pform__actions" style={{ justifyContent: "center" }}>
            <Button onClick={() => navigate("/sign-in")}>{t("parent.register.signIn")}</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="app-page app-page--narrow" style={{ paddingBlockStart: "2rem" }}>
      <PageHeader
        title={t("parent.register.existingTitle")}
        description={t("parent.register.existingIntro", { clinic: invite.clinic_name })}
      />
      <Card>
        <div className="pform">
          <Alert tone="info">{t("parent.register.existingMessage", { email: invite.guardian_email })}</Alert>

          <TextField label={t("parent.register.name")} value={invite.guardian_name} disabled />
          <TextField label={t("parent.register.email")} value={invite.guardian_email} disabled />

          <div className="pform__actions">
            <Button onClick={() => void linkAccount()} loading={busy}>
              {t("parent.register.linkAccount")}
            </Button>
          </div>

          <p className="app-muted" style={{ textAlign: "center", marginBlockStart: "var(--space-3)" }}>
            {t("parent.register.forgotHint")}{" "}
            <Link to="/forgot-password">{t("parent.register.resetPassword")}</Link>
          </p>
        </div>
      </Card>
    </div>
  );
}

function RegisterForm({ token, invite }: { token: string; invite: InviteInfo }) {
  const t = useT();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<MessageId | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 12) { setError("parent.register.passwordShort"); return; }
    if (password !== confirm) { setError("parent.register.passwordMismatch"); return; }

    setBusy(true);
    setError(null);
    try {
      await registerParent(token, password);
      navigate("/parent/register/success", { replace: true });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "already_registered") setError("parent.register.alreadyUsed");
      else setError("errors.generic");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-page app-page--narrow" style={{ paddingBlockStart: "2rem" }}>
      <PageHeader
        title={t("parent.register.title")}
        description={t("parent.register.intro", { clinic: invite.clinic_name })}
      />
      <Card>
        <form className="pform" onSubmit={(e) => void submit(e)} noValidate>
          {error && <Alert tone="danger">{t(error)}</Alert>}

          <TextField label={t("parent.register.name")} value={invite.guardian_name} disabled />
          <TextField label={t("parent.register.email")} value={invite.guardian_email} disabled />
          <TextField
            label={t("parent.register.password")}
            name="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(null); }}
          />
          <TextField
            label={t("parent.register.confirmPassword")}
            name="confirm_password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => { setConfirm(e.target.value); setError(null); }}
          />

          <p className="pform__hint">{t("parent.register.passwordHint")}</p>

          <div className="pform__actions">
            <Button type="submit" loading={busy}>
              {t("parent.register.submit")}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

export function ParentRegisterSuccessPage() {
  const t = useT();
  const navigate = useNavigate();
  useTitle(t("parent.register.successTitle"));

  return (
    <div className="app-page app-page--narrow" style={{ paddingBlockStart: "4rem", textAlign: "center" }}>
      <Card>
        <h2>{t("parent.register.successTitle")}</h2>
        <p style={{ marginBlockEnd: "1.5rem" }}>{t("parent.register.successBody")}</p>
        <Button onClick={() => navigate("/sign-in")}>{t("parent.register.signIn")}</Button>
      </Card>
    </div>
  );
}
