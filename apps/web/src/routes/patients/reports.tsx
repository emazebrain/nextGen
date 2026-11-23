/**
 * Progress reports for one patient (migration 0042): the list on the Progress tab, the form that issues one, and
 * the page that shows it for printing or saving as PDF. Nothing is emailed: the therapist hands the document over
 * or shares it into the parent portal.
 */
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useIntl } from "react-intl";
import { FileText, Printer } from "lucide-react";
import { Alert, Button, Card, Chip, MazeLoader, PageHeader, Segmented, TextField } from "@emb/ui";
import { ApiError } from "../../api/http.ts";
import { useCreateProgressReport, useProgressReport, useProgressReports, useShareProgressReport, type ProgressReportSummary, type ReportAudience } from "../../api/progress-reports.ts";
import { locales, useT, type Locale, type MessageId } from "../../i18n/index.tsx";
import { useTitle } from "../../lib/title.ts";
import { LoadError } from "../shared.tsx";
import { BackLink } from "../admin/common.tsx";
import { ReportDocument } from "../reports/ReportDocument.tsx";

const SUMMARY_MAX = 2000;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** One line per issued report. Used by staff and, with its own link, by the parent portal. */
export function ReportList({ reports, href }: { reports: ProgressReportSummary[]; href: (r: ProgressReportSummary) => string }) {
  const t = useT();
  const intl = useIntl();
  const day = (s: string) => intl.formatDate(new Date(`${s}T00:00:00`), { day: "numeric", month: "short", year: "numeric" });
  return (
    <ul className="plainlist preports">
      {reports.map((r) => (
        <li key={r.id} className="preports__item">
          <FileText size={20} aria-hidden="true" />
          <span className="preports__text">
            <Link to={href(r)} className="preports__link">
              {t("pr.ui.listItem", { from: day(r.period_from), to: day(r.period_to) })}
            </Link>
            <span className="app-muted">
              {t(`pr.ui.audience.${r.audience}` as MessageId)} · {t("pr.ui.by", { name: r.author_name })}
            </span>
          </span>
          {r.shared_with_family && <Chip tone="brand">{t("pr.ui.shared")}</Chip>}
        </li>
      ))}
    </ul>
  );
}

/** The card on the patient's Progress tab. */
export function ProgressReportsCard({ patientId }: { patientId: string }) {
  const t = useT();
  const reports = useProgressReports(patientId);
  return (
    <Card as="section" labelledBy="preports-title">
      <div className="progress-head">
        <h2 id="preports-title" className="app-cardtitle">
          {t("pr.ui.section")}
        </h2>
        <Link to={`/patients/${patientId}/reports/new`} className="emb-btn emb-btn--secondary">
          <span>{t("pr.ui.new")}</span>
        </Link>
      </div>
      {reports.isPending ? (
        <MazeLoader label={t("common.loading")} />
      ) : reports.isError ? (
        <LoadError error={reports.error} retry={() => void reports.refetch()} />
      ) : reports.data.length === 0 ? (
        <p className="app-muted">{t("pr.ui.empty")}</p>
      ) : (
        <ReportList reports={reports.data} href={(r) => `/patients/${patientId}/reports/${r.id}`} />
      )}
    </Card>
  );
}

