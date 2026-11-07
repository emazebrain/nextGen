/** Devices and spaces (offline devices spec §7.3, §7.5, §8; ADR 0019). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ADMIN_URL, addMember, seedClinics, setupApi, staffClient, type Api, type TestEnv } from "./support.ts";

describe.skipIf(!ADMIN_URL)("devices API", () => {
  let env: TestEnv;
  let tal: { api: Api; userId: string };
  let dana: { api: Api; userId: string };
  let maya: { api: Api; userId: string };
  let outsider: { api: Api; userId: string };
  let clinic: string;
  const device = randomUUID();

  beforeAll(async () => {
    env = await setupApi();
    const c = await seedClinics(env.db);
    clinic = c.clinic;
    tal = await staffClient(env, "tal@synthetic.test", "Tal");
    dana = await staffClient(env, "dana@synthetic.test", "Dana");
    maya = await staffClient(env, "maya@synthetic.test", "Maya");
    outsider = await staffClient(env, "out@synthetic.test", "Out");
    await addMember(env.db, tal.userId, c.org, c.clinic, "therapist");
    await addMember(env.db, dana.userId, c.org, c.clinic, "therapist");
    await addMember(env.db, maya.userId, c.org, c.clinic, "clinic_manager");
    await addMember(env.db, outsider.userId, c.org, c.other, "therapist");
  });
  afterAll(async () => env?.close());

  it("registers a device once and hands its outbox secret to anyone with a space there", async () => {
    const reg = await tal.api("/v1/devices/register", { method: "POST", body: { device_id: device, outbox_public_key: "pk-1" } });
    expect(reg.status).toBe(201);
    const again = await tal.api("/v1/devices/register", { method: "POST", body: { device_id: device, outbox_public_key: "pk-1" } });
    expect(again.status).toBe(201);
    expect((await tal.api(`/v1/devices/${device}/spaces`, { method: "POST", body: { clinic_id: clinic } })).status).toBe(201);
    expect((await dana.api(`/v1/devices/${device}/spaces`, { method: "POST", body: { clinic_id: clinic } })).status).toBe(201);
    const a = await tal.api(`/v1/devices/${device}/secrets`);
    const b = await dana.api(`/v1/devices/${device}/secrets`);
    expect(a.body.outbox_secret).toMatch(/^[A-Za-z0-9+/=]{40,}$/);
    expect(b.body.outbox_secret).toBe(a.body.outbox_secret);
    // A colleague of the same organisation without a space: the outbox secret (to send what waits), no space secret.
    const colleague = await outsider.api(`/v1/devices/${device}/secrets`);
    expect(colleague.body.outbox_secret).toBe(a.body.outbox_secret);
    expect(colleague.body.spaces).toEqual([]);
  });

  it("someone from another organisation gets nothing from the device and can't make a space on it", async () => {
    const org2 = randomUUID();
    const clinic2 = randomUUID();
    await env.db.query(`INSERT INTO app.organization (id, name, region) VALUES ($1,'Other org','il')`, [org2]);
    await env.db.query(`INSERT INTO app.clinic (id, organization_id, name, country_code, timezone) VALUES ($1,$2,'Eilat','IL','Asia/Jerusalem')`, [clinic2, org2]);
    const foreign = await staffClient(env, "foreign@synthetic.test", "Foreign");
    await addMember(env.db, foreign.userId, org2, clinic2, "therapist");
    expect((await foreign.api(`/v1/devices/${device}/secrets`)).body).toEqual({ outbox_secret: null, spaces: [] });
    expect((await foreign.api(`/v1/devices/${device}/spaces`, { method: "POST", body: { clinic_id: clinic2 } })).status).toBe(403);
  });

  it("a space secret goes only to its owner", async () => {
    const a = await tal.api(`/v1/devices/${device}/secrets`);
    const b = await dana.api(`/v1/devices/${device}/secrets`);
    expect(a.body.spaces).toHaveLength(1);
    expect(b.body.spaces).toHaveLength(1);
    expect(a.body.spaces[0].space_secret).not.toBe(b.body.spaces[0].space_secret);
    // Asking again returns the same secret (it only changes when a space is re-created).
    expect((await tal.api(`/v1/devices/${device}/secrets`)).body.spaces[0].space_secret).toBe(a.body.spaces[0].space_secret);
  });

  it("a space in a clinic you don't belong to can't be created", async () => {
    const r = await outsider.api(`/v1/devices/${device}/spaces`, { method: "POST", body: { clinic_id: clinic } });
    expect(r.status).toBe(403);
  });

  it("a manager ends a therapist's space; a therapist can't end another's", async () => {
    const list = await maya.api(`/v1/devices/${device}/spaces`);
    expect(list.body.map((s: { full_name: string }) => s.full_name).sort()).toEqual(["Dana", "Tal"]);
    const danaSpace = list.body.find((s: { full_name: string }) => s.full_name === "Dana").id;
    expect((await tal.api(`/v1/devices/${device}/spaces/${danaSpace}`, { method: "DELETE" })).status).toBe(404);
    expect((await maya.api(`/v1/devices/${device}/spaces/${danaSpace}`, { method: "DELETE" })).status).toBe(204);
    // Her space is gone (no space secret); as staff of the device's organisation she can still send what waits there.
    const after = (await dana.api(`/v1/devices/${device}/secrets`)).body;
    expect(after.spaces).toEqual([]);
    expect(after.outbox_secret).toEqual(expect.any(String));
  });

  it("secrets for an unknown device are 404", async () => {
    expect((await tal.api(`/v1/devices/${randomUUID()}/secrets`)).status).toBe(404);
  });

  it("secrets are stored encrypted", async () => {
    const { rows } = await env.db.query(`SELECT space_secret_enc FROM app.device_space WHERE user_id = $1 AND ended_at IS NULL`, [tal.userId]);
    const returned = (await tal.api(`/v1/devices/${device}/secrets`)).body.spaces[0].space_secret as string;
    const raw = Buffer.from(rows[0].space_secret_enc);
    expect(raw.toString("base64")).not.toBe(returned);
    expect(env.deviceKey.open(raw).toString("base64")).toBe(returned);
  });
});
