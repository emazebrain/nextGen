/**
 * Results outbox (design doc §9.8): a finished game's envelope is written
 * here before it is sent, and stays until the server has answered for it. A
 * dropped connection, a closed tab or a crash never loses a result; the
 * device's UUIDv7 session_id makes resending safe.
 *
 * What's stored: the signed ticket and the envelope (ids, settings and
 * scores — no names). Nothing is ever removed without a server answer.
 */
import type { ResultEnvelope } from "@emb/game-runtime/protocol";
import type { ResultReceipt, VideoViewInput, VideoViewReceipt } from "@emb/contracts";
import { apiSend, ApiError } from "../api/http.ts";

const KEY = "emb.outbox.v1";

export interface OutboxItem {
  ticket: string;
  envelope: ResultEnvelope;
  queued_at: number;
  tries: number;
  /** Last failure, for the summary screen: "network", "forbidden", … */
  last_error?: string;
}

export type SendResult = { state: "saved"; receipt: ResultReceipt } | { state: "rejected"; code: string } | { state: "waiting"; code: string };

function read(): OutboxItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    const items = raw ? (JSON.parse(raw) as OutboxItem[]) : [];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function write(items: OutboxItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Storage full or blocked: the in-memory copy in the session screen still retries.
  }
  window.dispatchEvent(new Event("emb:outbox"));
}

export function pending(): OutboxItem[] {
  return read();
}

export function enqueue(ticket: string, envelope: ResultEnvelope) {
  const items = read();
  if (!items.some((i) => i.envelope.session_id === envelope.session_id)) items.push({ ticket, envelope, queued_at: Date.now(), tries: 0 });
  write(items);
}

function remove(sessionId: string) {
  write(read().filter((i) => i.envelope.session_id !== sessionId));
}

function note(sessionId: string, code: string) {
  write(read().map((i) => (i.envelope.session_id === sessionId ? { ...i, tries: i.tries + 1, last_error: code } : i)));
}

/** Sends one item. Removes it only when the server has stored it, or stored the rejection. */
export async function send(item: Pick<OutboxItem, "ticket" | "envelope">): Promise<SendResult> {
  const id = item.envelope.session_id;
  try {
    const receipt = await apiSend<ResultReceipt>("POST", "/v1/results", { ticket: item.ticket, envelope: item.envelope });
    remove(id);
    return { state: "saved", receipt };
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError(0, "network");
    // 400/422: the server kept the attempt in its raw log and said why; resending won't change the answer.
    if (err.status === 400 || err.status === 422) {
      remove(id);
      return { state: "rejected", code: err.code };
    }
    // Offline, signed out, server trouble, or this user can't record for the patient: keep it and try again later.
    note(id, err.status === 0 ? "network" : err.code);
    return { state: "waiting", code: err.status === 0 ? "network" : err.code };
  }
}

// ---------------------------------------------------------------- watched videos (ADR 0018)
// Same rules as results: kept on the device until the server has answered; the UUIDv7 view id makes resending safe.

const VIEWS_KEY = "emb.outbox.views.v1";
export type ViewSendResult = { state: "saved"; receipt: VideoViewReceipt } | { state: "rejected"; code: string } | { state: "waiting"; code: string };

function readViews(): VideoViewInput[] {
  try {
    const items = JSON.parse(localStorage.getItem(VIEWS_KEY) ?? "[]") as VideoViewInput[];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function writeViews(items: VideoViewInput[]) {
  try {
    localStorage.setItem(VIEWS_KEY, JSON.stringify(items));
  } catch {
    // Storage full or blocked: the session screen still retries from memory.
  }
  window.dispatchEvent(new Event("emb:outbox"));
}

export function pendingViews(): VideoViewInput[] {
  return readViews();
}

export function enqueueView(view: VideoViewInput) {
  const items = readViews();
  if (!items.some((v) => v.client_view_id === view.client_view_id)) items.push(view);
  writeViews(items);
}

export async function sendView(view: VideoViewInput): Promise<ViewSendResult> {
  const drop = () => writeViews(readViews().filter((v) => v.client_view_id !== view.client_view_id));
  try {
    const receipt = await apiSend<VideoViewReceipt>("POST", "/v1/video-views", view);
    drop();
    return { state: "saved", receipt };
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError(0, "network");
    // 400/409/422: the answer won't change (bad view, session already closed, wrong step).
    if (err.status === 400 || err.status === 409 || err.status === 422) {
      drop();
      return { state: "rejected", code: err.code };
    }
    return { state: "waiting", code: err.status === 0 ? "network" : err.code };
  }
}

let flushing: Promise<void> | null = null;

/** Sends everything waiting, one at a time. Safe to call often. */
export function flush(): Promise<void> {
  flushing ??= (async () => {
    try {
      for (const item of read()) {
        const r = await send(item);
        if (r.state === "waiting" && r.code === "network") return; // still offline: stop for now
      }
      for (const view of readViews()) {
        const r = await sendView(view);
        if (r.state === "waiting" && r.code === "network") return;
      }
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}
