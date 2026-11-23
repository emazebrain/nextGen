/**
 * Paints the platform background (a solid colour or an image) behind every screen, and marks the page so the
 * content areas put a readable veil over it (app.css, "App background"). Screens with their own full background
 * (sign-in, hand-off, a running session) simply cover it.
 */
import { useEffect } from "react";
import { safeAppearance, useAppearance } from "../api/appearance.ts";

export function AppBackground() {
  const { data } = useAppearance();
  const a = safeAppearance(data);
  const kind = a?.kind;

  useEffect(() => {
    const root = document.documentElement;
    if (kind) root.dataset.appBg = kind;
    else delete root.dataset.appBg;
    return () => {
      delete root.dataset.appBg;
    };
  }, [kind]);

  if (!a) return null;
  return (
    <div
      className="app-bg"
      aria-hidden="true"
      data-blur={a.kind === "image" ? a.blur : "none"}
      style={a.kind === "color" ? { backgroundColor: a.color! } : { backgroundImage: `url("${a.image_url}")` }}
    />
  );
}
