/**
 * What a session includes: its game-based activities and videos, in the order they are played. Names only — no
 * settings, levels or results — so it is safe to show to a guardian as well as to staff.
 */
import type { StepItem } from "@emb/contracts";
import { Gamepad2, Video } from "lucide-react";
import { findGame, localText } from "../games/registry.ts";
import { usePrefs, useT } from "../i18n/index.tsx";

export function SessionItems({ items, label }: { items: StepItem[]; label: string }) {
  const t = useT();
  const { locale } = usePrefs();
  if (items.length === 0) return null;
  return (
    <div className="session-items">
      <p className="session-items__label">{label}</p>
      <ol className="plainlist session-items__list">
        {items.map((item, i) => {
          const game = item.kind === "game" ? findGame(item.game_id) : undefined;
          const name = item.kind === "video" ? item.title : game ? localText(game.manifest.name, locale) : item.game_id;
          return (
            <li key={i} className="session-items__item">
              {item.kind === "video" ? <Video size={16} aria-hidden="true" /> : <Gamepad2 size={16} aria-hidden="true" />}
              <span className="session-items__name"><bdi>{name || t("parent.itemVideo")}</bdi></span>
              <span className="session-items__kind">{t(item.kind === "video" ? "parent.itemVideo" : "parent.itemGame")}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
