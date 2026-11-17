/**
 * Public consent page — the guardian opens this via the email link.
 * No authentication required. The token in the URL is the only key.
 *
 * Flow:
 *  1. Fetch consent data via GET /consent/:token
 *  2. Show consent text in the guardian's preferred language
 *  3. Guardian confirms identity, reads, checks all purposes, signs
 *  4. POST /consent/:token submits the consent
 *  5. Thank-you screen
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { IntlProvider, useIntl } from "react-intl";
import { CircleCheck, AlertTriangle } from "lucide-react";
import { CONSENT_PURPOSES, type ConsentPurpose, type Locale, type PublicConsentData } from "@emb/contracts";
import { Alert, Button, Card, CheckboxField, Logo, MazeLoader, TextField } from "@emb/ui";
import { catalogs, isRtl, type Locale as UiLocale, type MessageId } from "../i18n/index.tsx";

type State =
  | { step: "loading" }
  | { step: "error"; code: string }
  | { step: "form"; data: PublicConsentData }
  | { step: "done"; guardianName: string; locale: Locale };

function useT() {
  const intl = useIntl();
  return useCallback(
    (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values),
    [intl],
  );
}

export function PublicConsentPage() {
  const { token = "" } = useParams();
  const [state, setState] = useState<State>({ step: "loading" });

  useEffect(() => {
    if (!token) {
      setState({ step: "error", code: "not_found" });
      return;
    }
    let cancelled = false;
    fetch(`/consent/${encodeURIComponent(token)}`, { headers: { accept: "application/json" } })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => null) as { error?: string } | null;
          setState({ step: "error", code: body?.error ?? "unknown" });
          return;
        }
        const body = await res.json() as { consent: PublicConsentData };
        setState({ step: "form", data: body.consent });
      })
      .catch(() => {
        if (!cancelled) setState({ step: "error", code: "network" });
      });
    return () => { cancelled = true; };
  }, [token]);

  if (state.step === "loading") {
    return (
      <div className="handoff">
        <div className="handoff__top"><Logo /></div>
        <main id="main" className="handoff__main">
          <MazeLoader label="Loading…" />
        </main>
      </div>
    );
  }

  if (state.step === "error") {
    return <ErrorPage code={state.code} />;
  }

  const locale = state.step === "done" ? state.locale : state.data.locale;

  return (
    <IntlProvider locale={locale} messages={catalogs[locale as keyof typeof catalogs] ?? catalogs.en} defaultLocale="en">
      <div lang={locale} dir={isRtl(locale as UiLocale) ? "rtl" : "ltr"}>
        <div className="handoff">
          <div className="handoff__top"><Logo /></div>
          <main id="main" className="handoff__main">
            {state.step === "form" && (
              <ConsentForm
                data={state.data}
                token={token}
                onDone={(name, loc) => setState({ step: "done", guardianName: name, locale: loc })}
              />
            )}
            {state.step === "done" && <ThankYou name={state.guardianName} />}
          </main>
        </div>
      </div>
    </IntlProvider>
  );
}

function ErrorPage({ code }: { code: string }) {
  const title =
    code === "cancelled" ? "This consent request was cancelled"
    : code === "already_completed" ? "This consent has already been signed"
    : code === "not_found" ? "Consent request not found"
    : "Something went wrong";
  const body =
    code === "cancelled" ? "Please contact the clinic for a new consent request."
    : code === "already_completed" ? "No further action is needed. Thank you."
    : code === "not_found" ? "The link may have expired or is invalid."
    : "Please try again later or contact the clinic.";

  return (
    <div className="handoff">
      <div className="handoff__top"><Logo /></div>
      <main id="main" className="handoff__main">
        <Card>
          <div className="handoff__done">
            <AlertTriangle size={56} aria-hidden="true" className="handoff__doneicon" />
            <h1 className="auth__title">{title}</h1>
            <p className="auth__subtitle">{body}</p>
          </div>
        </Card>
      </main>
    </div>
  );
}

function ConsentForm({ data, token, onDone }: { data: PublicConsentData; token: string; onDone: (name: string, locale: Locale) => void }) {
  const t = useT();
  const [choices, setChoices] = useState<Record<ConsentPurpose, boolean>>(
    () => Object.fromEntries(CONSENT_PURPOSES.map((p) => [p, false])) as Record<ConsentPurpose, boolean>,
  );
  const [signer, setSigner] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!signer.trim()) return setError(t("consentDoc.signatureHint"));
    if (!email.trim()) return setError(t("errors.required"));
    if (!CONSENT_PURPOSES.every((p) => choices[p])) return setError(t("consentPub.allRequired"));
    if (!confirmed) return setError(t("consentDoc.needConfirm"));

    setSubmitting(true);
    try {
      const res = await fetch(`/consent/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          full_name: signer.trim(),
          email: email.trim(),
          phone: phone.trim() || null,
          locale: data.locale,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        const code = body?.error;
        if (code === "identity_mismatch") setError(t("consentPub.mismatch"));
        else if (code === "cancelled") setError(t("consentPub.expired"));
        else if (code === "already_completed") setError(t("consentPub.alreadyDone"));
        else setError(t("errors.generic"));
        setSubmitting(false);
        return;
      }
      onDone(signer.trim(), data.locale);
    } catch {
      setError(t("errors.generic"));
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <form className="handoff__form" onSubmit={(e) => void submit(e)} noValidate>
        <h1 className="auth__title">{t("consentDoc.title", { child: data.patient_first_name })}</h1>
        <p className="consent__intro">{t("consentDoc.intro", { clinic: data.clinic_name, child: data.patient_first_name })}</p>
        <p className="app-muted consent__draft">{t("consentDoc.draft")}</p>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="consent__items">
          {CONSENT_PURPOSES.map((purpose) => (
            <CheckboxField
              key={purpose}
              className="consent__item"
              label={t("consent.purpose", { purpose })}
              hint={t(`consentDoc.${purpose}` as MessageId)}
              {...(purpose === "treatment" ? { tag: t("consentDoc.required") } : {})}
              checked={choices[purpose]}
              onChange={(e) => {
                setChoices((c) => ({ ...c, [purpose]: e.target.checked }));
                setError(null);
              }}
            />
          ))}
        </div>
        <p className="app-muted">{t("consentPub.verifyHint")}</p>
        <TextField
          label={t("consentDoc.signature")}
          hint={t("consentDoc.signatureHint")}
          name="signer_name"
          autoComplete="name"
          value={signer}
          onChange={(e) => { setSigner(e.target.value); setError(null); }}
        />
        <TextField
          label={t("consentPub.email")}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          dir="ltr"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setError(null); }}
        />
        <TextField
          label={t("consentPub.phone")}
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          dir="ltr"
          value={phone}
          onChange={(e) => { setPhone(e.target.value); setError(null); }}
        />
        <CheckboxField
          label={t("consentDoc.confirm", { child: data.patient_first_name })}
          checked={confirmed}
          onChange={(e) => { setConfirmed(e.target.checked); setError(null); }}
        />
        <div className="pform__actions pform__actions--center">
          <Button type="submit" size="lg" loading={submitting}>
            {t("consentDoc.sign")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ThankYou({ name }: { name: string }) {
  const t = useT();
  return (
    <Card>
      <div className="handoff__done">
        <CircleCheck size={56} aria-hidden="true" className="handoff__doneicon" />
        <h1 className="auth__title">{t("consentDoc.thanks", { name })}</h1>
        <p className="auth__subtitle">{t("consentPub.thanksBody")}</p>
      </div>
    </Card>
  );
}
