/**
 * Zod schemas for /v1/org input validation (org-admin routes).
 */
import { z } from "zod";

const name = z.string().trim().min(1).max(255);

/** An IANA time zone this runtime knows. */
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

export { createClinicSchema, patchClinicSchema } from "../admin/schemas.ts";

/** Org admins can only create clinic-scoped roles. */
export const createStaffSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.string().email().max(254)),
  full_name: name,
  role: z.enum(["clinic_manager", "therapist", "assistant"]),
  clinic_id: z.string().uuid(),
});

export const patchStaffSchema = z.object({
  full_name: name.optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

export const listStaffQuery = z.object({
  clinic_id: z.string().uuid().optional(),
  status: z.enum(["active", "invited", "disabled"]).optional(),
});

export const listOrgPatientsQuery = z.object({
  clinic_id: z.string().uuid().optional(),
  archived: z.enum(["0", "1"]).optional(),
});

export const createOrgPatientSchema = z.object({
  clinic_id: z.string().uuid(),
  given_name: z.string().trim().min(1).max(255),
  family_name: z.string().trim().min(1).max(255),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  preferred_locale: z.string().min(2).max(10),
  sex: z.enum(["female", "male", "other", "undisclosed"]).nullable().optional(),
  handedness: z.enum(["left", "right", "mixed"]).nullable().optional(),
  alert: z.string().trim().max(500).nullable().optional(),
  colour_vision_deficiency: z.boolean().optional(),
  therapist_id: z.string().uuid().optional(),
  allow_duplicate: z.boolean().optional(),
});
