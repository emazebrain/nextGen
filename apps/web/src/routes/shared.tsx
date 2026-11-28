/** Small pieces shared by patient screens. */
import { Alert, Button, Chip, type ChipTone } from "@emb/ui";
import { ApiError } from "../api/http.ts";
import type { PatientStatus } from "../api/queries.ts";
import { useT } from "../i18n/index.tsx";
import { ageParts } from "../lib/format.ts";

export const statusTone: Record<PatientStatus, ChipTone> = {
  active: "success",
  pending_consent: "warning",
  consent_legacy: "warning",
  inactive: "neutral",
  discharged: "neutral",
};

/** "Therapist: Yael Bar" — who the patient is assigned to, shown wherever a patient is shown. Nothing when unassigned. */
export function TherapistOf({ names, className = "" }: { names?: readonly string[] | null | undefined; className?: string }) {
  const t = useT();
  const list = (names ?? []).filter(Boolean);
  if (list.length === 0) return null;
  return (
    <span className={`app-muted app-therapist ${className}`.trim()}>
      {t("patient.therapistOf", { count: list.length })} <bdi>{list.join(", ")}</bdi>
    </span>
  );
}

export const fullName = (p: { given_name: string; family_name: string }) => `${p.given_name} ${p.family_name}`;

export function useAge() {
  const t = useT();
  return (dob: string) => {
    const { years, months } = ageParts(dob);
    return years >= 2 ? t("age.years", { years }) : t("age.months", { months });
  };
}

export function StatusChip({ status }: { status: PatientStatus }) {
  const t = useT();
  return <Chip tone={statusTone[status] ?? "neutral"}>{t("patients.status", { status })}</Chip>;
}

export function LoadError({ error, retry }: { error: unknown; retry: () => void }) {
  const t = useT();
  const network = error instanceof ApiError && error.status === 0;
  const ref = error instanceof ApiError ? error.requestId : undefined;
  return (
    <Alert
      tone="danger"
      title={t(network ? "errors.network" : "errors.generic")}
      action={
        <Button variant="secondary" onClick={retry}>
          {t("common.retry")}
        </Button>
      }
    >
      {ref && <span className="app-ref">{t("errors.reference", { id: ref })}</span>}
    </Alert>
  );
}

