# ADR 0023 — System administration and the account status gate

- Status: Accepted
- Date: 2026-11-16
- Spec: `docs/superpowers/specs/2026-11-16-system-admin-design.md`

## Context

Platform admins create organizations, clinics and staff accounts. A new account gets a temporary password by email
and must replace it at first sign-in. The spec enforced that in the browser only, and gave "disable user" no effect.

## Decisions

**Accounts are made through Better Auth's internal adapter, not the sign-up endpoint.** Sign-up would sign the new
user in over the admin's session. Everything that can be refused (unknown organization, clinic in another
organization, taken email) is checked before the identity exists; if the membership still fails, the identity is
removed again. Emails are stored in lower case, because sign-in looks them up that way.

**The API gates every `/v1` request on `app_user.status`** (`requireActiveUser`). `disabled` answers 403
`account_disabled` everywhere, and disabling ends the account's sessions. `invited` answers 403
`password_change_required` everywhere except `/v1/me` and `/v1/me/status`. The cost is one primary-key read per request.

**An admin can disable and re-enable an account, never hand-activate an invited one.** `invited → active` happens
only through `PATCH /v1/me/status`, which the web app calls after Better Auth's change-password succeeds.

**Order at first sign-in: two-step sign-in, then the password change.** `/v1/me` is what reports the status, and it
is only reachable with two-step sign-in set up.

## Known limits

- `PATCH /v1/me/status` cannot prove the password was changed; a person calling the API by hand could activate their
  own account and keep the emailed password. Closing this needs one server endpoint that changes the password and
  activates in one step.
- Suspending or closing an organization and deactivating a clinic change the status label only. What they should
  block is not specified yet.
- Sign-up (`/api/auth/sign-up/email`) is still open; an account made that way has no membership and sees nothing.
