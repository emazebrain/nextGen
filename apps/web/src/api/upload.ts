/**
 * Uploading a file in parts. One long request does not survive the proxy in front of the hosted API (a 70 MB video
 * came back 502 after the last byte), so a file is cut into parts of a few megabytes, each sent as its own short
 * request — and sent again if it fails — before the server is asked to put them together.
 */
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiGet } from "./http.ts";

/** At a slow 200 KB/s a part still takes only about 20 seconds. */
export const UPLOAD_PART_BYTES = 4 * 1024 * 1024;

/** Sends every part of `file` to `partUrl(index)`; resolves with the number of parts. `onProgress` gets 0–1. */
export async function sendInParts(file: Blob, partUrl: (index: number) => string, onProgress: (fraction: number) => void): Promise<number> {
  const parts = Math.max(1, Math.ceil(file.size / UPLOAD_PART_BYTES));
  let sent = 0;
  for (let i = 0; i < parts; i++) {
    const blob = file.slice(i * UPLOAD_PART_BYTES, (i + 1) * UPLOAD_PART_BYTES);
    for (let attempt = 1; ; attempt++) {
      try {
        await sendPart(partUrl(i), blob, (loaded) => onProgress((sent + loaded) / Math.max(1, file.size)));
        break;
      } catch (err) {
        // A refusal (not allowed, too large) will not change on a second try; a dropped connection or a busy gateway may.
        const status = err instanceof ApiError ? err.status : 0;
        if (attempt >= 4 || (status >= 400 && status < 500)) throw err;
        await new Promise((r) => setTimeout(r, attempt * 1500));
      }
    }
    sent += blob.size;
  }
  return parts;
}

function sendPart(url: string, blob: Blob, onLoaded: (bytes: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.withCredentials = true;
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.setRequestHeader("accept", "application/json");
    xhr.upload.onprogress = (e) => e.lengthComputable && onLoaded(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let code = "unknown";
      try {
        code = JSON.parse(xhr.responseText)?.error ?? code;
      } catch {
        /* a gateway's own error page */
      }
      reject(new ApiError(xhr.status, code));
    };
    xhr.onerror = () => reject(new ApiError(0, "network"));
    xhr.send(blob);
  });
}

/** Whether the server keeps uploaded files for good. While it does not, the upload screens say so. */
export const useFilesStatus = () => useQuery({ queryKey: ["files-status"], queryFn: ({ signal }) => apiGet<{ durable: boolean }>("/v1/files/status", { signal }), staleTime: 5 * 60_000 });
