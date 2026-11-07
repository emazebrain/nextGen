/**
 * Results and video-views outbox (design doc §9.8; offline devices spec §7.3–7.4, ADR 0019).
 *
 * A finished game's envelope, or a watched video, is written here before it is sent, and stays until the server has
 * stored it. The device's UUIDv7 id makes resending safe.
 *
 * On a device set up for offline use the outbox is shared by everyone on it and sealed to the device outbox's public
 * key: a session writes to it with no connection and nobody signed in online, and it can only be read (and sent) by
 * a staff member signed in online on this device, who holds the private key in memory. Entries are credited to the
 * therapist named in their ticket, whoever sends them. Without that setup (a browser tab), items wait in
 * localStorage as before.
 *
 * An entry leaves only when the server answers accepted, duplicate or kept_for_review. A refusal (a reused id, a bad
 * ticket) keeps it, marked as needing help, and it isn't retried automatically.
 */
import type { ResultEnvelope } from "@emb/game-runtime/protocol";
import type { ResultReceipt, VideoViewInput, VideoViewReceipt } from "@emb/contracts";
import { useEffect, useState } from "react";
import { apiSend, ApiError } from "../api/http.ts";
import { openWithPrivate, sealToPublic } from "../device/crypto.ts";
import { deviceDb, type OutboxRecord } from "../device/db.ts";

const KEY = "emb.outbox.v1";
const VIEWS_KEY = "emb.outbox.views.v1";

export interface OutboxItem {
  ticket: string;
  envelope: ResultEnvelope;
  queued_at: number;
  tries: number;
  /** Last failure: "network", "signed_out", "needs_help", … */
  last_error?: string;
}
type LocalView = VideoViewInput & { last_error?: string };
type Payload = { kind: "result"; ticket: string; envelope: ResultEnvelope } | { kind: "view"; view: VideoViewInput };

export type SendResult = { state: "saved"; receipt: ResultReceipt } | { state: "rejected"; code: string } | { state: "waiting"; code: string };
export type ViewSendResult = { state: "saved"; receipt: VideoViewReceipt } | { state: "rejected"; code: string } | { state: "waiting"; code: string };

// ---- configuration ------------------------------------------------------------------------------------------------

let cfg: { publicKey: string; privateKey: CryptoKey | null } | null = null;
let needsSignIn = false;
const emit = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("emb:outbox"));
};

/** Called by the device layer: the outbox public key (always, once set up) and the private key (signed in online). */
export function configureOutbox(c: { publicKey: string; privateKey: CryptoKey | null } | null): void {
  cfg = c;
  if (c?.privateKey) needsSignIn = false;
  if (c) void migrateLocal(c.publicKey);
  emit();
}

/** Items queued in localStorage before this device was set up move into the sealed outbox, once. */
async function migrateLocal(publicKey: string) {
  const results = readLocal();
  const views = readLocalViews();
  if (!results.length && !views.length) return;
  for (const i of results) await putSealed(publicKey, i.envelope.session_id, { kind: "result", ticket: i.ticket, envelope: i.envelope }, new Date(i.queued_at || Date.now()).toISOString());
  for (const v of views) {
    const { last_error: _e, ...view } = v;
    await putSealed(publicKey, v.client_view_id, { kind: "view", view }, new Date().toISOString());
  }
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(VIEWS_KEY);
  } catch {
    /* blocked storage: nothing was there to move */
  }
  emit();
}

// ---- storage ------------------------------------------------------------------------------------------------------

