import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/rubik";
import "@emb/ui/styles.css";
import "./styles/app.css";
import { App } from "./App.tsx";
import { registerServiceWorker } from "./device/update.ts";

async function start() {
  const demo = import.meta.env.MODE === "demo";
  if (demo) {
    // Demo build only: an in-memory API with synthetic data, so the app can be
    // clicked through without a server. Never part of a normal build.
    const { installDemoApi } = await import("./demo/fake-api.ts");
    installDemoApi();
  }
  void registerServiceWorker();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App hashRouting={demo} />
    </StrictMode>,
  );
}

void start();
