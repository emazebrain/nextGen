/**
 * The video library (design doc §7 video / video_i18n / brain_region, ADR 0018): what an admin sends to add or
 * edit a video, and what clients get back.
 */
import { z } from "zod";
import type { RegionSettingView } from "./regions.ts";

export const VIDEO_LOCALES = ["en", "he", "ar", "ru", "fr", "es", "zh"] as const;
export type VideoLocale = (typeof VIDEO_LOCALES)[number];
export const VIDEO_MAX_BYTES = 1_073_741_824;
export const VIDEO_MIME = ["video/mp4", "video/webm"] as const;

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const YT_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtube-nocookie.com", "youtube-nocookie.com"]);

/** The 11-character video id from a YouTube link (watch, youtu.be, shorts, embed) or a bare id; null otherwise. */
export function youtubeId(urlOrId: string): string | null {
  const s = urlOrId.trim();
  if (YT_ID.test(s)) return s;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!YT_HOSTS.has(url.hostname)) return null;
  const candidate = url.hostname === "youtu.be" ? url.pathname.split("/")[1] : (url.searchParams.get("v") ?? url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/)?.[1]);
  return candidate && YT_ID.test(candidate) ? candidate : null;
}

const texts = (max: number) => z.partialRecord(z.enum(VIDEO_LOCALES), z.string().max(max));
const age = z.number().int().min(3).max(18).nullable();

export const videoInput = z
  .object({
    source: z.enum(["upload", "youtube"]),
    youtube_url: z.string().max(300).optional(),
    titles: texts(160),
    descriptions: texts(2000).optional(),
    region_ids: z.array(z.string().uuid()).max(60),
    age_min: age,
    age_max: age,
    status: z.enum(["draft", "published", "archived"]),
    duration_s: z.number().int().min(1).max(7200).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.source === "youtube" && !youtubeId(v.youtube_url ?? "")) ctx.addIssue({ code: "custom", path: ["youtube_url"], message: "not_youtube" });
    if (!Object.values(v.titles).some((t) => t && t.trim())) ctx.addIssue({ code: "custom", path: ["titles"], message: "needs_title" });
    if (v.age_min !== null && v.age_max !== null && v.age_min > v.age_max) ctx.addIssue({ code: "custom", path: ["age_max"], message: "age_order" });
  });
export type VideoInput = z.input<typeof videoInput>;

export interface RegionRef {
  id: string;
  kind: "hemisphere" | "lobe" | "sublobe" | "area";
  code: string;
  path: string;
}

export interface BrainRegion extends RegionRef {
  parent_id: string | null;
  label: string;
  sort: number;
  /** An area's sub-lobe (brain-region filters spec): a game filtered by the area runs with that sub-lobe's row. */
  sublobe_id: string | null;
  /** A sub-lobe's settings row from the product owner's table; null for every other node. */
  setting: RegionSettingView | null;
}

export interface VideoSummary {
  id: string;
  source: "upload" | "youtube";
  youtube_id: string | null;
  /** In the requested language, falling back to English, then Hebrew, then any. */
  title: string;
  description: string | null;
  titles: Partial<Record<VideoLocale, string>>;
  descriptions: Partial<Record<VideoLocale, string>>;
  duration_s: number | null;
  age_min: number | null;
  age_max: number | null;
  status: "draft" | "published" | "archived";
  version: number;
  has_file: boolean;
  /** YouTube videos stream from YouTube and cannot be kept on the device. */
  needs_internet: boolean;
  regions: RegionRef[];
}
