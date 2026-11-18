/**
 * Sign-in, two-factor verification and first-time MFA enrolment
 * (design doc §3 T1, §11.2; ADR 0004). No puzzles, paste allowed, password
 * managers and one-time-code autofill work (WCAG 3.3.8).
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Check, Copy, Download, KeyRound, ShieldCheck, Smartphone } from "lucide-react";
import { Alert, Button, CodeField, Logo, LogoMark, MazeLoader, Segmented, TextField } from "@emb/ui";
import { authClient, authFailure, type AuthFailure } from "../api/auth.ts";
import { meKey } from "../api/queries.ts";
import { useT, usePrefs, locales, type Locale, type MessageId } from "../i18n/index.tsx";
import { useTitle } from "../lib/title.ts";

/** Only same-app paths are accepted as a return address. */
export function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/today";
}

export function failureMessage(f: AuthFailure, invalid: MessageId): MessageId {
  if (f === "rate_limited") return "auth.rateLimited";
  if (f === "network") return "errors.network";
  if (f === "expired") return "auth.verify.expired";
  if (f === "invalid") return invalid;
  return "errors.generic";
}

export function LanguageSwitch() {
  const t = useT();
  const { locale, setLocale } = usePrefs();
  return (
    <Segmented<Locale>
      legend={<span className="emb-vh">{t("language.label")}</span>}
      name="language"
      value={locale}
      onChange={setLocale}
      options={locales.map((l) => ({ value: l, label: <span lang={l}>{t(`language.${l}`)}</span> }))}
    />
  );
}

export function AuthLayout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const t = useT();
  return (
    <div className="auth">
      <aside className="auth__brand" aria-hidden="true">
        <div className="auth__brandinner">
          <span className="auth__mark">
            <LogoMark size={56} />
          </span>
          <p className="auth__tagline">{t("auth.brand.tagline")}</p>
          <p className="auth__brandbody">{t("auth.brand.body")}</p>
        </div>
        <svg className="auth__maze" viewBox="0 0 400 400" fill="none">
          <path
            d="M20 380 V300 H100 V220 H40 V40 H200 V120 H120 V160 H280 V60 H360 V240 H200 V320 H300 V380"
            stroke="currentColor"
            strokeWidth="14"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </aside>
      <main className="auth__main" id="main">
        <div className="auth__top">
          <span className="auth__logo">
            <Logo />
          </span>
          <LanguageSwitch />
        </div>
        <div className={wide ? "auth__panel auth__panel--wide" : "auth__panel"}>{children}</div>
      </main>
    </div>
  );
}

// ------------------------------------------------------------------ Sign in

export function SignInPage() {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const reason = params.get("reason");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageId | null>(null);
  useTitle(t("auth.signIn.title"));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("auth.signIn.missing");
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error: err } = await authClient.signIn.email({ email: email.trim(), password }).catch(() => ({ data: null, error: { status: 0 } }));
    setBusy(false);
    if (err || !data) {
      setError(failureMessage(authFailure(err), "auth.signIn.invalid"));
      return;
    }
    if ("twoFactorRedirect" in data && data.twoFactorRedirect) {
      navigate(`/sign-in/verify?next=${encodeURIComponent(next)}`);
      return;
    }
    // Signed in without a code: either a trusted device, or MFA not set up yet (the guard sends them to enrolment).
    qc.removeQueries({ queryKey: meKey });
    navigate(next, { replace: true });
  };

  return (
    <AuthLayout>
      <h1 className="auth__title">{t("auth.signIn.title")}</h1>
      <p className="auth__subtitle">{t("auth.signIn.subtitle")}</p>
      {import.meta.env.MODE === "demo" && <Alert tone="info">{t("auth.signIn.demo")}</Alert>}
      {reason === "idle" && !error && <Alert tone="info">{t("auth.signIn.idle")}</Alert>}
      {reason === "signed_out" && !error && <Alert tone="success">{t("auth.signIn.signedOut")}</Alert>}
      {error && <Alert tone="danger">{t(error)}</Alert>}
      <form className="auth__form" onSubmit={submit} noValidate>
        <TextField
          label={t("auth.email")}
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          dir="ltr"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={error === "auth.signIn.invalid" || undefined}
        />
        <TextField
          label={t("auth.password")}
          type="password"
          name="password"
          autoComplete="current-password"
          dir="ltr"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={error === "auth.signIn.invalid" || undefined}
        />
        <Button type="submit" size="lg" block loading={busy}>
          {t("auth.signIn.submit")}
        </Button>
      </form>
      <div className="auth__links">
        <Link to="/forgot-password" className="app-linkbtn">
          {t("auth.signIn.forgotPassword")}
        </Link>
      </div>
    </AuthLayout>
  );
}

