/**
 * Where uploaded files live (ADR 0018). One interface, two homes: a folder on disk for development, tests and the
 * local (offline) version; S3 with SSE-KMS in the cloud cells (design doc §9) — added with production deployment.
 * Keys never contain patient data.
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";

export class FileTooLarge extends Error {
  constructor() {
    super("file_too_large");
  }
}

export interface FileStore {
  /** Streams body to key; rejects with FileTooLarge past maxBytes and leaves nothing behind. */
  put(key: string, body: ReadableStream<Uint8Array>, maxBytes: number): Promise<{ bytes: number; sha256: Buffer }>;
  /** The whole file, or the inclusive byte range; null when the key is unknown. */
  open(key: string, range?: { start: number; end: number }): Promise<{ stream: ReadableStream<Uint8Array>; size: number } | null>;
  remove(key: string): Promise<void>;
}

export function localFileStore(dir: string): FileStore {
  const root = resolve(dir);
  const pathOf = (key: string) => {
    const p = resolve(root, key);
    if (!p.startsWith(root + sep)) throw new Error("invalid_key"); // no escaping the folder
    return p;
  };
  return {
    async put(key, body, maxBytes) {
      const target = pathOf(key);
      await mkdir(dirname(target), { recursive: true });
      const tmp = join(dirname(target), `.upload-${randomUUID()}`);
      const hash = createHash("sha256");
      const out = createWriteStream(tmp);
      let bytes = 0;
      try {
        for await (const chunk of Readable.fromWeb(body as never) as AsyncIterable<Buffer>) {
          bytes += chunk.length;
          if (bytes > maxBytes) throw new FileTooLarge();
          hash.update(chunk);
          if (!out.write(chunk)) await new Promise<void>((r) => out.once("drain", () => r()));
        }
        await new Promise<void>((res, rej) => out.end((err?: Error | null) => (err ? rej(err) : res())));
        await rename(tmp, target);
        return { bytes, sha256: hash.digest() };
      } catch (err) {
        out.destroy();
        await rm(tmp, { force: true });
        throw err;
      }
    },
    async open(key, range) {
      const p = pathOf(key);
      const info = await stat(p).catch(() => null);
      if (!info?.isFile()) return null;
      const stream = createReadStream(p, range ? { start: range.start, end: range.end } : {});
      return { stream: Readable.toWeb(stream) as ReadableStream<Uint8Array>, size: info.size };
    },
    async remove(key) {
      await rm(pathOf(key), { force: true });
    },
  };
}
