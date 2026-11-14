# ADR 0022 — First hosted deployment: Vercel, Railway and Supabase

- Status: Proposed (needs the product owner's sign-off; see "Open questions")
- Date: 2026-11-14
- Design doc: §9.3 (auth), §9.9 (regions), §11.2 (security)

## Context

The first hosted environment runs the web app on Vercel, the API on Railway and Postgres on Supabase, each deploying
from `main` through the host's own GitHub integration. Supabase is not a plain Postgres: it reserves schema `auth`,
its login role `postgres` is not a superuser, and it keeps `pgcrypto` in schema `extensions`.

## Decisions

**The sign-in schema has a configurable name.** `AUTH_SCHEMA` (default `auth`) names the schema that holds the Better
Auth tables and `claim_totp`. On Supabase it is `emb_auth`. The name is checked against a plain-identifier pattern
because it goes into SQL text. The auth pool sets its search path with a statement on connect, not a startup option,
so it also works behind a connection pooler.

**Roles stay exactly as designed.** The API still runs every request as `emb_app`, and the RLS helper functions are
still owned by `emb_rls_helper`. `packages/db/supabase/0001_roles_and_auth.sql` creates both on Supabase and replays
the grants and ownership changes of migrations 0001-0018. A database prepared this way was compared, privilege by
privilege and owner by owner, with one migrated the normal way: no difference in schema `app`.

**The web app reaches the API through same-origin rewrites.** `apps/web/vercel.json` forwards `/api/*` and `/v1/*` to
the API, as the Vite proxy does in development, so the session cookie stays first-party. Everything else falls back
to `index.html`.

**The API is built from the repository root.** Railway installs with pnpm only when it sees the workspace files; the
build step is `pnpm --filter @emb/session-rules build` and the start command is
`node --experimental-strip-types apps/api/src/server.ts`.

## Open questions

- The Supabase database was set up from a hand-adapted copy of the migrations, not by `migrate.ts`. Future migrations
  need a route to Supabase that does not depend on hand edits.
- Uploaded videos go to the API's local disk (`FILE_STORE_DIR`), which Railway discards on every deploy.
- There is no way yet to create the first platform administrator outside the development seed.
- §9.3 keeps identities "in the region's own Postgres" so that no auth vendor needs a BAA. Whether these three hosts
  are acceptable for anything beyond synthetic data is a compliance decision, not made here. Until it is, this
  environment holds synthetic data only (invariant 1).