// ------------------------------------------------------------------ Forgot password

export function ForgotPasswordPage() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<MessageId | null>(null);
  useTitle(t("auth.forgotPassword.title"));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError("auth.signIn.missing");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await authClient
      .requestPasswordReset({ email: email.trim(), redirectTo: `${window.location.origin}/reset-password` })
      .catch(() => ({ error: { status: 0 } }));
    setBusy(false);
    if (err && (err as { status?: number }).status === 429) {
      setError("auth.rateLimited");
      return;
    }
    // Always show "sent" to avoid leaking whether the email exists.
    setSent(true);
  };

  return (
    <AuthLayout>
      <span className="auth__icon">
        <KeyRound size={28} aria-hidden="true" />
      </span>
      <h1 className="auth__title">{t("auth.forgotPassword.title")}</h1>
      <p className="auth__subtitle">{t("auth.forgotPassword.subtitle")}</p>
      {sent && <Alert tone="success">{t("auth.forgotPassword.sent")}</Alert>}
      {error && <Alert tone="danger">{t(error)}</Alert>}
      {!sent && (
        <form className="auth__form" onSubmit={submit} noValidate>
          <TextField
            label={t("auth.email")}
            type="email"
            name="email"
            autoComplete="username"
            inputMode="email"
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button type="submit" size="lg" block loading={busy} disabled={!email.trim()}>
            {t("auth.forgotPassword.submit")}
          </Button>
        </form>
      )}
      <div className="auth__links">
        <Link to="/sign-in" className="app-linkbtn">
          {t("auth.forgotPassword.backToSignIn")}
        </Link>
      </div>
    </AuthLayout>
  );
}

// ------------------------------------------------------------------ Reset password (from email link)

const RESET_MIN_LENGTH = 12;

