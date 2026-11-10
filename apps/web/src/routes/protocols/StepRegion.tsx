/**
 * The brain-region filter on a game step (brain-region filters spec 2026-11-09 §7). It replaces the Hemisphere control:
 * the side is the hemisphere; a lobe, sub-lobe or Brodmann area makes the product owner's table decide the game's
 * configuration. The summary says what the chosen filter changes in this game, from its manifest's `regionUse`.
 */
import { useId, useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { timerPositionFor, timerShown } from "@emb/session-rules";
import { gameRegionError, hemisphereForSetting, lobeSublobes, regionCatalog, sideOf, sublobesFor, type BrainRegion, type GameStepInput, type RegionCatalog } from "@emb/contracts";
import type { GameManifest } from "@emb/game-sdk";
import { Segmented, SelectField } from "@emb/ui";
import { useBrainRegions } from "../../api/queries.ts";
import { localText } from "../../games/registry.ts";
import { usePrefs, useT } from "../../i18n/index.tsx";

type Side = "left" | "right";

export function useRegionCatalog(locale: string): RegionCatalog | null {
  const regions = useBrainRegions(locale);
  return useMemo(() => (regions.data ? regionCatalog(regions.data) : null), [regions.data]);
}

/** The hemisphere a step's game runs as: its side, or its row's (cold → right); "varies" when a lobe draws both. */
export function runsAsHemisphere(cat: RegionCatalog, s: Pick<GameStepInput, "hemisphere" | "region_id">): Side | "varies" {
  if (!s.region_id) return s.hemisphere;
  const hs = [...new Set(sublobesFor(cat, s.region_id).map((o) => hemisphereForSetting(o.setting!)))];
  return hs.length === 0 ? s.hemisphere : hs.length === 1 ? hs[0]! : "varies";
}

/** "Right · Superior temporal", "Left · BA46", "Right · Frontal lobe". */
export function regionLabel(cat: RegionCatalog, path: string, short: (s: Side) => string): string | null {
  const r = cat.byPath.get(path);
  if (!r) return null;
  const name = r.kind === "area" && r.code.startsWith("ba") ? r.code.toUpperCase() : r.label;
  return `${short(sideOf(r))} · ${name}`;
}

export function StepRegion({ step: s, manifest: m, onChange }: { step: GameStepInput; manifest: GameManifest; onChange: (s: GameStepInput) => void }) {
  const t = useT();
  const intl = useIntl();
  const { locale } = usePrefs();
  const id = useId();
  const cat = useRegionCatalog(locale);
  const node = s.region_id && cat ? cat.byId.get(s.region_id) : undefined;
  const [mode, setMode] = useState<"region" | "area">(node?.kind === "area" ? "area" : "region");
  const side: Side = s.hemisphere;
  const showTimer = timerShown(s.timer_position);
  const set = (hemisphere: Side, region_id: string | null) => onChange({ ...s, hemisphere, region_id, timer_position: timerPositionFor(hemisphere, showTimer) });

  if (!cat) return <p className="app-muted">{t("common.loading")}</p>;
  const hemi = cat.byPath.get(side);
  const lobes = hemi ? (cat.children.get(hemi.id) ?? []).filter((l) => l.kind === "lobe") : [];
  const gameLobes = lobes.filter((l) => lobeSublobes(cat, l.id).length > 0);
  const lobeNode = node?.kind === "lobe" ? node : node?.kind === "sublobe" ? cat.byId.get(node.parent_id!) : undefined;
  const subs = lobeNode ? lobeSublobes(cat, lobeNode.id) : [];

  const changeSide = (next: Side) => {
    // Keep the same region on the other side when it exists there; otherwise side only.
    const twin = node ? cat.byPath.get(`${next}${node.path.slice(node.path.indexOf("."))}`) : undefined;
    set(next, twin && !gameRegionError(cat, twin.id) ? twin.id : null);
  };

  const options = node ? sublobesFor(cat, node.id) : [];
  const settings = options.map((o) => o.setting!);
  const runsAs = [...new Set(settings.map(hemisphereForSetting))];
  const temps = [...new Set(settings.map((x) => x.bg_temperature))];
  const types = [...new Set(settings.flatMap((x) => x.bg_types))];
  const uses: string[] = [];
  if (node) {
    uses.push(runsAs.length === 1 ? t("stepRegion.usesHemisphere", { h: runsAs[0]! }) : t("stepRegion.usesHemisphereVaries"));
    if (m.regionUse?.background)
      uses.push(t("stepRegion.usesBackground", { temp: temps.length === 1 ? temps[0]! : "mixed", types: intl.formatList(types.map((x) => t("stepRegion.bgType", { t: x })), { type: "disjunction" }) }));
    if (m.regionUse?.direction) uses.push(t("stepRegion.usesDirection"));
    if (m.regionUse?.targetLocation) uses.push(t("stepRegion.usesTarget"));
    if (m.regionUse?.rotation) uses.push(t("stepRegion.usesRotation"));
  }
  const crossed = options.filter((o) => hemisphereForSetting(o.setting!) !== side);
  const areaLabel = (a: BrainRegion) => {
    const sub = a.sublobe_id ? cat.byId.get(a.sublobe_id) : undefined;
    return sub?.setting ? `${a.code.toUpperCase()} — ${sub.label}` : t("stepRegion.noSettings", { area: a.code.toUpperCase() });
  };

  return (
    <fieldset className="stepedit__fieldset stepregion">
      <legend className="emb-field__label">{t("stepRegion.legend")}</legend>
      <Segmented<"region" | "area">
        legend={t("stepRegion.mode")}
        name={`${id}-mode`}
        value={mode}
        onChange={(next) => {
          setMode(next);
          // A filter the other list can't show is cleared, so what the control shows is what will run.
          if (node && (next === "area") !== (node.kind === "area")) set(side, null);
        }}
        options={[
          { value: "region", label: t("stepRegion.byRegion") },
          { value: "area", label: t("stepRegion.byArea") },
        ]}
      />
      <div className="pform__row">
        <SelectField label={t("stepRegion.side")} value={side} onChange={(e) => changeSide(e.target.value as Side)}>
          {(["left", "right"] as const).map((h) => (
            <option key={h} value={h}>
              {cat.byPath.get(h)?.label ?? h}
            </option>
          ))}
        </SelectField>
        {mode === "region" ? (
          <>
            <SelectField label={t("stepRegion.lobe")} value={lobeNode?.id ?? ""} onChange={(e) => set(side, e.target.value || null)}>
              <option value="">{t("stepRegion.any")}</option>
              {gameLobes.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </SelectField>
            <SelectField label={t("stepRegion.sublobe")} value={node?.kind === "sublobe" ? node.id : ""} disabled={!lobeNode} onChange={(e) => set(side, e.target.value || lobeNode?.id || null)}>
              <option value="">{t("stepRegion.any")}</option>
              {subs.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </SelectField>
          </>
        ) : (
          <SelectField label={t("stepRegion.area")} value={node?.kind === "area" ? node.id : ""} onChange={(e) => set(side, e.target.value || null)}>
            <option value="">{t("stepRegion.any")}</option>
            {lobes.map((l) => {
              const areas = (cat.children.get(l.id) ?? []).filter((a) => a.kind === "area");
              return areas.length ? (
                <optgroup key={l.id} label={l.label}>
                  {areas.map((a) => (
                    <option key={a.id} value={a.id} disabled={!a.sublobe_id || !cat.byId.get(a.sublobe_id)?.setting}>
                      {areaLabel(a)}
                    </option>
                  ))}
                </optgroup>
              ) : null;
            })}
          </SelectField>
        )}
      </div>
      <div className="stepregion__summary">
        {!node ? (
          <>
            <p className="emb-field__hint">{t("stepRegion.sideOnly")}</p>
            {m.hemisphereNote && <p className="emb-field__hint">{localText(m.hemisphereNote[side], locale)}</p>}
          </>
        ) : (
          <>
            {node.kind === "lobe" && <p className="emb-field__hint">{t("stepRegion.eachSession", { list: options.map((o) => o.label).join(", ") })}</p>}
            <p className="emb-field__hint">{t("stepRegion.uses", { list: intl.formatList(uses, { type: "conjunction" }) })}</p>
            {crossed.length > 0 &&
              (crossed.length === options.length ? (
                <p className="emb-field__hint">{t("stepRegion.crossed", { h: side === "left" ? "right" : "left" })}</p>
              ) : (
                <p className="emb-field__hint">{t("stepRegion.crossedSome", { h: side === "left" ? "right" : "left", list: crossed.map((o) => o.label).join(", ") })}</p>
              ))}
            {settings.some((x) => x.clinical_status === "draft") && <p className="emb-field__hint">{t("stepRegion.draft")}</p>}
          </>
        )}
      </div>
    </fieldset>
  );
}
