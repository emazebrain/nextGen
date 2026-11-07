// @vitest-environment node
/** Per-therapist spaces on a shared device (offline devices spec §7.3). */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { openDB } from "idb";
import { canUnlockOffline, createSpace, listSpaces, removeSpace, unlockWithPassword, unlockWithPrf, unlockWithSecret, type OpenSpace } from "../src/device/spaces.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-07T10:00:00Z");
const secret = (n: number) => new Uint8Array(32).fill(n);
const info = (id: string, name: string) => ({ id, user_id: `u-${id}`, display_name: name, clinic_id: "c1", clinic_name: "Tel Aviv", last_online_at: new Date(NOW).toISOString() });
const isOpen = (r: unknown): r is OpenSpace => typeof (r as OpenSpace).read === "function";

describe("device spaces", () => {
  beforeEach(async () => {
    for (const s of await listSpaces()) await removeSpace(s.id);
  });

  it("a space opens with its password, its server secret or its passkey, and not with a wrong password", async () => {
    await createSpace(info("a", "Tamar"), { password: "tablet42!", secret: secret(1), prf: { output: secret(7), credentialId: "cred" }, iterations: 1000 });
    const byPw = await unlockWithPassword("a", "tablet42!", NOW);
    expect(isOpen(byPw)).toBe(true);
    await (byPw as OpenSpace).write("caseload", [{ given_name: "Noa" }]);
    const bySecret = await unlockWithSecret("a", secret(1));
    expect(await bySecret.read("caseload")).toEqual([{ given_name: "Noa" }]);
    const byPrf = await unlockWithPrf("a", secret(7), NOW);
    expect(isOpen(byPrf) && (await byPrf.read("caseload"))).toEqual([{ given_name: "Noa" }]);
    const wrong = await unlockWithPassword("a", "nope-nope", NOW);
    expect(wrong).toEqual({ locked_ms: 0, tries_left: 4 });
  });

  it("another space's data key can't open this space", async () => {
    await createSpace(info("a", "Tamar"), { password: "tablet42!", secret: secret(1), iterations: 1000 });
    await createSpace(info("b", "Oren"), { password: "oren-pass1", secret: secret(2), iterations: 1000 });
    const b = (await unlockWithPassword("b", "oren-pass1", NOW)) as OpenSpace;
    await b.write("caseload", [{ given_name: "Yoav" }]);
    const a0 = (await unlockWithPassword("a", "tablet42!", NOW)) as OpenSpace;
    await a0.write("caseload", [{ given_name: "Noa" }]);
    // Copy B's encrypted record into A's database, as someone with the device's storage could.
    const bDb = await openDB("emb.space.b.v1");
    const raw = await bDb.get("records", "caseload");
    const aDb = await openDB("emb.space.a.v1");
    await aDb.put("records", raw, "caseload");
    bDb.close();
    aDb.close();
    const a = (await unlockWithPassword("a", "tablet42!", NOW)) as OpenSpace;
    await expect(a.read("caseload")).rejects.toThrow();
  });

  it("five wrong passwords lock for a minute, then two, then four", async () => {
    await createSpace(info("a", "Tamar"), { password: "tablet42!", secret: secret(1), iterations: 1000 });
    let t = NOW;
    const fail = () => unlockWithPassword("a", "wrong-pass", t);
    for (let i = 0; i < 4; i++) await fail();
    expect(await fail()).toEqual({ locked_ms: 60_000, tries_left: 0 });
    expect(await unlockWithPassword("a", "tablet42!", t + 30_000)).toEqual({ locked_ms: 30_000, tries_left: 0 }); // even the right one waits
    t += 60_000;
    for (let i = 0; i < 4; i++) await fail();
    expect(await fail()).toEqual({ locked_ms: 120_000, tries_left: 0 });
    t += 120_000;
    for (let i = 0; i < 4; i++) await fail();
    expect(await fail()).toEqual({ locked_ms: 240_000, tries_left: 0 });
    t += 240_000;
    expect(isOpen(await unlockWithPassword("a", "tablet42!", t))).toBe(true);
    expect((await listSpaces())[0]!.tries).toEqual({ count: 0, locked_until: 0 });
  });

  it("a space can't be unlocked offline 30 days after its last online sign-in", async () => {
    await createSpace(info("a", "Tamar"), { password: "tablet42!", secret: secret(1), iterations: 1000 });
    const [s] = await listSpaces();
    expect(canUnlockOffline(s!, NOW + 29 * DAY)).toBe(true);
    expect(canUnlockOffline(s!, NOW + 31 * DAY)).toBe(false);
    expect(await unlockWithPassword("a", "tablet42!", NOW + 31 * DAY)).toEqual({ expired: true });
    // The server secret (an online sign-in) still opens it.
    expect(isOpen(await unlockWithSecret("a", secret(1)))).toBe(true);
  });

  it("records are stored encrypted", async () => {
    await createSpace(info("a", "Tamar"), { password: "tablet42!", secret: secret(1), iterations: 1000 });
    const a = (await unlockWithPassword("a", "tablet42!", NOW)) as OpenSpace;
    await a.write("caseload", [{ given_name: "Noa", family_name: "Levi" }]);
    const db = await openDB("emb.space.a.v1");
    const raw = await db.get("records", "caseload");
    db.close();
    expect(JSON.stringify(raw)).not.toMatch(/Noa|Levi/);
  });

  it("removing a space deletes its records and its entry", async () => {
    await createSpace(info("a", "Tamar"), { password: "tablet42!", secret: secret(1), iterations: 1000 });
    await createSpace(info("b", "Oren"), { password: "oren-pass1", secret: secret(2), iterations: 1000 });
    await removeSpace("a");
    expect((await listSpaces()).map((s) => s.id)).toEqual(["b"]);
    const dbs = (await indexedDB.databases()).map((d) => d.name);
    expect(dbs).not.toContain("emb.space.a.v1");
  });
});
