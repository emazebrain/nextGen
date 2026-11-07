/**
 * Brain regions (design doc §7: hemisphere → lobe → Brodmann area). "tag" mode: tick the areas a video works on,
 * one tab per hemisphere. "filter" mode: pick one hemisphere, lobe or area to narrow a list. Real tabs, fieldsets
 * and checkboxes, so it works with a keyboard and a screen reader.
 */
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { SelectField } from "@emb/ui";
import type { BrainRegion, RegionRef } from "@emb/contracts";
import { useT, type MessageId } from "../../i18n/index.tsx";

export interface RegionTree {
  hemispheres: BrainRegion[];
  lobesOf: (hemisphereId: string) => BrainRegion[];
  areasOf: (lobeId: string) => BrainRegion[];
  byId: Map<string, BrainRegion>;
}

export function useRegionTree(regions: BrainRegion[] | undefined): RegionTree {
  return useMemo(() => {
    const list = regions ?? [];
    const children = new Map<string, BrainRegion[]>();
    for (const r of list) if (r.parent_id) children.set(r.parent_id, [...(children.get(r.parent_id) ?? []), r]);
    for (const kids of children.values()) kids.sort((a, b) => a.sort - b.sort);
    return {
      hemispheres: list.filter((r) => r.kind === "hemisphere").sort((a, b) => a.sort - b.sort),
      lobesOf: (id) => children.get(id) ?? [],
      areasOf: (id) => children.get(id) ?? [],
      byId: new Map(list.map((r) => [r.id, r])),
    };
  }, [regions]);
}

/** "Left · BA44", "Right · Cerebellum", "Left · Frontal lobe" — short enough for a chip. */
export function useRegionChip() {
  const t = useT();
  return (r: RegionRef, tree: RegionTree) => {
    const side = t(r.path.startsWith("left") ? "regions.short.left" : "regions.short.right");
    if (r.kind === "hemisphere") return side;
    const label = r.kind === "area" && r.code.startsWith("ba") ? r.code.toUpperCase() : (tree.byId.get(r.id)?.label ?? r.code);
    return `${side} · ${label}`;
  };
}

export function RegionTagPicker({ tree, value, onChange }: { tree: RegionTree; value: string[]; onChange: (ids: string[]) => void }) {
  const t = useT();
  const base = useId();
  const [active, setActive] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const chosen = new Set(value);
  const toggle = (id: string, on: boolean) => onChange(on ? [...value, id] : value.filter((v) => v !== id));
  const onKey = (e: KeyboardEvent) => {
    const n = tree.hemispheres.length;
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    const step = e.key === "ArrowRight" ? (rtl ? -1 : 1) : e.key === "ArrowLeft" ? (rtl ? 1 : -1) : 0;
    if (!step) return;
    e.preventDefault();
    const next = (active + step + n) % n;
    setActive(next);
    tabs.current[next]?.focus();
  };
  const count = (hemiId: string) => tree.lobesOf(hemiId).reduce((sum, l) => sum + tree.areasOf(l.id).filter((a) => chosen.has(a.id)).length, 0);
  return (
    <div role="group" aria-labelledby={`${base}-label`} className="region-picker">
      <p id={`${base}-label`} className="emb-field__label">
        {t("regions.label")}
      </p>
      <div role="tablist" aria-label={t("regions.hemisphere")} className="region-picker__tabs" onKeyDown={onKey}>
        {tree.hemispheres.map((h, i) => (
          <button
            key={h.id}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${i}`}
            aria-selected={i === active}
            aria-controls={`${base}-panel-${i}`}
            tabIndex={i === active ? 0 : -1}
            className="region-picker__tab"
            onClick={() => setActive(i)}
          >
            {h.label}
            {count(h.id) > 0 && <span className="region-picker__count">{t("regions.selected", { count: count(h.id) })}</span>}
          </button>
        ))}
      </div>
      {tree.hemispheres.map((h, i) => (
        <div key={h.id} role="tabpanel" id={`${base}-panel-${i}`} aria-labelledby={`${base}-tab-${i}`} hidden={i !== active} className="region-picker__panel">
          {tree.lobesOf(h.id).map((lobe) => (
            <fieldset key={lobe.id} className="region-picker__lobe">
              <legend>{lobe.label}</legend>
              <div className="region-picker__areas">
                {tree.areasOf(lobe.id).map((a) => (
                  <label key={a.id} className="region-picker__area">
                    <input type="checkbox" checked={chosen.has(a.id)} onChange={(e) => toggle(a.id, e.target.checked)} />
                    <span>{a.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Narrow a list to one hemisphere, lobe or area. Returns the id of the most specific choice (or null). */
export function RegionFilter({ tree, value, onChange }: { tree: RegionTree; value: string | null; onChange: (id: string | null) => void }) {
  const t = useT();
  const node = value ? tree.byId.get(value) : undefined;
  const hemi = node ? (node.kind === "hemisphere" ? node : tree.byId.get(node.kind === "lobe" ? node.parent_id! : tree.byId.get(node.parent_id!)!.parent_id!)) : undefined;
  const lobe = node?.kind === "lobe" ? node : node?.kind === "area" ? tree.byId.get(node.parent_id!) : undefined;
  const area = node?.kind === "area" ? node : undefined;
  const any = t("regions.any" as MessageId);
  return (
    <div className="region-filter">
      <SelectField label={t("regions.hemisphere")} value={hemi?.id ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{any}</option>
        {tree.hemispheres.map((h) => (
          <option key={h.id} value={h.id}>
            {h.label}
          </option>
        ))}
      </SelectField>
      <SelectField label={t("regions.lobe")} value={lobe?.id ?? ""} disabled={!hemi} onChange={(e) => onChange(e.target.value || hemi?.id || null)}>
        <option value="">{any}</option>
        {hemi &&
          tree.lobesOf(hemi.id).map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
      </SelectField>
      <SelectField label={t("regions.area")} value={area?.id ?? ""} disabled={!lobe} onChange={(e) => onChange(e.target.value || lobe?.id || null)}>
        <option value="">{any}</option>
        {lobe &&
          tree.areasOf(lobe.id).map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
      </SelectField>
    </div>
  );
}
