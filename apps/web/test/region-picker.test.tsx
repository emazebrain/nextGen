/** Video tagging and the library filter offer sub-lobes as well as Brodmann areas (brain-region filters spec 2026-11-09). */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { BrainRegion } from "@emb/contracts";
import { PrefsProvider } from "../src/i18n/index.tsx";
import { buildRegionTree, RegionFilter, RegionTagPicker } from "../src/routes/admin/RegionPicker.tsx";

const n = (id: string, kind: BrainRegion["kind"], path: string, parent: string | null, label: string, sort = 1, sublobe_id: string | null = null): BrainRegion => ({
  id, kind, path, code: path.split(".").pop()!, parent_id: parent, label, sort, sublobe_id, setting: null,
});
const REGIONS: BrainRegion[] = [
  n("h", "hemisphere", "left", null, "Left hemisphere"),
  n("t", "lobe", "left.temporal", "h", "Temporal lobe"),
  n("ba22", "area", "left.temporal.ba22", "t", "Brodmann area 22 (BA22)", 1, "st"),
  n("st", "sublobe", "left.temporal.superior_temporal", "t", "Superior temporal", 100),
];

describe("region pickers", () => {
  it("the tagging picker offers sub-lobes and Brodmann areas under a lobe", () => {
    render(
      <PrefsProvider initialLocale="en">
        <RegionTagPicker tree={buildRegionTree(REGIONS)} value={[]} onChange={() => {}} />
      </PrefsProvider>,
    );
    const lobe = screen.getByRole("group", { name: "Temporal lobe" });
    expect(within(lobe).getByRole("checkbox", { name: "Superior temporal" })).toBeTruthy();
    expect(within(lobe).getByRole("checkbox", { name: "Brodmann area 22 (BA22)" })).toBeTruthy();
  });

  it("the library filter offers sub-lobes in the area list", () => {
    render(
      <PrefsProvider initialLocale="en">
        <RegionFilter tree={buildRegionTree(REGIONS)} value={{ kind: "node", id: "t" }} onChange={() => {}} />
      </PrefsProvider>,
    );
    const area = screen.getByLabelText("Area") as HTMLSelectElement;
    const labels = [...area.options].map((o) => o.textContent);
    expect(labels).toEqual(["Any", "Superior temporal", "Brodmann area 22 (BA22)"]);
  });

  it("a sub-lobe chosen in the filter shows its hemisphere and lobe", () => {
    render(
      <PrefsProvider initialLocale="en">
        <RegionFilter tree={buildRegionTree(REGIONS)} value={{ kind: "node", id: "st" }} onChange={() => {}} />
      </PrefsProvider>,
    );
    expect((screen.getByLabelText("Lobe") as HTMLSelectElement).value).toBe("t");
    expect((screen.getByLabelText("Area") as HTMLSelectElement).value).toBe("st");
  });
});
