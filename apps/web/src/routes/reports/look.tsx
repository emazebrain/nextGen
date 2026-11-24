/**
 * The pieces of Reports that Today shows as well: who is worth a look and why, and the wording of a trend.
 * Kept apart from reports.tsx so Today does not load the report charts.
 */
import { Link } from "react-router";
import { Avatar, Chip } from "@emb/ui";
import type { CaseloadReason, CaseloadRow, TrendSummary } from "../../api/queries.ts";
import { useT, type MessageId } from "../../i18n/index.tsx";
import { iso } from "../../lib/format.ts";

const fullName = (p: { given_name: string; family_name: string }) => `${p.given_name} ${p.family_name}`;
export const progressHref = (id: string) => `/patients/${encodeURIComponent(id)}/progress`;

export const TREND_LABEL: Record<TrendSummary, MessageId> = {
  improving: "reports.trend.improving",
  steady: "reports.trend.steady",
  declining: "reports.trend.declining",
  not_enough: "reports.trend.not_enough",
};

export function reasonText(t: ReturnType<typeof useT>, r: CaseloadReason): string {
  if (r.kind === "inactive") return r.days === undefined ? t("reports.reason.inactiveNever") : t("reports.reason.inactive", { days: r.days });
  if (r.kind === "declining" || r.kind === "stepped_down") return t(`reports.reason.${r.kind}`);
  return t(`reports.reason.${r.kind}`, { count: r.count ?? 1 });
}

/** The patients with a reason to look, most reasons first (as the server ordered them). Also shown on Today. */
/** `compact` (Today's narrower card): the whole row opens the patient, with no separate button. */
export function LookList({ patients, limit, compact = false }: { patients: CaseloadRow[]; limit?: number; compact?: boolean }) {
  const t = useT();
  const list = limit ? patients.slice(0, limit) : patients;
  return (
    <ul className="plainlist rlook">
      {list.map((p) => {
        const name = iso(fullName(p));
        const review = p.reasons.some((r) => r.kind === "review");
        return (
          <li key={p.patient_id} className={`rlook__item${compact ? " rlook__item--compact" : ""}`}>
            <Avatar name={fullName(p)} size={38} />
            <div className="rlook__text">
              {compact ? (
                <Link to={progressHref(p.patient_id)} className="rlook__name emb-stretched">
                  <bdi>{fullName(p)}</bdi>
                </Link>
              ) : (
                <span className="rlook__name">
                  <bdi>{fullName(p)}</bdi>
                </span>
              )}
              <span className="rlook__reasons">
                {p.reasons.map((r) => (
                  <Chip key={r.kind} tone={r.kind === "review" ? "warning" : "neutral"}>
                    {reasonText(t, r)}
                  </Chip>
                ))}
              </span>
            </div>
            {!compact && (
              <Link to={progressHref(p.patient_id)} className="emb-btn emb-btn--secondary rlook__go" aria-label={t(review ? "reports.look.reviewFor" : "reports.look.openFor", { name })}>
                <span>{t(review ? "reports.look.review" : "reports.look.open")}</span>
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

