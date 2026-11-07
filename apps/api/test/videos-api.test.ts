/** The video library through the API (ADR 0018): regions, adding and finding videos, uploads and byte ranges. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_URL, addMember, platformAdmin, seedClinics, setupApi, staffClient, type Api, type TestEnv } from "./support.ts";

describe.skipIf(!ADMIN_URL)("videos API", () => {
  let env: TestEnv;
  let admin: Api;
  let yael: Api;
  let region: (path: string) => string;
  let youtubeVideo = "";

  beforeAll(async () => {
    env = await setupApi();
    const clinics = await seedClinics(env.db);
    admin = (await platformAdmin(env)).api;
    const y = await staffClient(env, "yael@synthetic.test", "Yael Bar");
    yael = y.api;
    await addMember(env.db, y.userId, clinics.org, clinics.clinic, "therapist");
    const { rows } = await env.db.query<{ id: string; path: string }>(`SELECT id, path FROM app.brain_region`);
    const byPath = new Map(rows.map((r) => [r.path, r.id]));
    region = (p) => byPath.get(p)!;
  });
  afterAll(async () => env?.close());

  const video = (extra: Record<string, unknown> = {}) => ({
    source: "youtube",
    youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    titles: { en: "Calm breathing", he: "נשימה רגועה" },
    region_ids: [region("left.frontal.ba44")],
    age_min: 5,
    age_max: 12,
    status: "published",
    ...extra,
  });

  it("brain regions come back as a tree with Hebrew labels", async () => {
    const res = await yael("/v1/brain-regions?lang=he");
    expect(res.status).toBe(200);
    const ba44 = res.body.regions.find((r: { path: string }) => r.path === "left.frontal.ba44");
    expect(ba44).toMatchObject({ kind: "area", code: "ba44", parent_id: region("left.frontal") });
    expect(ba44.label).toContain("ברודמן");
  });

  it("a platform admin adds a YouTube video and a therapist finds it by Brodmann area", async () => {
    const created = await admin("/v1/admin/videos", { method: "POST", body: video() });
    expect(created.status).toBe(201);
    youtubeVideo = created.body.video.id;
    expect(created.body.video).toMatchObject({ youtube_id: "dQw4w9WgXcQ", needs_internet: true, version: 1, title: "Calm breathing" });

    const ids = async (q: string) => ((await yael(`/v1/videos?${q}`)).body.videos as Array<{ id: string }>).map((v) => v.id);
    expect(await ids(`region=${region("left.frontal")}`)).toContain(youtubeVideo); // a lobe includes its areas
    expect(await ids(`region=${region("left")}`)).toContain(youtubeVideo);
    expect(await ids(`region=${region("right.frontal.ba44")}`)).not.toContain(youtubeVideo);
    expect(await ids(`region=${region("left.occipital.ba17")}`)).not.toContain(youtubeVideo);
    expect(await ids(`q=breath`)).toContain(youtubeVideo);
    expect(await ids(`q=juggling`)).not.toContain(youtubeVideo);
    const he = await yael(`/v1/videos?lang=he`);
    expect(he.body.videos.find((v: { id: string }) => v.id === youtubeVideo).title).toBe("נשימה רגועה");
  });

  it("a therapist cannot add, edit or upload videos", async () => {
    expect((await yael("/v1/admin/videos", { method: "POST", body: video() })).status).toBe(403);
    expect((await yael(`/v1/admin/videos/${youtubeVideo}`, { method: "PUT", body: video({ titles: { en: "Mine" } }) })).status).toBe(403);
    const up = await yael.raw(`/v1/admin/videos/${youtubeVideo}/file`, { method: "PUT", headers: { "content-type": "video/mp4" }, body: new Uint8Array(16) });
    expect(up.status).toBe(403);
    const still = await yael(`/v1/videos/${youtubeVideo}`);
    expect(still.body.video.title).toBe("Calm breathing");
  });

  it("uploads a file, then serves it whole and by range", async () => {
    const created = await admin("/v1/admin/videos", { method: "POST", body: video({ source: "upload", youtube_url: undefined, titles: { en: "Shapes" }, status: "draft" }) });
    const id = created.body.video.id;
    expect(created.body.video).toMatchObject({ has_file: false, needs_internet: false });
    const bytes = new Uint8Array(1024).map((_, i) => i % 251);
    const up = await admin.raw(`/v1/admin/videos/${id}/file`, { method: "PUT", headers: { "content-type": "video/mp4", "content-length": "1024" }, body: bytes });
    expect(up.status).toBe(200);
    const after = (await up.json()).video;
    expect(after).toMatchObject({ has_file: true, version: 2 });
    await admin(`/v1/admin/videos/${id}`, { method: "PUT", body: video({ source: "upload", youtube_url: undefined, titles: { en: "Shapes" }, status: "published" }) });

    const whole = await yael.raw(`/v1/videos/${id}/file?v=2`);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    expect(whole.headers.get("content-type")).toBe("video/mp4");
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(bytes);

    const part = await yael.raw(`/v1/videos/${id}/file?v=2`, { headers: { range: "bytes=10-19" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 10-19/1024");
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(bytes.slice(10, 20));

    const open = await yael.raw(`/v1/videos/${id}/file?v=2`, { headers: { range: "bytes=1000-" } });
    expect(open.status).toBe(206);
    expect((await open.arrayBuffer()).byteLength).toBe(24);

    const bad = await yael.raw(`/v1/videos/${id}/file?v=2`, { headers: { range: "bytes=5000-6000" } });
    expect(bad.status).toBe(416);
  });

  it("rejects a file that is not a video, or too large", async () => {
    const created = await admin("/v1/admin/videos", { method: "POST", body: video({ source: "upload", youtube_url: undefined, titles: { en: "Too big" }, status: "draft" }) });
    const id = created.body.video.id;
    const text = await admin.raw(`/v1/admin/videos/${id}/file`, { method: "PUT", headers: { "content-type": "text/plain" }, body: "hello" });
    expect(text.status).toBe(415);
    const big = await admin.raw(`/v1/admin/videos/${id}/file`, { method: "PUT", headers: { "content-type": "video/mp4", "content-length": "1073741825" }, body: new Uint8Array(8) });
    expect(big.status).toBe(413);
    const yt = await admin.raw(`/v1/admin/videos/${youtubeVideo}/file`, { method: "PUT", headers: { "content-type": "video/mp4" }, body: new Uint8Array(8) });
    expect(yt.status).toBe(409); // a YouTube video has no file
  });

  it("falls back to the other language for a missing title", async () => {
    const created = await admin("/v1/admin/videos", { method: "POST", body: video({ titles: { he: "רק בעברית" }, youtube_url: "https://youtu.be/aaaaaaaaaaa" }) });
    const list = await yael(`/v1/videos?lang=en`);
    expect(list.body.videos.find((v: { id: string }) => v.id === created.body.video.id).title).toBe("רק בעברית");
  });

  it("drafts are hidden from therapists; admins list them with all=1", async () => {
    const created = await admin("/v1/admin/videos", { method: "POST", body: video({ status: "draft", titles: { en: "Draft" }, youtube_url: "https://youtu.be/bbbbbbbbbbb" }) });
    const id = created.body.video.id;
    expect(((await yael(`/v1/videos`)).body.videos as Array<{ id: string }>).some((v) => v.id === id)).toBe(false);
    expect((await yael(`/v1/videos/${id}`)).status).toBe(404);
    expect(((await admin(`/v1/videos?all=1`)).body.videos as Array<{ id: string }>).some((v) => v.id === id)).toBe(true);
  });

  it("editing titles and regions keeps the version; changing the YouTube link bumps it", async () => {
    const same = await admin(`/v1/admin/videos/${youtubeVideo}`, { method: "PUT", body: video({ titles: { en: "Calm breathing 2" }, region_ids: [region("right.temporal.ba22")] }) });
    expect(same.status).toBe(200);
    expect(same.body.video).toMatchObject({ version: 1, title: "Calm breathing 2" });
    expect(same.body.video.regions.map((r: { path: string }) => r.path)).toEqual(["right.temporal.ba22"]);
    const moved = await admin(`/v1/admin/videos/${youtubeVideo}`, { method: "PUT", body: video({ youtube_url: "https://youtu.be/ccccccccccc" }) });
    expect(moved.body.video).toMatchObject({ version: 2, youtube_id: "ccccccccccc" });
  });

  it("tells the app whether the user is a platform admin", async () => {
    expect((await admin("/v1/me")).body.is_platform_admin).toBe(true);
    expect((await yael("/v1/me")).body.is_platform_admin).toBe(false);
  });

  const upload = async (id: string, bytes: Uint8Array<ArrayBuffer>) =>
    (await admin.raw(`/v1/admin/videos/${id}/file`, { method: "PUT", headers: { "content-type": "video/mp4" }, body: bytes })).json();

  it("serves the file for the version asked, and 404 for a version that never existed", async () => {
    const id = (await admin("/v1/admin/videos", { method: "POST", body: video({ source: "upload", youtube_url: undefined, titles: { en: "Versions" }, status: "draft" }) })).body.video.id;
    const a = new Uint8Array(32).fill(1);
    const b = new Uint8Array(48).fill(2);
    expect((await upload(id, a)).video.version).toBe(2);
    expect((await upload(id, b)).video.version).toBe(3);
    const v2 = await admin.raw(`/v1/videos/${id}/file?v=2`);
    expect(new Uint8Array(await v2.arrayBuffer())).toEqual(a); // the old version stays reachable mid-session
    expect(v2.headers.get("cache-control")).toContain("immutable");
    const v2part = await admin.raw(`/v1/videos/${id}/file?v=2`, { headers: { range: "bytes=0-3" } });
    expect(v2part.headers.get("content-range")).toBe("bytes 0-3/32");
    expect(new Uint8Array(await (await admin.raw(`/v1/videos/${id}/file?v=3`)).arrayBuffer())).toEqual(b);
    expect((await admin.raw(`/v1/videos/${id}/file?v=9`)).status).toBe(404);
    const current = await admin.raw(`/v1/videos/${id}/file`);
    expect(new Uint8Array(await current.arrayBuffer())).toEqual(b);
    expect(current.headers.get("cache-control")).not.toContain("immutable");
  });

  it("an upload video can't be published before its file is in", async () => {
    const early = await admin("/v1/admin/videos", { method: "POST", body: video({ source: "upload", youtube_url: undefined, titles: { en: "No file yet" }, status: "published" }) });
    expect(early.status).toBe(400);
    expect(early.body.issues).toEqual([{ path: "status", code: "needs_file" }]);
    const id = (await admin("/v1/admin/videos", { method: "POST", body: video({ source: "upload", youtube_url: undefined, titles: { en: "No file yet" }, status: "draft" }) })).body.video.id;
    const put = await admin(`/v1/admin/videos/${id}`, { method: "PUT", body: video({ source: "upload", youtube_url: undefined, titles: { en: "No file yet" }, status: "published" }) });
    expect(put.status).toBe(400);
    await upload(id, new Uint8Array(16).fill(3));
    const ok = await admin(`/v1/admin/videos/${id}`, { method: "PUT", body: video({ source: "upload", youtube_url: undefined, titles: { en: "No file yet" }, status: "published" }) });
    expect(ok.status).toBe(200);
    expect(ok.body.video).toMatchObject({ status: "published", has_file: true });
  });

  it("finds an area or lobe in both hemispheres by its code", async () => {
    const id = (await admin("/v1/admin/videos", { method: "POST", body: video({ youtube_url: "https://youtu.be/ddddddddddd", titles: { en: "Both sides" }, region_ids: [region("left.occipital.ba17"), region("right.temporal.ba22")] }) })).body.video.id;
    const ids = async (q: string) => ((await yael(`/v1/videos?${q}`)).body.videos as Array<{ id: string }>).map((v) => v.id);
    expect(await ids("code=ba17")).toContain(id);
    expect(await ids("code=ba22")).toContain(id);
    expect(await ids("code=temporal")).toContain(id); // a lobe code includes its areas
    expect(await ids("code=ba44")).not.toContain(id);
    expect((await yael("/v1/videos?code=DROP%20TABLE")).status).toBe(400);
  });
});