export function NewProgressReportPage() {
  const t = useT();
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const create = useCreateProgressReport(id);
  useTitle(t("pr.ui.newTitle"));

  const [from, setFrom] = useState(() => ymd(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(() => ymd(new Date()));
  const [audience, setAudience] = useState<ReportAudience>("family");
  const [locale, setLocale] = useState<Locale>("he");
  const [summary, setSummary] = useState("");
  const [share, setShare] = useState(false);
  const [error, setError] = useState<MessageId | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const span = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    if (!from || !to || Number.isNaN(span) || span < 0 || span > 366) return setError("pr.ui.datesInvalid");
    try {
      const r = await create.mutateAsync({ from, to, audience, locale, summary: summary.trim(), shared_with_family: share });
      navigate(`/patients/${id}/reports/${r.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError && err.status === 0 ? "errors.network" : err instanceof ApiError && err.status === 400 ? "pr.ui.datesInvalid" : "errors.generic");
    }
  };

  return (
    <div className="app-page app-page--narrow">
      <BackLink to={`/patients/${id}/progress`}>{t("pr.ui.back")}</BackLink>
      <PageHeader title={t("pr.ui.newTitle")} description={t("pr.ui.newIntro")} />
      <Card>
        <form className="pform" onSubmit={(e) => void submit(e)} noValidate>
          {error && <Alert tone="danger">{t(error)}</Alert>}
          <div className="preports__dates">
            <TextField label={t("pr.ui.from")} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            <TextField label={t("pr.ui.to")} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Segmented<ReportAudience>
            legend={t("pr.ui.audience")}
            name="report-audience"
            value={audience}
            onChange={setAudience}
            options={[
              { value: "family", label: t("pr.ui.audience.family") },
              { value: "formal", label: t("pr.ui.audience.formal") },
            ]}
          />
          <Segmented<Locale>
            legend={t("pr.ui.language")}
            name="report-locale"
            value={locale}
            onChange={setLocale}
            options={locales.map((l) => ({ value: l, label: l === "he" ? "עברית" : "English" }))}
          />
          <div className="emb-field">
            <label className="emb-field__label" htmlFor="report-summary">
              {t("pr.ui.summary")}
            </label>
            <span className="emb-field__hint" id="report-summary-hint">
              {t("pr.ui.summaryHint")}
            </span>
            <textarea
              id="report-summary"
              className="emb-textarea"
              rows={6}
              maxLength={SUMMARY_MAX}
              dir="auto"
              aria-describedby="report-summary-hint"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
            <span className="app-muted emb-tnum preports__count">
              {summary.length} / {SUMMARY_MAX}
            </span>
          </div>
          <label className="preports__share">
            <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
            <span>{t("pr.ui.share")}</span>
          </label>
          <div className="pform__actions">
            <Button type="submit" loading={create.isPending}>
              {t("pr.ui.create")}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

/** The bar above a report: a way back, the print button and whatever else the screen adds. Hidden on paper. */
export function ReportToolbar({ back, backLabel, children }: { back: string; backLabel: string; children?: React.ReactNode }) {
  const t = useT();
  return (
    <div className="rdoc-bar no-print">
      <BackLink to={back}>{backLabel}</BackLink>
      <div className="rdoc-bar__actions">
        {children}
        <Button icon={<Printer size={18} aria-hidden="true" />} onClick={() => window.print()}>
          {t("pr.ui.print")}
        </Button>
      </div>
      <p className="app-muted rdoc-bar__hint">{t("pr.ui.printHint")}</p>
    </div>
  );
}

export function ProgressReportPage() {
  const t = useT();
  const { id = "", rid = "" } = useParams<{ id: string; rid: string }>();
  const report = useProgressReport(rid);
  useTitle(t("pr.title"));

  if (report.isPending) return <MazeLoader label={t("common.loading")} />;
  if (report.isError) {
    return (
      <div className="app-page">
        <LoadError error={report.error} retry={() => void report.refetch()} />
      </div>
    );
  }
  return (
    <div className="app-page rdoc-page">
      <ReportToolbar back={`/patients/${id}/progress`} backLabel={t("pr.ui.back")}>
        <ShareSwitch report={report.data} />
      </ReportToolbar>
      <ReportDocument report={report.data} />
    </div>
  );
}

function ShareSwitch({ report }: { report: { id: string; patient_id: string; shared_with_family: boolean } }) {
  const t = useT();
  const share = useShareProgressReport(report);
  return (
    <>
      <Chip tone={report.shared_with_family ? "brand" : "neutral"}>{t(report.shared_with_family ? "pr.ui.shared" : "pr.ui.notShared")}</Chip>
      <Button variant="secondary" loading={share.isPending} onClick={() => share.mutate(!report.shared_with_family)}>
        {t(report.shared_with_family ? "pr.ui.shareOff" : "pr.ui.shareOn")}
      </Button>
    </>
  );
}
