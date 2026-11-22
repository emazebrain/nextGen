/**
 * Authentication (design doc §9.3, §9.9, §11.2): Better Auth, self-hosted, so
 * identities stay in the region's own Postgres and no auth vendor needs a BAA.
 *
 * - Email + password (min 12 chars) for now; passkeys and Google/Microsoft
 *   OIDC come later through Better Auth plugins.
 * - TOTP two-factor. Staff cannot reach any /v1 route until it is enabled
 *   (requireStaffSession in context.ts).
 * - Auth tables live in their own schema (`auth` by default; AUTH_SCHEMA on
 *   hosts that reserve that name), which the app role cannot read.
 * - Every auth user gets a matching app.app_user row with the same UUIDv7 id,
 *   which is what RLS sees as app.user_id.
 */
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { twoFactor } from "better-auth/plugins";
import pg from "pg";
import { uuidv7 } from "./ids.ts";

export interface AuthConfig {
  databaseUrl: string;
  secret: string;
  baseURL: string;
  trustedOrigins?: string[];
  /** Defaults to on. Tests switch it off to run many sign-ins in a few seconds. */
  rateLimit?: boolean;
  /** Connection pool for the auth schema; created from databaseUrl when omitted. */
  pool?: pg.Pool;
  /** Schema that holds the sign-in tables. Defaults to `auth`. */
  schema?: string;
  /**
   * Headers that carry the client IP, set by the load balancer in front of the
   * API (never trust these when the API is reachable directly). Without one,
   * every client shares a single rate-limit bucket and one clinic could lock
   * out everyone.
   */
  ipAddressHeaders?: string[];
  /** Callback to send password-reset emails. Without one, the forgot-password endpoint is a no-op. */
  sendResetPassword?: (to: string, resetUrl: string) => Promise<boolean>;
}

export const DEFAULT_AUTH_SCHEMA = "auth";

/** The schema name goes into SQL text, so only a plain lower-case identifier is accepted. */
function authSchemaName(schema: string | undefined): string {
  const name = schema ?? DEFAULT_AUTH_SCHEMA;
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) throw new Error("auth schema must be a plain lower-case identifier");
  return name;
}

export function authPool(databaseUrl: string, schema?: string): pg.Pool {
  // Better Auth's own tables resolve to the auth schema. The search path is set
  // by a statement, not a startup option, because connection poolers in front
  // of managed Postgres do not all pass startup options through.
  const name = authSchemaName(schema);
  // Set search_path via connection options parameter. This runs at connect time
  // inside the protocol handshake, avoiding a separate SET query that races with
  // Better Auth's first query (pg@9 deprecation warning).
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 5,
    options: `-c search_path=${name}`,
  });
  return pool;
}

export function createAuth(config: AuthConfig, servicePool: pg.Pool) {
  const schema = authSchemaName(config.schema);
  return betterAuth({
    appName: "eMazeBrain",
    baseURL: config.baseURL,
    secret: config.secret,
    trustedOrigins: config.trustedOrigins ?? [config.baseURL],
    database: config.pool ?? authPool(config.databaseUrl, schema),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      ...(config.sendResetPassword
        ? {
            sendResetPassword: async ({ user, url }) => {
              await config.sendResetPassword!(user.email, url);
            },
          }
        : {}),
    },
    session: {
      expiresIn: 60 * 60 * 12, // 12 h ceiling; web idle lock (15 min) is enforced by the client
      updateAge: 60 * 15,
    },
    rateLimit: { enabled: config.rateLimit ?? true, window: 15 * 60, max: 100 },
    plugins: [twoFactor({ issuer: "eMazeBrain" })],
    hooks: {
      // TOTP replay protection: a code is accepted once per user per 120 s.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/two-factor/verify-totp") return;
        const code = typeof ctx.body?.code === "string" ? ctx.body.code.trim() : "";
        if (!/^\d{6}$/.test(code)) return; // malformed codes fail in Better Auth itself
        const userId = await userForTwoFactor(ctx);
        if (!userId) return; // no pending sign-in or session: Better Auth rejects it
        const { rows } = await servicePool.query<{ ok: boolean }>(`SELECT ${schema}.claim_totp($1, $2) AS ok`, [userId, code]);
        if (!rows[0]?.ok) throw APIError.from("UNAUTHORIZED", { message: "Invalid code", code: "INVALID_CODE" });
      }),
    },
    advanced: {
      database: { generateId: () => uuidv7() },
      cookiePrefix: "emb",
      ipAddress: {
        ipAddressHeaders: config.ipAddressHeaders ?? ["x-forwarded-for"],
        trustedProxies: ["*"],
      },
    },
    databaseHooks: {
      user: {
        create: {
          // Mirror every new identity into app.app_user (service connection; RLS doesn't apply).
          after: async (user) => {
            await servicePool.query(
              `INSERT INTO app.app_user (id, email, full_name, kind, status)
               VALUES ($1, $2, $3, 'staff', 'active') ON CONFLICT (id) DO NOTHING`,
              [user.id, user.email, user.name],
            );
          },
        },
      },
    },
  });
}

type HookCtx = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/** The user a code is being checked for: the signed-in user (enrolment), or the pending two-step sign-in. */
async function userForTwoFactor(ctx: HookCtx): Promise<string | null> {
  const session = await getSessionFromCtx(ctx).catch(() => null);
  if (session) return session.user.id;
  const cookie = ctx.context.createAuthCookie("two_factor");
  const token = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  if (!token) return null;
  const pending = await ctx.context.internalAdapter.findVerificationValue(token);
  return pending?.value ?? null;
}

export type Auth = ReturnType<typeof createAuth>;
