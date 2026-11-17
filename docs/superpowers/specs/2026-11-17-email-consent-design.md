# Email-Based Parental Consent Flow — Design Document

**Author:** Barak (barak@metgo.app)  
**Date:** 2026-11-17  
**Status:** Draft — awaiting approval

---

## 1. Why

The current consent flow requires the therapist to hand the clinic tablet to the parent. This has three problems:

1. **HIPAA exposure** — the parent holds the therapist's device, which may display other patient data or session context.
2. **No identity verification** — anybody physically present can sign; there is no proof the signer is the legal guardian.
3. **No remote option** — parents who aren't physically in the clinic can't consent, blocking onboarding.

The new flow sends the consent form to the guardian's email. The guardian opens a link, reads the consent document, verifies their identity by re-entering the information the therapist provided, and signs electronically. This satisfies HIPAA's written authorization requirement for use of a minor's PHI, the ESIGN Act / UETA requirements for electronic signatures, and provides an auditable record of who consented, when, and what they agreed to.

## 2. Scope of Consent

Consent is **per-patient, platform-wide**. It covers:
- All game-based activities in the clinic
- Home program activities
- Use of the eMazeBrain platform for this patient

It is **not** per-protocol or per-assignment. One consent unlocks all current and future protocol assignments for that patient.

### Consent lifecycle

| Event | Effect |
|-------|--------|
| All required guardians approve | Patient status → `active`; Play button unlocked |
| Patient deactivated by clinic | Consent is effectively voided |
| Patient reactivated later | New consent request required |
| Guardian wants to revoke | Asks clinic offline → clinic deactivates patient |

## 3. Flow — Therapist Side

1. Therapist opens the patient detail page.
2. If the patient's status is `pending_consent`, the **Play** button is blocked and a **Request Consent** button is shown.
3. Therapist clicks **Request Consent**.
4. A form appears where the therapist enters:
   - **Guardian 1**: full name, email address, relationship, phone (optional)
   - Optionally: **Guardian 2** (second approval required): same fields
5. The therapist submits. The system:
   - Creates or updates the `guardian` and `guardian_patient` records
   - Creates a `consent_request` record with a secure token (UUIDv7)
   - Sends an email (via Resend HTTP API) to each guardian with a unique, non-guessable link
6. The patient detail shows consent status: "Pending — email sent to [guardian name] on [date]"
7. The therapist can **resend** the email or **cancel and re-request** (e.g. if the email was wrong).

### Two-guardian flow

When the therapist adds two guardians, **both** must complete the consent form before the patient is activated. The UI shows the status of each guardian independently:
- ✉️ Sent — awaiting response
- ✅ Approved
- ❌ Expired / Failed

## 4. Flow — Guardian Side (Public Page)

The guardian clicks the link in the email and lands on a **public, unauthenticated page** (no login required). The page:

1. Shows the eMazeBrain logo and clinic name.
2. Shows the consent document in the guardian's preferred language (auto-detected from the therapist's input, switchable: Hebrew, English, Arabic, Russian).
3. Describes what the guardian is consenting to:
   - Use of game-based activities for cognitive evaluation purposes
   - Collection and secure storage of session data
   - Home program activities (if applicable)
4. Asks the guardian to **verify their identity** by entering:
   - Full name (must match what the therapist entered)
   - Email address (must match)
   - Phone number (if provided by therapist, must match)
5. Shows a checkbox: **"I have read and understand the above, and I give consent for [child name] to use the eMazeBrain platform at [clinic name]"**
6. **"I Give Consent"** button.

### Identity verification

The guardian must enter the same name and email that the therapist provided. This is not a login — it's a verification that the person opening the link is the intended recipient. The comparison is case-insensitive and whitespace-normalized. Phone match is required only if the therapist provided one.

### After signing

- The page shows a confirmation screen: "Thank you, [name]. Your consent has been recorded."
- The `consent` record is created (append-only, as today) with `method = 'remote_email_esign'`.
- If this was the last required guardian, the patient status transitions to `active`.
- The therapist sees the updated status in real-time (or on next page load).

### No PHI on the public page

The consent page shows **only**:
- The child's **first name** (not family name, not date of birth, not diagnosis)
- The clinic name
- The nature of the activity (game-based cognitive activities)

No clinical data, no session history, no diagnosis information.

## 5. Email Content

The email contains:
- Clinic name and eMazeBrain branding
- Generic text: "You have been asked to provide consent for your child's participation in activities at [clinic name]."
- A button/link to the consent page
- **No patient name, no diagnosis, no clinical details** (HIPAA safe harbor)
- Footer with clinic contact info

**Sent via:** Resend HTTP API (Railway blocks SMTP; Resend is already the planned email provider).

## 6. Database Changes

### New table: `app.consent_request`

```sql
CREATE TABLE app.consent_request (
  id               uuid PRIMARY KEY DEFAULT app.uuidv7(),
  patient_id       uuid NOT NULL REFERENCES app.patient(id),
  guardian_id       uuid NOT NULL REFERENCES app.guardian(id),
  clinic_id        uuid NOT NULL REFERENCES app.clinic(id),
  token            uuid NOT NULL UNIQUE DEFAULT app.uuidv7(),
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'completed', 'cancelled')),
  guardian_email    text NOT NULL,
  guardian_name     text NOT NULL,
  guardian_phone    text,
  sent_at          timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  cancelled_at     timestamptz,
  created_by       uuid NOT NULL REFERENCES app.app_user(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
```