function readLocal(): OutboxItem[] {
  try {
    const items = JSON.parse(localStorage.getItem(KEY) ?? "[]") as OutboxItem[];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}
function writeLocal(items: OutboxItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Storage full or blocked: the session screen still retries from memory.
  }
  emit();
}
function readLocalViews(): LocalView[] {
  try {
    const items = JSON.parse(localStorage.getItem(VIEWS_KEY) ?? "[]") as LocalView[];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}
function writeLocalViews(items: LocalView[]) {
  try {
    localStorage.setItem(VIEWS_KEY, JSON.stringify(items));
  } catch {
    // as above
  }
  emit();
}

async function putSealed(publicKey: string, id: string, p: Payload, createdAt = new Date().toISOString()) {
  const db = await deviceDb();
  if (await db.get("outbox", id)) return;
  const record: OutboxRecord = { id, kind: p.kind, created_at: createdAt, sealed: await sealToPublic(publicKey, p) };
  await db.put("outbox", record);
  emit();
}
async function removeSealed(id: string) {
  await (await deviceDb()).delete("outbox", id);
  emit();
}
async function markSealed(id: string) {
  const db = await deviceDb();
  const r = await db.get("outbox", id);
  if (r) await db.put("outbox", { ...r, needs_help: true });
  emit();
}

const remove = async (kind: Payload["kind"], id: string) => {
  if (cfg) return removeSealed(id);
  if (kind === "result") writeLocal(readLocal().filter((i) => i.envelope.session_id !== id));
  else writeLocalViews(readLocalViews().filter((v) => v.client_view_id !== id));
};
const mark = async (kind: Payload["kind"], id: string, code: string, help: boolean) => {
  if (cfg) return help ? markSealed(id) : undefined;
  if (kind === "result") writeLocal(readLocal().map((i) => (i.envelope.session_id === id ? { ...i, tries: i.tries + 1, last_error: help ? "needs_help" : code } : i)));
  else if (help) writeLocalViews(readLocalViews().map((v) => (v.client_view_id === id ? { ...v, last_error: "needs_help" } : v)));
};

// ---- queueing and sending -------------------------------------------------------------------------------------------

export async function enqueue(ticket: string, envelope: ResultEnvelope): Promise<void> {
  if (cfg) return putSealed(cfg.publicKey, envelope.session_id, { kind: "result", ticket, envelope });
  const items = readLocal();
  if (!items.some((i) => i.envelope.session_id === envelope.session_id)) items.push({ ticket, envelope, queued_at: Date.now(), tries: 0 });
  writeLocal(items);
}

export async function enqueueView(view: VideoViewInput): Promise<void> {
  if (cfg) return putSealed(cfg.publicKey, view.client_view_id, { kind: "view", view });
  const items = readLocalViews();
  if (!items.some((v) => v.client_view_id === view.client_view_id)) items.push(view);
  writeLocalViews(items);
}

/** What a failed send means for the entry: wait and retry, or keep it for a person to look at. */
function classify(e: unknown): { state: "waiting"; code: string } | { state: "rejected"; code: string } {
  const err = e instanceof ApiError ? e : new ApiError(0, "network");
  if (err.status === 0) return { state: "waiting", code: "network" };
  if (err.status === 401) {
    needsSignIn = true;
    return { state: "waiting", code: "signed_out" };
  }
  if (err.status === 400 || err.status === 409 || err.status === 422) return { state: "rejected", code: err.code };
  return { state: "waiting", code: err.code };
}

async function deliver<R>(kind: Payload["kind"], id: string, post: () => Promise<R>): Promise<{ state: "saved"; receipt: R } | { state: "rejected"; code: string } | { state: "waiting"; code: string }> {
  try {
    const receipt = await post();
    await remove(kind, id); // accepted, duplicate or kept_for_review: the server has it
    return { state: "saved", receipt };
  } catch (e) {
    const r = classify(e);
    await mark(kind, id, r.code, r.state === "rejected");
    emit();
    return r;
  }
}

export function send(item: Pick<OutboxItem, "ticket" | "envelope">): Promise<SendResult> {
  return deliver("result", item.envelope.session_id, () => apiSend<ResultReceipt>("POST", "/v1/results", { ticket: item.ticket, envelope: item.envelope }));
}

export function sendView(view: VideoViewInput): Promise<ViewSendResult> {
  return deliver("view", view.client_view_id, () => apiSend<VideoViewReceipt>("POST", "/v1/video-views", view));
}

/**
 * The device copy first, then the send — and the send happens even when the copy couldn't be written (a full disk,
 * a broken database): the result is never dropped silently. `stored: false` tells the screen to say so and keep it.
 */
export async function enqueueAndSend(ticket: string, envelope: ResultEnvelope): Promise<{ stored: boolean; result: SendResult }> {
  const stored = await enqueue(ticket, envelope).then(
    () => true,
    () => false,
  );
  return { stored, result: await send({ ticket, envelope }) };
}

export async function enqueueViewAndSend(view: VideoViewInput): Promise<{ stored: boolean; result: ViewSendResult }> {
  const stored = await enqueueView(view).then(
    () => true,
    () => false,
  );
  return { stored, result: await sendView(view) };
}

/** "Try again" for entries a person looked at: clears their needs-help mark and sends everything again. */
export async function retryNeedsHelp(): Promise<void> {
  if (cfg) {
    const db = await deviceDb();
    for (const r of await db.getAll("outbox")) if (r.needs_help) await db.put("outbox", { ...r, needs_help: false });
  } else {
    writeLocal(readLocal().map((i) => (i.last_error === "needs_help" ? { ...i, last_error: "retry" } : i)));
    writeLocalViews(readLocalViews().map((v) => (v.last_error === "needs_help" ? { ...v, last_error: "retry" } : v)));
  }
  emit();
  await flush();
}

let flushing: Promise<void> | null = null;

/** Sends everything waiting, oldest first, one at a time. Stops while offline or signed out. Safe to call often. */
export function flush(): Promise<void> {
  if (flushing) return flushing;
  const run = (async () => {
    {
      const stop = (r: { state: string; code?: string }) => r.state === "waiting" && (r.code === "network" || r.code === "signed_out");
      if (cfg) {
        if (!cfg.privateKey) return; // nobody signed in online on this device: the outbox can't be opened
        const records = (await (await deviceDb()).getAllFromIndex("outbox", "created_at")).filter((r) => !r.needs_help);
        for (const r of records) {
          const p = await openWithPrivate<Payload>(cfg.privateKey, r.sealed).catch(() => null);
          if (!p) continue;
          const res = p.kind === "result" ? await send({ ticket: p.ticket, envelope: p.envelope }) : await sendView(p.view);
          if (stop(res)) return;
        }
        return;
      }
      for (const item of readLocal().filter((i) => i.last_error !== "needs_help")) if (stop(await send(item))) return;
      for (const view of readLocalViews().filter((v) => v.last_error !== "needs_help")) if (stop(await sendView(view))) return;
    }
  })();
  // Cleared only after the run has been stored: a run that returns without awaiting anything (nobody signed in)
  // used to clear the marker before it was set, and then every later flush thought one was still running.
  const tracked: Promise<void> = run.finally(() => {
    if (flushing === tracked) flushing = null;
  });
  flushing = tracked;
  return tracked;
}

// ---- status ---------------------------------------------------------------------------------------------------------

export interface OutboxStatus {
  waiting: number;
  needsHelp: number;
  needsSignIn: boolean;
}

export async function outboxStatus(): Promise<OutboxStatus> {
  if (cfg) {
    const all = await (await deviceDb()).getAll("outbox");
    return { waiting: all.length, needsHelp: all.filter((r) => r.needs_help).length, needsSignIn };
  }
  const items = [...readLocal(), ...readLocalViews()];
  return { waiting: items.length, needsHelp: items.filter((i) => i.last_error === "needs_help").length, needsSignIn };
}

/** Kept for older screens and tests: what's waiting in this browser's local outbox. */
export function pending(): OutboxItem[] {
  return readLocal();
}
export function pendingViews(): VideoViewInput[] {
  return readLocalViews();
}

export function useOutboxStatus(): OutboxStatus {
  const [s, setS] = useState<OutboxStatus>({ waiting: 0, needsHelp: 0, needsSignIn: false });
  useEffect(() => {
    let live = true;
    const update = () => void outboxStatus().then((x) => live && setS(x));
    update();
    window.addEventListener("emb:outbox", update);
    return () => {
      live = false;
      window.removeEventListener("emb:outbox", update);
    };
  }, []);
  return s;
}
