/**
 * Launch tickets (design doc §8.2): an Ed25519-signed JWS that says which
 * protocol step a game was started for, for which patient, with which exact
 * parameters (by hash). The results upload must carry it, so a result can't
 * be attached to another patient or claim settings it wasn't played with.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { canonicalJson } from "../../../packages/contracts/src/sessions.ts";
import type { AllowedParams } from "../../../packages/contracts/src/offline.ts";

export interface TicketClaims {
  v: 1;
  jti: string;
  /** planned session */
  psid: string;
  /** assignment step */
  asid: string;
  /** patient */
  pid: string;
  /** game */
  gid: string;
  /** sha256 of the canonical params */
  ph: string;
  /** issued to (staff user) */
  sub: string;
  iat: number;
  exp: number;
}

/**
 * Offline tickets (v2, offline devices spec §7.4, ADR 0019): issued in a device's offline package, valid 30 days,
 * bound to the therapist (sub) and the device (dev); they sign the allowed parameters instead of one exact hash.
 */
export interface TicketClaimsV2 {
  v: 2;
  jti: string;
  psid: string;
  asid: string;
  pid: string;
  /** game id, or "video" for a video step */
  gid: string;
  sub: string;
  dev: string;
  allowed: AllowedParams;
  iat: number;
  exp: number;
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function paramsHash(params: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson(params)).digest("hex");
}

export interface TicketSigner {
  kid: string;
  sign(claims: Omit<TicketClaims, "v" | "iat" | "exp">, ttlS: number): string;
  signV2(claims: Omit<TicketClaimsV2, "v" | "iat" | "exp">, ttlS: number): string;
  verify(token: string, now?: number): TicketClaims | TicketClaimsV2 | null;
}

/** pem: PKCS#8 Ed25519 private key. Without one (local dev, tests) a throwaway key is made. */
export function ticketSigner(pem?: string): TicketSigner {
  let priv: KeyObject;
  if (pem) priv = createPrivateKey(pem);
  else ({ privateKey: priv } = generateKeyPairSync("ed25519"));
  const pub = createPublicKey(priv);
  const kid = createHash("sha256").update(pub.export({ type: "spki", format: "der" })).digest("hex").slice(0, 16);
  const header = b64u(JSON.stringify({ alg: "EdDSA", typ: "JWT", kid }));
  const issue = (claims: Record<string, unknown>, ttlS: number) => {
    const iat = Math.floor(Date.now() / 1000);
    const body = b64u(JSON.stringify({ ...claims, iat, exp: iat + ttlS }));
    const sig = sign(null, Buffer.from(`${header}.${body}`), priv);
    return `${header}.${body}.${b64u(sig)}`;
  };
  return {
    kid,
    sign(claims, ttlS) {
      return issue({ v: 1, ...claims }, ttlS);
    },
    signV2(claims, ttlS) {
      return issue({ v: 2, ...claims }, ttlS);
    },
    verify(token, now = Date.now()) {
      const parts = token.split(".");
      if (parts.length !== 3 || parts[0] !== header) return null;
      const ok = verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), pub, Buffer.from(parts[2]!, "base64url"));
      if (!ok) return null;
      try {
        const c = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as TicketClaims | TicketClaimsV2;
        if ((c.v !== 1 && c.v !== 2) || typeof c.exp !== "number" || c.exp * 1000 < now) return null;
        if (c.v === 2 && (typeof c.dev !== "string" || !c.allowed || typeof c.allowed.exact !== "object")) return null;
        return c;
      } catch {
        return null;
      }
    },
  };
}
