import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// In development the SPA and the API share an origin through this proxy, so
// session cookies stay first-party. API_URL points at a running @emb/api.
const api = process.env.API_URL ?? "http://localhost:8787";

// The installable app (offline devices spec §7.1, ADR 0019): a service worker that precaches the whole build, game
// frames included, and a web app manifest. Not in the demo build, which runs inside a hosted page.
const pwa = VitePWA({
  strategies: "injectManifest",
  srcDir: "src",
  filename: "sw.ts",
  injectRegister: null,
  registerType: "prompt",
  manifest: {
    name: "eMazeBrain",
    short_name: "eMazeBrain",
    description: "Game-based activities for clinics",
    start_url: "/today",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#5B4BDB",
    lang: "en",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  },
  injectManifest: {
    rollupFormat: "iife",
    globPatterns: ["**/*.{js,css,html,svg,png,woff2,webmanifest}"],
    globIgnores: ["demo-videos/**", "**/*.map"],
    maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
  },
  devOptions: { enabled: false },
});

export default defineConfig(({ mode }) => ({
  plugins: mode === "demo" ? [react()] : [react(), pwa],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: api, changeOrigin: true, xfwd: true },
      "/v1": { target: api, changeOrigin: true, xfwd: true },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      "/api": { target: api, changeOrigin: true, xfwd: true },
      "/v1": { target: api, changeOrigin: true, xfwd: true },
    },
  },
  build: { sourcemap: true, target: "es2022" },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
  },
}));