export function ResetPasswordPage() {
  const t = useT();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token");
  const tokenError = params.get("error");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageId | null>(null);
  const [fieldError, setFieldError] = useState<"tooShort" | "mismatch" | null>(null);
  const [done, setDone] = useState(false);
  useTitle(t("auth.resetPassword.title"));

  if (tokenError || !token) {
    return (
      <AuthLayout>
        <span className="auth__icon">
          <KeyRound size={28} aria-hidden="true" />
        </span>
        <h1 className="auth__title">{t("auth.resetPassword.title")}</h1>
        <Alert tone="danger">{t("auth.resetPassword.invalidToken")}</Alert>
        <div className="auth__links">
          <Link to="/forgot-password" className="app-linkbtn">
            {t("auth.resetPassword.tryAgain")}
          </Link>
        </div>
      </AuthLayout>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < RESET_MIN_LENGTH) {
      setFieldError("tooShort");
      return;
    }
    if (password !== confirm) {
      setFieldError("mismatch");
      return;
    }
    setFieldError(null);
    setBusy(true);
    const { error: err } = await authClient
      .resetPassword({ newPassword: password, token })
      .catch(() => ({ error: { status: 0 } }));
    setBusy(false);
    if (err) {
      const f = authFailure(err);
      if (f === "rate_limited") setError("auth.rateLimited");
      else setError("auth.resetPassword.failed");
      return;
    }
    setDone(true);
  };

  if (done) {
    return (
      <AuthLayout>
        <span className="auth__icon">
          <KeyRound size={28} aria-hidden="true" />
        </span>
        <h1 className="auth__title">{t("auth.resetPassword.title")}</h1>
        <Alert tone="success">{t("auth.resetPassword.success")}</Alert>
        <div className="auth__links">
          <Button size="lg" block onClick={() => navigate("/sign-in", { replace: true })}>
            {t("auth.signIn.title")}
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <span className="auth__icon">
        <KeyRound size={28} aria-hidden="true" />
      </span>
      <h1 className="auth__title">{t("auth.resetPassword.title")}</h1>
      <p className="auth__subtitle">{t("auth.resetPassword.subtitle")}</p>
      {error && <Alert tone="danger">{t(error)}</Alert>}
      <form className="auth__form" onSubmit={submit} noValidate>
        <TextField
          label={t("auth.resetPassword.newPassword")}
          hint={fieldError === "tooShort" ? undefined : t("auth.changePassword.tooShort")}
          error={fieldError === "tooShort" ? t("auth.changePassword.tooShort") : undefined}
          type="password"
          name="new-password"
          autoComplete="new-password"
          dir="ltr"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <TextField
          label={t("auth.resetPassword.confirmPassword")}
          error={fieldError === "mismatch" ? t("auth.changePassword.mismatch") : undefined}
          type="password"
          name="confirm-password"
          autoComplete="new-password"
          dir="ltr"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <Button type="submit" size="lg" block loading={busy} disabled={!password || !confirm}>
          {t("auth.resetPassword.submit")}
        </Button>
      </form>
    </AuthLayout>
  );
}

// ------------------------------------------------------------------ Verify

export function VerifyPage() {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const [mode, setMode] = useState<"app" | "backup">("app");
  const [code, setCode] = useState("");
  const [trust, setTrust] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthFailure | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const lastAuto = useRef("");
  useTitle(t(mode === "app" ? "auth.verify.title" : "auth.verify.backupTitle"));

  const submit = async (value = code) => {
    if (busy) return;
    const clean = mode === "app" ? value.replace(/\D/g, "") : value.trim();
    if (mode === "app" && clean.length !== 6) return;
    if (mode === "backup" && clean.length < 6) return;
    setBusy(true);
    setError(null);
    const res =
      mode === "app"
        ? await authClient.twoFactor.verifyTotp({ code: clean, trustDevice: trust }).catch(() => ({ data: null, error: { status: 0 } }))
        : await authClient.twoFactor.verifyBackupCode({ code: clean, trustDevice: trust }).catch(() => ({ data: null, error: { status: 0 } }));
    setBusy(false);
    if (res.error) {
      setError(authFailure(res.error));
      setCode("");
      input.current?.focus();
      return;
    }
    qc.removeQueries({ queryKey: meKey });
    navigate(next, { replace: true });
  };

  const onChange = (v: string) => {
    const value = mode === "app" ? v.replace(/\D/g, "").slice(0, 6) : v.slice(0, 32);
    setCode(value);
    // Submit as soon as six digits are in (typed, pasted or autofilled), once per value.
    if (mode === "app" && value.length === 6 && lastAuto.current !== value) {
      lastAuto.current = value;
      void submit(value);
    }
  };

  const switchMode = () => {
    setMode((m) => (m === "app" ? "backup" : "app"));
    setCode("");
    setError(null);
    lastAuto.current = "";
    requestAnimationFrame(() => input.current?.focus());
  };

  return (
    <AuthLayout>
      <span className="auth__icon">{mode === "app" ? <Smartphone size={28} aria-hidden="true" /> : <KeyRound size={28} aria-hidden="true" />}</span>
      <h1 className="auth__title">{t(mode === "app" ? "auth.verify.title" : "auth.verify.backupTitle")}</h1>
      <p className="auth__subtitle">{t(mode === "app" ? "auth.verify.body" : "auth.verify.backupBody")}</p>
      {error && (
        <Alert tone="danger">
          {t(failureMessage(error, "auth.verify.invalid"))}
          {error === "expired" && (
            <>
              {" "}
              <Link to="/sign-in">{t("auth.signIn.title")}</Link>
            </>
          )}
        </Alert>
      )}
      <form
        className="auth__form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {mode === "app" ? (
          <CodeField ref={input} label={t("auth.verify.code")} name="code" maxLength={6} value={code} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <TextField
            ref={input}
            label={t("auth.verify.backupCode")}
            name="backup"
            autoComplete="off"
            spellCheck={false}
            dir="ltr"
            className="emb-field--code"
            value={code}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
        <label className="app-check">
          <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} />
          <span>
            <span className="app-check__label">{t("auth.verify.trust")}</span>
            <span className="app-check__hint">{t("auth.verify.trustHint")}</span>
          </span>
        </label>
        <Button type="submit" size="lg" block loading={busy} disabled={mode === "app" ? code.length !== 6 : code.trim().length < 6}>
          {t("auth.verify.submit")}
        </Button>
      </form>
      <div className="auth__links">
        <button type="button" className="app-linkbtn" onClick={switchMode}>
          {t(mode === "app" ? "auth.verify.useBackup" : "auth.verify.useApp")}
        </button>
        <Link to="/sign-in" className="app-linkbtn">
          {t("auth.verify.otherAccount")}
        </Link>
      </div>
    </AuthLayout>
  );
}

