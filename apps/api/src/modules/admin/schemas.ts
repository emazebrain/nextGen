/**
 * Zod schemas for /v1/admin input validation.
 */
import { z } from "zod";

const locale = z.enum(["he", "en", "ar", "ru", "fr", "es", "zh"]);
const name = z.string().trim().min(1).max(255);

/** An IANA time zone this runtime knows (the same list the browser offers). */
const timezone = z
  .string()
  .min(1)
  .max(100)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  });

export const orgStatus = z.enum(["active", "suspended", "closed"]);
export const userStatus = z.enum(["active", "invited", "disabled"]);

export const createOrgSchema = z.object({
  name,
  region: z.enum(["il", "us", "eu"]),
  default_locale: locale.default("he"),
});

export const patchOrgSchema = z.object({
  name: name.optional(),
  status: orgStatus.optional(),
  default_locale: locale.optional(),
});

export const createClinicSchema = z.object({
  name,
  country_code: z
    .string()
    .regex(/^[A-Za-z]{2}$/)
    .transform((s) => s.toUpperCase()),
  timezone,
});

/** A letterhead detail for progress reports: trimmed, and empty means "none". */
const detail = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v ? v : null));

export const patchClinicSchema = z.object({
  name: name.optional(),
  status: z.enum(["active", "inactive", "pending"]).optional(),
  timezone: timezone.optional(),
  address: detail(300).optional(),
  phone: detail(40).optional(),
  license_no: detail(60).optional(),
});

export const createUserSchema = z.object({
  // Sign-in looks emails up in lower case, so they are stored that way.
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.string().email().max(254)),
  full_name: name,
  role: z.enum(["platform_admin", "org_admin", "clinic_manager", "therapist", "assistant"]),
  organization_id: z.string().uuid(),
  clinic_id: z.string().uuid().nullable().optional(),
});

/** An admin can disable an account or re-enable it; 'invited' is only ever set by creating the user. */
export const patchUserSchema = z.object({
  full_name: name.optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

export const listUsersQuery = z.object({
  org_id: z.string().uuid().optional(),
  clinic_id: z.string().uuid().optional(),
  status: userStatus.optional(),
});
