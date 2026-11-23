/**
 * The app background (platform appearance): the theme default, a solid colour or an uploaded image, the same for
 * every user. Anyone reads it from /api/appearance; platform admins change it under /v1/admin/appearance.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiGet, apiSend } from "./http.ts";

export type AppearanceKind = "default" | "color" | "image";
export type AppearanceBlur = "none" | "light" | "strong";
export const BLURS: AppearanceBlur[] = ["none", "light", "strong"];

export interface Appearance {
  kind: AppearanceKind;
  color: string | null;
  blur: AppearanceBlur;
  version: number;
  image_url: string | null;
}
export interface AdminAppearance extends Appearance {
  has_image: boolean;
}

export const HEX = /^#[0-9a-f]{6}$/;
const IMAGE_URL = /^\/api\/appearance\/image\?v=\d+$/;
/** The server's limit; larger files are resized in the browser first. */
export const IMAGE_MAX_BYTES = 3 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * A background that is safe to put into styles, or null for "leave the page as it is". Only a six-digit hex colour
 * or the app's own image address gets through, whatever the server or the device's storage says.
 */
export function safeAppearance(raw: unknown): Appearance | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Partial<Appearance>;
  const blur: AppearanceBlur = BLURS.includes(a.blur as AppearanceBlur) ? (a.blur as AppearanceBlur) : "light";
  const version = typeof a.version === "number" ? a.version : 1;
  if (a.kind === "color" && typeof a.color === "string" && HEX.test(a.color)) return { kind: "color", color: a.color, blur, version, image_url: null };
  if (a.kind === "image" && typeof a.image_url === "string" && IMAGE_URL.test(a.image_url)) return { kind: "image", color: null, blur, version, image_url: a.image_url };
  return null;
}

const STORE = "emb.appearance";
/** The background from the last visit, so the page doesn't flash plain before the server answers. */
function remembered(): Appearance | undefined {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? ((JSON.parse(raw) as Appearance | null) ?? undefined) : undefined;
  } catch {
    return undefined;
  }
}
function remember(a: Appearance) {
  try {
    localStorage.setItem(STORE, JSON.stringify(a));
  } catch {
    /* not remembered */
  }
}

const siteKey = ["appearance"] as const;
const adminKey = ["admin", "appearance"] as const;

export function useAppearance() {
  return useQuery<Appearance>({
    queryKey: siteKey,
    queryFn: ({ signal }) =>
      apiGet<Appearance>("/api/appearance", { signal }).then((a) => {
        remember(a);
        return a;
      }),
    // Shown at once and kept if the server can't be reached; always re-checked.
    initialData: () => remembered(),
    initialDataUpdatedAt: 0,
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useAdminAppearance() {
  return useQuery({
    queryKey: adminKey,
    queryFn: ({ signal }) => apiGet<{ appearance: AdminAppearance }>("/v1/admin/appearance", { signal }).then((r) => r.appearance),
    retry: false,
  });
}

async function uploadImage(image: Blob): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/v1/admin/appearance/image", { method: "PUT", credentials: "include", headers: { accept: "application/json", "content-type": image.type }, body: image });
  } catch {
    throw new ApiError(0, "network");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? "unknown");
  }
}

export interface SaveAppearance {
  kind: AppearanceKind;
  color?: string;
  blur?: AppearanceBlur;
  /** A newly chosen image: uploaded first, then the rest is saved. */
  image?: Blob;
}

export function useSaveAppearance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ image, ...body }: SaveAppearance) => {
      if (image) await uploadImage(image);
      return apiSend<{ appearance: AdminAppearance }>("PUT", "/v1/admin/appearance", body).then((r) => r.appearance);
    },
    onSuccess: (a) => {
      qc.setQueryData(adminKey, a);
      void qc.invalidateQueries({ queryKey: siteKey });
    },
  });
}

/**
 * Shrinks a large photo to at most 2560 px on its long side and re-encodes it as JPEG, so a phone photo fits the
 * upload limit. Where the browser can't do that, or the file is already small, the original goes up unchanged.
 */
export async function prepareImage(file: File): Promise<Blob> {
  const MAX_SIDE = 2560;
  if (typeof createImageBitmap !== "function") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size <= IMAGE_MAX_BYTES / 2) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return out && out.size < file.size ? out : file;
  } catch {
    return file;
  }
}
