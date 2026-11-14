/**
 * The sign-in tables can live in a schema other than `auth`: some managed
 * Postgres hosts (Supabase) reserve that name for their own use.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authPool } from "../src/auth.ts";
import { ADMIN_URL, setupApi, staffClient, type TestEnv } from "./support.ts";

describe.skipIf(!ADMIN_URL)("sign-in tables in a custom schema", () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await setupApi({ authSchema: "emb_auth" });
  });
  afterAll(async () => {
    await env.close();
  });

  it("signs a staff member up and enrols two-step sign-in", async () => {
    const { api, userId } = await staffClient(env, "noa@synthetic.test", "Noa Synthetic");
    expect((await api("/v1/me")).status).toBe(200);
    const { rows } = await env.db.query(`SELECT id FROM emb_auth."user"`);
    expect(rows.map((r) => r.id)).toEqual([userId]);
  });
});

describe("authPool", () => {
  it("rejects a schema name that is not a plain identifier", () => {
    expect(() => authPool("postgres://localhost/x", 'auth"; DROP SCHEMA app; --')).toThrow(/schema/i);
  });
});
