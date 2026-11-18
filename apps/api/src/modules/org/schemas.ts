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
