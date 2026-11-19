/**
 * Patients, guardians and consent (design doc §5.3, §11.3). These schemas
 * validate API input and type the app's forms, so both sides agree.
 */
import { z } from "zod";

export const LOCALES = ["he", "en", "ar", "ru", "fr", "es", "zh"] as const;
export const SEXES = ["female", "male", "other", "undisclosed"] as const;
export const HANDEDNESS = ["left", "right", "mixed"] as const;
export const RELATIONSHIPS = ["mother", "father", "parent", "grandparent", "legal_guardian", "foster_parent", "other"] as const;
/** "treatment" is the legal record's word; the UI calls it "clinic sessions". */
export const CONSENT_PURPOSES = ["treatment", "home_program", "messaging", "research_deidentified"] as const;
export const PATIENT_STATUSES = ["pending_consent", "consent_legacy", "active", "inactive", "discharged"] as const;

/** Bumped whenever the consent wording changes; stored on every consent row. */
export const CONSENT_POLICY_VERSION = "draft-2026-10";

export type Locale = (typeof LOCALES)[number];
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];
export type PatientStatus = (typeof PATIENT_STATUSES)[number];
export type Relationship = (typeof RELATIONSHIPS)[number];

const name = z.string().trim().min(1).max(100);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

/** A date of birth: a real calendar date, not in the future, child or adult up to 120 years. */
export const dateOfBirth = isoDate.refine((s) => {
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  const valid = dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  const now = new Date();
  return valid && dt.getTime() <= now.getTime() && y >= now.getUTCFullYear() - 120;
}, "invalid_date_of_birth");

const patientFields = {
  given_name: name,
  family_name: name,
  date_of_birth: dateOfBirth,
  preferred_locale: z.enum(LOCALES),
  sex: z.enum(SEXES).nullable().optional(),
  handedness: z.enum(HANDEDNESS).nullable().optional(),
  alert: z.string().trim().max(500).nullable().optional(),
  colour_vision_deficiency: z.boolean().optional(),
};

export const createPatient = z.object({
  clinic_id: uuid,
  ...patientFields,
  /** Primary therapist. Defaults to the creator; only managers may choose someone else. */
  therapist_id: uuid.optional(),
  /** Set after the user has seen the duplicate warning and chose to continue. */
  allow_duplicate: z.boolean().optional(),
});
export type CreatePatient = z.infer<typeof createPatient>;

export const updatePatient = z
  .object({
    ...patientFields,
    /** Therapists may mark a patient inactive or discharged; "active" re-checks consent. */
    status: z.enum(["active", "inactive", "discharged"]),
  })
  .partial();
export type UpdatePatient = z.infer<typeof updatePatient>;

export const CONSENT_REQUEST_STATUSES = ["pending", "completed", "cancelled"] as const;
export type ConsentRequestStatus = (typeof CONSENT_REQUEST_STATUSES)[number];

const email = z.string().trim().max(254).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "invalid_email");
const phone = z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/, "invalid_phone");

export const guardianFields = z.object({
  full_name: name,
  relationship: z.enum(RELATIONSHIPS),
  is_legal_guardian: z.boolean(),
  email: email.nullable().optional(),
  phone: phone.nullable().optional(),
  preferred_locale: z.enum(LOCALES),
});
export type GuardianInput = z.infer<typeof guardianFields>;

/** Guardian entry for the consent request form (therapist fills this). */
const consentGuardianEntry = z.object({
  full_name: name,
  email: email,
  relationship: z.enum(RELATIONSHIPS),
  phone: phone.nullable().optional(),
  preferred_locale: z.enum(LOCALES),
});

/** Request consent via email: 1 or 2 guardians. */
export const requestConsent = z.object({
  guardians: z.array(consentGuardianEntry).min(1).max(2),
});
export type RequestConsent = z.infer<typeof requestConsent>;

/** Submit consent from the public page (guardian signs). */
export const submitConsent = z.object({
  full_name: name,
  email: email,
  phone: phone.nullable().optional(),
  locale: z.enum(LOCALES),
});
export type SubmitConsent = z.infer<typeof submitConsent>;

export const recordConsent = z.object({
  guardian_id: uuid,
  /** The guardian's typed full name: their signature. */
  signer_name: name,
  /** The language the consent text was shown in. */
  locale: z.enum(LOCALES),
  decisions: z
    .object(Object.fromEntries(CONSENT_PURPOSES.map((p) => [p, z.enum(["granted", "withdrawn"]).optional()])) as Record<ConsentPurpose, z.ZodOptional<z.ZodEnum<{ granted: "granted"; withdrawn: "withdrawn" }>>>)
    .refine((d) => Object.values(d).some(Boolean), "no_decisions"),
});
export type RecordConsent = z.infer<typeof recordConsent>;

// ---- Response shapes

export interface PatientListItem {
  id: string;
  clinic_id: string;
  given_name: string;
  family_name: string;
  date_of_birth: string;
  status: PatientStatus;
  has_alert: boolean;
  archived: boolean;
}

export interface GuardianView {
  id: string;
  full_name: string;
  relationship: Relationship;
  is_legal_guardian: boolean;
  email: string | null;
  phone: string | null;
  preferred_locale: Locale;
  /** True when the guardian has created a parent portal account. */
  has_portal_account: boolean;
}

export interface ConsentState {
  purpose: ConsentPurpose;
  decision: "granted" | "withdrawn";
  signed_at: string;
  signer_name: string | null;
  guardian_name: string | null;
  captured_by_name: string | null;
}

export interface PatientDetail {
  id: string;
  clinic_id: string;
  given_name: string;
  family_name: string;
  date_of_birth: string;
  preferred_locale: Locale;
  status: PatientStatus;
  sex: (typeof SEXES)[number] | null;
  handedness: (typeof HANDEDNESS)[number] | null;
  alert: string | null;
  colour_vision_deficiency: boolean;
  archived: boolean;
  can_play: boolean;
  care_team: Array<{ user_id: string; full_name: string; role: "primary" | "secondary" | "assistant" }>;
  guardians: GuardianView[];
  consents: ConsentState[];
  consent_requests: ConsentRequestView[];
}

export interface ConsentRequestView {
  id: string;
  guardian_id: string;
  guardian_name: string;
  guardian_email: string;
  status: ConsentRequestStatus;
  sent_at: string;
  completed_at: string | null;
}

/** Data returned by the public GET /v1/consent/:token endpoint. */
export interface PublicConsentData {
  clinic_name: string;
  patient_first_name: string;
  guardian_name: string;
  guardian_email: string;
  locale: Locale;
  policy_version: string;
  purposes: typeof CONSENT_PURPOSES;
}

export interface StaffMember {
  id: string;
  full_name: string;
  email: string;
  roles: string[];
}
