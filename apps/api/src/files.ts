/**
 * Where uploaded files live (ADR 0018). One interface, two homes: a folder on disk for development, tests and the
 * local (offline) version; S3 with SSE-KMS in the cloud cells (design doc §9) — added with production deployment.
 * Keys never contain patient data.
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

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
      let bytes = 0;
      // One pipeline: backpressure, the size cap and every error (network, disk full) end in one rejection.
      const meter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          bytes += chunk.length;
          if (bytes > maxBytes) return cb(new FileTooLarge());
          hash.update(chunk);
          cb(null, chunk);
        },
      });
      try {
        await pipeline(Readable.fromWeb(body as never), meter, createWriteStream(tmp));
        await rename(tmp, target);
        return { bytes, sha256: hash.digest() };
      } catch (err) {
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

/**
 * Where uploaded files (videos, session music) are kept, and whether they outlive a deploy.
 *   FILE_STORE_DIR             an explicit folder — the operator's choice, taken as durable;
 *   RAILWAY_VOLUME_MOUNT_PATH  Railway sets this when a volume is attached to the service: files go to <mount>/files
 *                              and survive deploys with no further setup;
 *   otherwise                  .data/files on the container's own disk, which the host discards on every deploy.
 * In development and tests nothing is deployed, so the local folder counts as durable there.
 */
export function fileStorePlan(env: Record<string, string | undefined> = process.env): { dir: string; durable: boolean } {
  if (env.FILE_STORE_DIR) return { dir: env.FILE_STORE_DIR, durable: true };
  if (env.RAILWAY_VOLUME_MOUNT_PATH) return { dir: join(env.RAILWAY_VOLUME_MOUNT_PATH, "files"), durable: true };
  return { dir: ".data/files", durable: env.NODE_ENV !== "production" };
}

/**
 * Puts the parts of an upload together into one file, in order. Used when a file arrives as several short requests
 * (a single long upload does not survive the proxy in front of the hosted API). Every part must exist; the parts are
 * removed afterwards whether or not the file was stored. Returns null when a part is missing.
 */
export async function joinParts(files: FileStore, partKeys: string[], key: string, maxBytes: number): Promise<{ bytes: number; sha256: Buffer } | { missing: number }> {
  for (let i = 0; i < partKeys.length; i++) {
    const part = await files.open(partKeys[i]!);
    if (!part) return { missing: i };
    await part.stream.cancel();
  }
  let at = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const whole = new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        if (!reader) {
          if (at >= partKeys.length) return controller.close();
          const part = await files.open(partKeys[at++]!);
          if (!part) return controller.error(new Error("missing_part"));
          reader = part.stream.getReader();
        }
        const { done, value } = await reader.read();
        if (done) {
          reader = null;
          continue;
        }
        return controller.enqueue(value);
      }
    },
  });
  try {
    return await files.put(key, whole, maxBytes);
  } finally {
    for (const k of partKeys) await files.remove(k).catch(() => undefined);
  }
}

/** One part of a file sent in parts: small enough to pass any proxy in seconds. */
export const UPLOAD_PART_MAX_BYTES = 8 * 1024 * 1024;
