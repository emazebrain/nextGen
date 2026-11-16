/**
 * Zod schemas for /v1/admin input validation.
 */
import { z } from "zod";

export const createOrgSchema = z.object({
  name: z.string().min(1).max(255),
  region: z.enum(["il", "us", "eu"]),
  default_locale: z.enum(["he", "en", "ar", "ru", "fr", "es", "zh"]).default("he"),
});

export const patchOrgSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  status: z.enum(["active", "suspended", "closed"]).optional(),
  default_locale: z.enum(["he", "en", "ar", "ru", "fr", "es", "zh"]).optional(),
});

export const createClinicSchema = z.object({
  name: z.string().min(1).max(255),
  country_code: z.string().length(2),
  timezone: z.string().min(1).max(100),
});

export const patchClinicSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  status: z.enum(["active", "inactive", "pending"]).optional(),
});

export const createUserSchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(1).max(255),
  role: z.enum(["platform_admin", "org_admin", "clinic_manager", "therapist", "assistant"]),
  organization_id: z.string().uuid(),
  clinic_id: z.string().uuid().nullable().optional(),
});

export const patchUserSchema = z.object({
  full_name: z.string().min(1).max(255).optional(),
  status: z.enum(["active", "invited", "disabled"]).optional(),
});