// ------------------------------------------------------------------ MFA enrolment

type Enrolment = { totpURI: string; backupCodes: string[] };

export function SetupMfaPage() {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const session = authClient.useSession();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [password, setPassword] = useState("");
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageId | null>(null);
  const [saved, setSaved] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useTitle(t("mfa.title"));

  const user = session.data?.user as { email: string; twoFactorEnabled?: boolean } | undefined;

  useEffect(() => {
    if (session.isPending) return;
    if (!session.data) navigate("/sign-in?next=%2Fsetup-mfa", { replace: true });
    else if (user?.twoFactorEnabled && step === 1) navigate("/today", { replace: true });
  }, [session.isPending, session.data, user?.twoFactorEnabled, step, navigate]);

  // Each new step starts with its heading, for screen readers and keyboard users.
  useEffect(() => {
    if (step > 1) heading.current?.focus();
  }, [step]);

  if (session.isPending || !session.data) return <MazeLoader label={t("common.loading")} />;

  const start = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    const { data, error: err } = await authClient.twoFactor.enable({ password }).catch(() => ({ data: null, error: { status: 0 } }));
    setBusy(false);
    if (err || !data) {
      setError(failureMessage(authFailure(err), "auth.signIn.invalid"));
      return;
    }
    setEnrolment(data as Enrolment);
    setPassword("");
    setStep(2);
  };

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) return;
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.twoFactor.verifyTotp({ code }).catch(() => ({ error: { status: 0 } }));
    setBusy(false);
    if (err) {
      setError(failureMessage(authFailure(err), "auth.verify.invalid"));
      setCode("");
      return;
    }
    setStep(3);
  };

  const finish = async () => {
    qc.removeQueries({ queryKey: meKey });
    navigate("/today", { replace: true });
  };

  return (
    <AuthLayout wide>
      <p className="auth__eyebrow">{t("mfa.progress", { current: step, total: 3 })}</p>
      <div className="stepper" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <span key={n} className={n <= step ? "stepper__seg is-done" : "stepper__seg"} />
        ))}
      </div>

      {step === 1 && (
        <>
          <span className="auth__icon">
            <ShieldCheck size={28} aria-hidden="true" />
          </span>
          <h1 className="auth__title">{t("mfa.title")}</h1>
          <p className="auth__subtitle">{t("mfa.intro")}</p>
          <Alert tone="info">{t("mfa.step1.apps")}</Alert>
          {error && <Alert tone="danger">{t(error)}</Alert>}
          <form className="auth__form" onSubmit={start} noValidate>
            <input type="email" name="username" autoComplete="username" value={user?.email ?? ""} readOnly hidden />
            <TextField
              label={t("mfa.step1.title")}
              type="password"
              name="password"
              autoComplete="current-password"
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button type="submit" size="lg" block loading={busy} disabled={!password}>
              {t("common.continue")}
            </Button>
          </form>
        </>
      )}

      {step === 2 && enrolment && (
        <>
          <h1 className="auth__title" ref={heading} tabIndex={-1}>
            {t("mfa.step2.title")}
          </h1>
          <p className="auth__subtitle">{t("mfa.step2.body")}</p>
          <div className="mfa-scan">
            <QrImage value={enrolment.totpURI} alt={t("mfa.step2.qrAlt")} />
            <ManualKey uri={enrolment.totpURI} />
          </div>
          {error && <Alert tone="danger">{t(error)}</Alert>}
          <form className="auth__form" onSubmit={confirm} noValidate>
            <CodeField
              label={t("mfa.step2.code")}
              name="code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
            <Button type="submit" size="lg" block loading={busy} disabled={code.length !== 6}>
              {t("mfa.step2.submit")}
            </Button>
          </form>
        </>
      )}

      {step === 3 && enrolment && (
        <>
          <Alert tone="success">{t("mfa.step3.enabled")}</Alert>
          <h1 className="auth__title" ref={heading} tabIndex={-1}>
            {t("mfa.step3.title")}
          </h1>
          <p className="auth__subtitle">{t("mfa.step3.body")}</p>
          <BackupCodes codes={enrolment.backupCodes} email={user?.email ?? ""} />
          <label className="app-check">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            <span className="app-check__label">{t("mfa.step3.confirm")}</span>
          </label>
          <Button size="lg" block disabled={!saved} onClick={() => void finish()}>
            {t("mfa.step3.done")}
          </Button>
        </>
      )}
    </AuthLayout>
  );
}

