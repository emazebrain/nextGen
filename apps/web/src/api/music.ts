/** Uploaded session music (apps/api modules/music). */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend } from "./http.ts";
import { sendInParts } from "./upload.ts";

export type MusicScope = "platform" | "organization" | "clinic" | "personal";
export type MusicSide = "left" | "right";
export interface MusicTrack {
  id: string;
  scope: MusicScope;
  hemisphere: MusicSide;
  title: string;
  bytes: number;
  mime: string;
  mine: boolean;
  uploaded_by: string;
  can_manage: boolean;
  created_at: string;
}
export interface MusicList {
  tracks: MusicTrack[];
  /** The levels the signed-in user may upload to here, widest first. */
  upload_scopes: MusicScope[];
}

const key = ["music"] as const;
export const musicFileUrl = (id: string) => `/v1/music/${encodeURIComponent(id)}/file`;

export const useMusic = (clinicId: string | null) =>
  useQuery({ queryKey: [...key, clinicId], queryFn: ({ signal }) => apiGet<MusicList>(`/v1/music${clinicId ? `?clinic=${encodeURIComponent(clinicId)}` : ""}`, { signal }) });

export interface MusicUpload {
  file: File;
  title: string;
  hemisphere: MusicSide;
  scope: MusicScope;
  clinicId: string | null;
}

/**
 * Sends the file in parts, then asks the server to put them together as a track. The uploader's rights confirmation
 * travels with that last request (the form requires the tick).
 */
export function useUploadMusic(onProgress?: (fraction: number) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (u: MusicUpload) => {
      const q = new URLSearchParams({ scope: u.scope, hemisphere: u.hemisphere, title: u.title, rights: "confirmed" });
      if (u.clinicId && u.scope !== "platform") q.set("clinic", u.clinicId);
      const uploadId = crypto.randomUUID();
      const parts = await sendInParts(u.file, (i) => `/v1/music/parts/${uploadId}/${i}`, (f) => onProgress?.(f * 0.97));
      const done = await apiSend<{ track: MusicTrack }>("POST", `/v1/music/complete?${q}`, { upload_id: uploadId, parts, mime: u.file.type || "audio/mpeg" });
      onProgress?.(1);
      return done.track;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });
}

export function useUpdateMusic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...change }: { id: string; title?: string; hemisphere?: MusicSide }) => apiSend<{ track: MusicTrack }>("PATCH", `/v1/music/${id}`, change),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });
}

export function useRemoveMusic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiSend<{ ok: true }>("DELETE", `/v1/music/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });
}
