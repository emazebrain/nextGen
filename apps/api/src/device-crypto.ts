/**
 * Seals device and space secrets at rest (offline devices spec §7.5). They are stored encrypted, not hashed, because
 * the server hands them back to the device at each online sign-in. AES-256-GCM, a random 12-byte IV in front.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface DeviceKey {
  seal(plain: Buffer): Buffer;
  open(sealed: Buffer): Buffer;
}

export function deviceKey(base64: string | undefined): DeviceKey {
  const key = base64 ? Buffer.from(base64, "base64") : randomBytes(32);
  if (key.length !== 32) throw new Error("DEVICE_SECRET_KEY must be 32 bytes, base64");
  return {
    seal(plain) {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([c.update(plain), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), body]);
    },
    open(sealed) {
      const d = createDecipheriv("aes-256-gcm", key, sealed.subarray(0, 12));
      d.setAuthTag(sealed.subarray(12, 28));
      return Buffer.concat([d.update(sealed.subarray(28)), d.final()]);
    },
  };
}
