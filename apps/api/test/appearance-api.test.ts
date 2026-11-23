/** The app background (platform appearance): anyone reads it, only platform admins change it. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_URL, BASE, addMember, platformAdmin, seedClinics, setupApi, staffClient, type Api, type TestEnv } from "./support.ts";

/** The smallest bodies that carry each format's signature. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("synthetic-png-body")]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("synthetic-jpeg-body")]);

describe.skipIf(!ADMIN_URL)("appearance API", () => {
  let env: TestEnv;
  let admin: Api;
  let yael: Api;

  beforeAll(async () => {
    env = await setupApi();
    const clinics = await seedClinics(env.db);
    admin = (await platformAdmin(env)).api;
    const y = await staffClient(env, "yael@synthetic.test", "Yael Bar");
    yael = y.api;
    await addMember(env.db, y.userId, clinics.org, clinics.clinic, "therapist");
  });
  afterAll(async () => env?.close());

  /** No cookies at all: the sign-in page asks this way. */
  const anon = (path: string) => env.app.request(`${BASE}${path}`);
  const upload = (api: Api, body: Buffer, type: string) => api.raw("/v1/admin/appearance/image", { method: "PUT", body: new Uint8Array(body), headers: { "content-type": type } });

  it("starts as the default background, readable without signing in", async () => {
    const res = await anon("/api/appearance");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kind: "default", color: null, blur: "light", version: 1, image_url: null });
  });

  it("a platform admin sets a solid colour and everyone gets it", async () => {
    const saved = await admin("/v1/admin/appearance", { method: "PUT", body: { kind: "color", color: "#E9D5C0" } });
    expect(saved.status).toBe(200);
    expect(saved.body.appearance).toMatchObject({ kind: "color", color: "#e9d5c0", version: 2 });
    expect(await (await anon("/api/appearance")).json()).toMatchObject({ kind: "color", color: "#e9d5c0", image_url: null });
  });

  it("refuses a colour that is not a six-digit hex code", async () => {
    for (const color of ["red", "#fff", "#12345g", "url(x)", ""]) {
      const res = await admin("/v1/admin/appearance", { method: "PUT", body: { kind: "color", color } });
      expect(res.status, color).toBe(400);
    }
    expect((await admin("/v1/admin/appearance", { method: "PUT", body: { kind: "color" } })).status).toBe(400);
  });

  it("a therapist cannot change the background or upload an image", async () => {
    expect((await yael("/v1/admin/appearance", { method: "PUT", body: { kind: "default" } })).status).toBe(403);
    expect((await upload(yael, PNG, "image/png")).status).toBe(403);
    expect(await (await anon("/api/appearance")).json()).toMatchObject({ kind: "color" });
  });

  it("choosing the image before one was uploaded is refused", async () => {
    const res = await admin("/v1/admin/appearance", { method: "PUT", body: { kind: "image" } });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("no_image");
  });

  it("an uploaded image becomes the background and is served to anyone, cacheable by version", async () => {
    const res = await upload(admin, PNG, "image/png");
    expect(res.status).toBe(200);
    const { appearance } = (await res.json()) as { appearance: { kind: string; version: number; image_url: string } };
    expect(appearance.kind).toBe("image");
    expect(appearance.image_url).toBe(`/api/appearance/image?v=${appearance.version}`);

    const img = await anon(appearance.image_url);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");
    expect(img.headers.get("cache-control")).toContain("immutable");
    expect(Buffer.from(await img.arrayBuffer()).equals(PNG)).toBe(true);
    // Without the version, the current image comes back but may not be kept.
    expect((await anon("/api/appearance/image")).headers.get("cache-control")).toBe("no-cache");
  });

  it("a new upload replaces the image under a new version", async () => {
    const before = (await (await anon("/api/appearance")).json()) as { version: number };
    const res = await upload(admin, JPEG, "image/jpeg");
    const { appearance } = (await res.json()) as { appearance: { version: number; image_url: string } };
    expect(appearance.version).toBe(before.version + 1);
    const img = await anon(appearance.image_url);
    expect(img.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await img.arrayBuffer()).equals(JPEG)).toBe(true);
  });

  it("refuses files that are not JPEG, PNG or WebP, whatever they claim to be", async () => {
    expect((await upload(admin, Buffer.from("<svg onload=alert(1)>"), "image/svg+xml")).status).toBe(415);
    expect((await upload(admin, Buffer.from("<html>not an image</html>"), "image/png")).status).toBe(415);
    expect((await upload(admin, Buffer.alloc(0), "image/png")).status).toBe(400);
  });

  it("refuses an image over the size limit", async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]);
    expect((await upload(admin, big, "image/png")).status).toBe(413);
  });

  it("the blur level is saved, and switching away keeps the image for later", async () => {
    const blurred = await admin("/v1/admin/appearance", { method: "PUT", body: { kind: "image", blur: "strong" } });
    expect(blurred.body.appearance).toMatchObject({ kind: "image", blur: "strong" });
    expect((await admin("/v1/admin/appearance", { method: "PUT", body: { kind: "image", blur: "heavy" } })).status).toBe(400);

    const off = await admin("/v1/admin/appearance", { method: "PUT", body: { kind: "default" } });
    expect(off.body.appearance).toMatchObject({ kind: "default", image_url: null, has_image: true });
    expect((await anon("/api/appearance/image")).status).toBe(404);
    const back = await admin("/v1/admin/appearance", { method: "PUT", body: { kind: "image" } });
    expect(back.status).toBe(200);
    expect(back.body.appearance.image_url).toMatch(/^\/api\/appearance\/image\?v=\d+$/);
  });

  it("the admin screen reads the saved colour and whether an image is on file", async () => {
    const res = await admin("/v1/admin/appearance");
    expect(res.status).toBe(200);
    expect(res.body.appearance).toMatchObject({ kind: "image", color: "#e9d5c0", has_image: true });
    expect((await yael("/v1/admin/appearance")).status).toBe(403);
  });
});
