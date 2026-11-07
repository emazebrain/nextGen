/** The video library (ADR 0018): a platform admin adds and tags videos; therapists use them in protocols and sessions. */
import { expect, test } from "@playwright/test";
import { axe, enrol, shot } from "./helpers.ts";

test("Videos admin: a platform admin adds a YouTube video and tags it with Brodmann areas", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await enrol(page, "admin@synthetic.test");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Videos" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Videos" })).toBeVisible();
  await page.getByRole("button", { name: "Add video" }).click();

  await page.getByRole("radio", { name: "YouTube", exact: true }).check();
  await page.getByLabel("YouTube link").fill("https://vimeo.com/1");
  await expect(page.getByText("That isn't a YouTube link")).toBeVisible();
  await page.getByLabel("YouTube link").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await page.getByLabel("Title in English").fill("Balloon breathing");
  await page.getByLabel("Title in Hebrew").fill("נשימת בלון");
  const regions = page.getByRole("group", { name: "Brain regions" });
  await regions.getByRole("tab", { name: "Left hemisphere" }).click();
  await regions.getByRole("checkbox", { name: "Brodmann area 44 (BA44)" }).check();
  await regions.getByRole("checkbox", { name: "Brodmann area 46 (BA46)" }).check();
  await page.getByRole("radio", { name: "Published" }).check();
  await axe(page, "video editor");
  await shot(page, "50-video-editor");
  await page.getByRole("button", { name: "Save video" }).click();

  const row = page.getByRole("row", { name: /Balloon breathing/ });
  await expect(row).toBeVisible();
  await expect(row.getByText("Needs Internet")).toBeVisible();
  await expect(row.getByText("Left · BA44")).toBeVisible();
  await expect(row.getByText("Published")).toBeVisible();
  await axe(page, "video list");
  await context.close();
});

test("Videos admin: therapists don't see the Videos admin page", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await enrol(page, "noga@synthetic.test");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Videos" })).toHaveCount(0);
  await page.goto("/admin/videos");
  await expect(page.getByRole("heading", { name: "Only platform admins can manage videos" })).toBeVisible();
  await context.close();
});

test("Videos in protocols: a therapist filters videos by Brodmann area and adds one between two games", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await enrol(page, "sapir@synthetic.test");
  await page.goto("/protocols/new");
  await page.getByLabel("Name").fill("Games with a break");
  await page.getByRole("button", { name: "Add a game" }).click();
  await page.getByRole("button", { name: /Tunnel Rush/ }).click();

  await page.getByRole("button", { name: "Add a video" }).click();
  const picker = page.getByRole("group", { name: "Choose a video" });
  await expect(picker.getByRole("button", { name: /Spiral zoom/ })).toBeVisible();
  await picker.getByLabel("Hemisphere").selectOption({ label: "Left hemisphere" });
  await picker.getByLabel("Lobe").selectOption({ label: "Frontal lobe" });
  await picker.getByLabel("Area").selectOption({ label: "Brodmann area 44 (BA44)" });
  await expect(picker.getByRole("button", { name: /Colour shapes/ })).toBeVisible();
  await expect(picker.getByRole("button", { name: /Spiral zoom/ })).toHaveCount(0);
  await picker.getByLabel("Area").selectOption({ label: "Brodmann area 4 (BA4)" });
  await expect(picker.getByText("No videos match these filters.")).toBeVisible();
  await picker.getByLabel("Area").selectOption({ label: "Any" });
  await picker.getByLabel("Search videos").fill("colour");
  await axe(page, "video picker");
  await shot(page, "51-video-picker");
  await picker.getByRole("button", { name: /Colour shapes/ }).click();

  await page.getByRole("button", { name: "Add a game" }).click();
  await page.getByRole("button", { name: /Block Crasher/ }).click();
  const steps = page.locator(".step");
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(1)).toContainText("Colour shapes");
  await expect(steps.nth(1)).toContainText("Video · 0:10");
  await expect(page.getByRole("button", { name: "Edit Step 2" })).toHaveCount(0); // nothing to set on a video
  await page.getByRole("button", { name: "Save template" }).click();
  await expect(page.getByText("Template saved.")).toBeVisible();
  await expect(page.getByRole("region", { name: "My templates" }).getByText("Tunnel Rush → ▶ Colour shapes → Block Crasher")).toBeVisible();
  await context.close();
});
