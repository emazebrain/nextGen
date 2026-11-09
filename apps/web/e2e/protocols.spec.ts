/**
 * Slice 3 end to end (journey T2): Today shows planned sessions; a therapist
 * copies a library template, adjusts it in the builder, and assigns it to a
 * patient, which puts the patient on Today.
 */
import { expect, test } from "@playwright/test";
import { axe, enrol, shot } from "./helpers.ts";

test.describe.configure({ mode: "serial" });

test("Tal builds a template from the library and assigns it", async ({ page }) => {
  await enrol(page, "tal@synthetic.test");

  // Today: protocols already running for four patients; one session is from two days ago.
  const nextUp = page.getByRole("region", { name: "Next up" });
  await expect(nextUp.getByRole("listitem")).toHaveCount(4);
  await expect(nextUp.getByText("Week 1 · Session 1 of 8").first()).toBeVisible();
  await expect(nextUp.getByText(/^Planned for/)).toHaveCount(1);
  await axe(page, "today with sessions");
  await shot(page, "40-today-next-up");

  // Library templates → duplicate → adjust.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Protocols" }).click();
  const platform = page.getByRole("region", { name: "eMazeBrain templates" });
  await expect(platform.getByRole("listitem")).toHaveCount(2);
  await axe(page, "protocols");
  await platform.getByRole("link", { name: "Duplicate: Visual attention starter" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "New template" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Visual attention starter (copy)");
  await page.getByLabel("Name").fill("Attention, both sides");

  await page.getByRole("button", { name: "Edit Step 1" }).click();
  // The timer corner and look follow the hemisphere, opposite side (ADR 0008).
  await expect(page.getByText(/Top right corner: a warm digital clock/)).toBeVisible();
  await expect(page.getByText("From stage 2, the larger grid appears on the right of the screen and the smaller grid on the left.")).toBeVisible();
  await page.getByLabel("Side").selectOption({ label: "Right hemisphere" });
  await expect(page.getByText(/Top left corner: a cold bar that empties/)).toBeVisible();
  await expect(page.getByText("From stage 2, the larger grid appears on the left of the screen and the smaller grid on the right.")).toBeVisible();
  await page.getByRole("radio", { name: "Hide" }).check();
  await expect(page.getByText("The child won't see the time. The session still ends when time is up.")).toBeVisible();
  await page.getByRole("radio", { name: "Show" }).check();
  await page.getByLabel("Side").selectOption({ label: "Left hemisphere" });
  await shot(page, "41a-builder-timer");
  // Black and white, and the background settings (ADR 0009). Movement only shows for a textured background.
  await expect(page.getByLabel("Black and white")).not.toBeChecked();
  await expect(page.getByLabel("Moving background")).toHaveCount(0);
  await page.getByRole("radio", { name: "Textured" }).check();
  await expect(page.getByLabel("Moving background")).toBeVisible();
  await expect(page.getByLabel("Background colours")).toHaveValue("auto");
  await page.getByRole("radio", { name: "Solid" }).check();
  await expect(page.getByLabel("Moving background")).toHaveCount(0);
  await page.getByRole("radio", { name: "Lives", exact: true }).check();
  await expect(page.getByLabel("Time limit")).toHaveCount(0); // Lives mode: no time limit
  await page.getByLabel("Hearts").selectOption("5");
  await expect(page.getByText(/If accuracy is at least 80% for 2 sessions in a row/)).toBeVisible();
  await page.getByRole("combobox", { name: "Raise difficulty when accuracy is at least" }).selectOption({ label: "90%" });
  await expect(page.getByText(/If accuracy is at least 90%/)).toBeVisible();
  await axe(page, "builder with step editor");
  await shot(page, "41-builder-step-editor");
  await page.getByRole("button", { name: "Done Step 1" }).click();

  await page.getByRole("button", { name: "Move step 2 up" }).click();
  await expect(page.locator(".step").first()).toContainText("Cold, right");
  await page.getByRole("button", { name: "Add a game" }).click();
  await page.getByRole("button", { name: /Catch Me If You Can/ }).click();
  await expect(page.locator(".step")).toHaveCount(3);
  await page.getByRole("button", { name: "Remove step 3" }).click();
  await expect(page.locator(".step")).toHaveCount(2);
  await page.getByRole("button", { name: "Save template" }).click();
  await expect(page.getByText("Template saved.")).toBeVisible();
  await expect(page.getByRole("region", { name: "My templates" }).getByText("Attention, both sides")).toBeVisible();

  // Assign it to a patient who has no protocol yet.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Patients" }).click();
  const rows = page.getByRole("table", { name: "Patients on your caseload" }).getByRole("link");
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  let assigned = false;
  for (let i = 0; i < count && !assigned; i++) {
    await rows.nth(i).click();
    await expect(page.getByText(/sessions done|Assign a protocol/).first()).toBeVisible();
    if (await page.getByRole("link", { name: "Assign a protocol" }).isVisible()) {
      assigned = true;
      break;
    }
    await page.goBack();
  }
  expect(assigned).toBe(true);
  const name = (await page.getByRole("heading", { level: 1 }).textContent())!.trim();
  await page.getByRole("link", { name: "Assign a protocol" }).click();
  await page.getByRole("button", { name: "Use this template: Attention, both sides" }).click();
  await expect(page.getByText(/Changes here apply to .* only/)).toBeVisible();
  await axe(page, "assign review");
  await shot(page, "42-assign-review");
  await page.getByRole("button", { name: /^Assign to / }).click();

  await expect(page.getByText(/Protocol assigned\. First session/)).toBeVisible();
  const card = page.getByRole("region", { name: "Attention, both sides" });
  await expect(card.getByText("Week 1 of 4 · 0 of 8 sessions done")).toBeVisible();
  await card.getByRole("button", { name: "Pause" }).click();
  await expect(card.getByText("Paused")).toBeVisible();
  await card.getByRole("button", { name: "Resume" }).click();
  await expect(card.getByText("Paused")).toHaveCount(0);
  await shot(page, "43-patient-protocol");

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Today" }).click();
  await expect(page.getByRole("region", { name: "Next up" }).getByRole("listitem")).toHaveCount(5);
  await expect(page.getByRole("region", { name: "Next up" }).getByText(name)).toBeVisible();
});

test("Hila filters a step to a brain region; the table's row decides its look", async ({ page }) => {
  await enrol(page, "hila@synthetic.test");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Protocols" }).click();
  await page.getByRole("region", { name: "eMazeBrain templates" }).getByRole("link", { name: "Duplicate: Visual attention starter" }).click();
  await page.getByLabel("Name").fill("Superior temporal, right");
  await page.getByRole("button", { name: "Edit Step 1" }).click();

  const region = page.getByRole("group", { name: "Brain region" });
  await region.getByLabel("Side").selectOption({ label: "Right hemisphere" });
  await region.getByLabel("Lobe", { exact: true }).selectOption({ label: "Temporal lobe" });
  await expect(region.getByText("Each session uses one of: Superior temporal, Middle temporal, Inferior temporal")).toBeVisible();
  await region.getByLabel("Sub-lobe").selectOption({ label: "Superior temporal" });
  await expect(region.getByText(/This game uses: the right hemisphere's look and background: cold, solid/)).toBeVisible();
  await expect(region.getByText("Draft settings, pending clinical review")).toBeVisible();
  // The row sets Catch Me's background, so its own background controls are not editable.
  await expect(page.getByRole("group", { name: "Game settings" }).getByText("Set by the brain region").first()).toBeVisible();
  await axe(page, "builder with brain region");
  await shot(page, "41b-builder-brain-region");

  // Left cerebellum is crossed in the table: it runs with the right hemisphere's look.
  await region.getByLabel("Side").selectOption({ label: "Left hemisphere" });
  await region.getByLabel("Lobe", { exact: true }).selectOption({ label: "Subcortical" });
  await region.getByLabel("Sub-lobe").selectOption({ label: "Cerebellum" });
  await expect(region.getByText(/Runs with the right hemisphere's look and placement/)).toBeVisible();
  await region.getByLabel("Side").selectOption({ label: "Right hemisphere" });
  await region.getByLabel("Lobe", { exact: true }).selectOption({ label: "Temporal lobe" });
  await region.getByLabel("Sub-lobe").selectOption({ label: "Superior temporal" });
  await page.getByRole("button", { name: "Done Step 1" }).click();
  await expect(page.locator(".step").first()).toContainText("Region: Right · Superior temporal");

  const saved = page.waitForResponse((r) => r.url().includes("/v1/templates") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Save template" }).click();
  const body = await (await saved).json();
  expect(body.template.steps[0]).toMatchObject({ hemisphere: "right", region_id: expect.any(String) });
  await expect(page.getByText("Template saved.")).toBeVisible();
});
