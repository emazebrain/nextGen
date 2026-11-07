/** The local file store (ADR 0018): a failing disk must fail the upload, never crash the API. */
import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

const dir = mkdtempSync(join(tmpdir(), "emb-files-unit-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const body = (n: number) => new Blob([new Uint8Array(n).fill(9)]).stream();

describe("localFileStore", () => {
  it("stores a file and reports its size and hash", async () => {
    const { localFileStore } = await import("../src/files.ts");
    const store = localFileStore(dir);
    const r = await store.put("videos/a/1.mp4", body(100), 1000);
    expect(r.bytes).toBe(100);
    expect(r.sha256).toHaveLength(32);
    const opened = await store.open("videos/a/1.mp4", { start: 10, end: 19 });
    expect(opened?.size).toBe(100);
  });

  it("refuses a file past the limit and leaves nothing behind", async () => {
    const { localFileStore, FileTooLarge } = await import("../src/files.ts");
    const store = localFileStore(dir);
    await expect(store.put("videos/b/1.mp4", body(2000), 1000)).rejects.toBeInstanceOf(FileTooLarge);
    expect(readdirSync(join(dir, "videos/b"))).toEqual([]);
  });

  it("a disk error fails the upload instead of crashing the process", async () => {
    vi.resetModules();
    vi.doMock("node:fs", async (orig) => {
      const real = await orig<typeof import("node:fs")>();
      return {
        ...real,
        createWriteStream: () =>
          new Writable({
            write(_chunk, _enc, cb) {
              cb(Object.assign(new Error("no space left on device"), { code: "ENOSPC" }));
            },
          }),
      };
    });
    const crashed = vi.fn();
    process.once("uncaughtException", crashed);
    const { localFileStore } = await import("../src/files.ts");
    const store = localFileStore(dir);
    await expect(store.put("videos/c/1.mp4", body(70_000), 1_000_000)).rejects.toThrow(/no space/);
    await new Promise((r) => setTimeout(r, 50));
    process.removeListener("uncaughtException", crashed);
    expect(crashed).not.toHaveBeenCalled();
    vi.doUnmock("node:fs");
  });
});