function QrImage({ value, alt }: { value: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(value, { margin: 1, width: 440, errorCorrectionLevel: "M", color: { dark: "#111827", light: "#ffffff" } })
      .then((url) => live && setSrc(url))
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [value]);
  return <div className="mfa-qr">{src ? <img src={src} alt={alt} width={220} height={220} /> : <span className="mfa-qr__placeholder" />}</div>;
}

function ManualKey({ uri }: { uri: string }) {
  const t = useT();
  const secret = useMemo(() => {
    try {
      return new URL(uri).searchParams.get("secret") ?? "";
    } catch {
      return "";
    }
  }, [uri]);
  const grouped = secret.replace(/(.{4})/g, "$1 ").trim();
  return (
    <details className="mfa-manual">
      <summary>{t("mfa.step2.manual")}</summary>
      <div className="mfa-manual__body">
        <p className="mfa-manual__label">{t("mfa.step2.key")}</p>
        <p className="mfa-manual__key" dir="ltr" data-testid="totp-secret" data-secret={secret}>
          {grouped}
        </p>
        <CopyButton text={secret} label={t("common.copy")} />
      </div>
    </details>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [copied]);
  return (
    <>
      <Button
        variant="secondary"
        icon={copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => {});
        }}
      >
        {copied ? t("common.copied") : label}
      </Button>
      <span className="emb-vh" aria-live="polite">
        {copied ? t("common.copied") : ""}
      </span>
    </>
  );
}

function BackupCodes({ codes, email }: { codes: string[]; email: string }) {
  const t = useT();
  const download = () => {
    const body = `${t("mfa.file.header", { email })}\n\n${codes.join("\n")}\n`;
    const url = URL.createObjectURL(new Blob([body], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "emazebrain-backup-codes.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="mfa-codes">
      <ol className="mfa-codes__list" aria-label={t("mfa.step3.listLabel")} dir="ltr">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <div className="mfa-codes__actions">
        <CopyButton text={codes.join("\n")} label={t("mfa.step3.copy")} />
        <Button variant="secondary" icon={<Download size={18} aria-hidden="true" />} onClick={download}>
          {t("mfa.step3.download")}
        </Button>
      </div>
    </div>
  );
}