- RLS enabled + forced (as per CLAUDE.md invariant #2).
- The `token` is the URL parameter — not guessable, not sequential.
- `guardian_email` / `guardian_name` / `guardian_phone` are stored here as the values the guardian must match to verify identity. They're duplicated from the `guardian` table intentionally — this is the "expected answers" for verification.

### Changes to `app.consent`

Add a new method value: `'remote_email_esign'` to the `method` CHECK constraint.

Add optional reference to the consent_request:
```sql
ALTER TABLE app.consent ADD COLUMN consent_request_id uuid REFERENCES app.consent_request(id);
```

### Changes to `app.patient`

No schema changes. The existing `status` field and `consent_apply()` trigger handle the `pending_consent` → `active` transition.

However, we need to modify `consent_apply()` to check whether **all required guardians** have approved before activating the patient. Currently it activates on any single consent grant.

### New: tracking required guardian count

The `consent_request` table itself tracks this: if two requests exist for a patient, both must reach `completed` status. The `consent_apply()` trigger checks:

```sql
-- Only activate if no pending consent_requests remain for this patient
NOT EXISTS (
  SELECT 1 FROM app.consent_request cr
  WHERE cr.patient_id = NEW.patient_id
    AND cr.status = 'pending'
)
```

## 7. API Changes

### New endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/v1/patients/:id/consent-requests` | Therapist | Create request, send email(s) |
| GET | `/v1/patients/:id/consent-requests` | Therapist | List requests + status |
| POST | `/v1/patients/:id/consent-requests/:rid/resend` | Therapist | Resend email |
| DELETE | `/v1/patients/:id/consent-requests/:rid` | Therapist | Cancel request |
| GET | `/v1/consent/:token` | Public | Get consent form data |
| POST | `/v1/consent/:token` | Public | Submit consent |

### Public endpoints security

The `/v1/consent/:token` endpoints are unauthenticated but:
- Rate-limited (10 requests per minute per IP)
- The token is a UUIDv7 (122 bits of entropy) — not guessable
- The POST requires matching guardian name + email (+ phone if set)
- Tokens are single-use: once completed, the token cannot be reused
- Cancelled tokens return 410 Gone

## 8. Frontend Changes

### Therapist-side changes

1. **Patient detail page** — new "Consent Status" section showing:
   - Current consent status per guardian
   - "Request Consent" button (when `pending_consent`)
   - "Resend" / "Cancel" actions per request
2. **Request Consent dialog** — form for guardian details (1 or 2 guardians)

### New public page: `/consent/:token`

- Standalone page, no app chrome, no authentication
- Multi-language support (he, en, ar, ru)
- RTL support
- Mobile-friendly (parents will open this on their phone)
- Shows consent document, identity verification fields, and sign button

## 9. HIPAA Compliance Checklist

- [x] Electronic signature meets ESIGN Act / UETA (intent to sign + consent to electronic + association with record + record retention)
- [x] Consent record is append-only and tamper-evident (existing `consent_seal` trigger computes SHA-256 hash)
- [x] Audit trail: `audit_row_change` trigger records all consent events
- [x] No PHI in email (safe harbor: no names, no diagnosis, no dates)
- [x] No PHI on public consent page beyond child's first name and clinic
- [x] Identity verification before signing (name + email match)
- [x] Secure token (UUIDv7, 122-bit entropy)
- [x] Rate limiting on public endpoints
- [x] Consent document versioned (`policy_version` field, existing)
- [x] Record of which document version was shown and in which language (existing `locale` field)

## 10. What We're Removing

The existing in-clinic tablet handoff flow (`ConsentPage` component at `/patients/:id/consent`) will be **removed**. Email is the only consent method going forward — no fallback to in-clinic signing.

The existing `consent.tsx` component, the "Hand over tablet" UI, and the `method = 'in_clinic_esign'` flow are deprecated. Historical consent records with `in_clinic_esign` remain valid in the database.

## 11. Implementation Plan (High-Level)

1. **Migration** — `consent_request` table, method constraint update, `consent_apply` trigger update
2. **API** — consent request CRUD + public token endpoints + Resend integration
3. **UI — Therapist** — Request Consent dialog, consent status display
4. **UI — Public** — consent form page at `/consent/:token`
5. **Remove** — old in-clinic consent flow
6. **Tests** — RLS tests, API tests, E2E flow test

## 12. Open Questions

1. **Consent document content** — the exact legal text needs legal review. The current draft text in `en.json` / `he.json` under `consentDoc.*` keys will need updating.
2. **Email provider setup** — Resend API key and domain verification need to be configured in production.
3. **Notifications** — should the therapist get a push/email notification when a guardian completes consent? (Nice-to-have for phase 2.)

## 13. Non-Goals (Phase 2+)

- Parent portal / parent login
- Consent expiration based on time
- Parent-initiated consent revocation
- SMS as alternative to email
- Digital ID verification (government ID scan)
