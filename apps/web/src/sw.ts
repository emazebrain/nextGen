/// <reference lib="webworker" />
/**
 * The service worker (offline devices spec §7.1–7.2; ADR 0019).
 * - Precaches the whole app build, including every game frame bundle, so the app opens with no connection.
 * - Serves the app shell for navigations when offline (not /v1 or /api).
 * - Serves stored video versions (/v1/videos/:id/file?v=N) from the video cache, with byte ranges for seeking;
 *   anything not stored goes to the network. The page's content store decides what is stored.
 * - Takes over only when the page asks (never in the middle of a session).
 * API data is never cached here: offline data comes from the encrypted spaces.
 */
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { createPartialResponse } from "workbox-range-requests";

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

const VIDEO_CACHE = "emb-videos-v1";

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html"), { denylist: [/^\/v1\//, /^\/api\//] }));

registerRoute(
  ({ url, request }) => request.method === "GET" && /^\/v1\/videos\/[^/]+\/file$/.test(url.pathname) && url.searchParams.has("v"),
  async ({ request }) => {
    const cache = await caches.open(VIDEO_CACHE);
    const stored = await cache.match(request.url, { ignoreVary: true });
    if (!stored) return fetch(request);
    return request.headers.has("range") ? createPartialResponse(request, stored) : stored;
  },
);

self.addEventListener("message", (event) => {
  if ((event.data as { type?: string } | null)?.type === "apply-update") void self.skipWaiting();
});
