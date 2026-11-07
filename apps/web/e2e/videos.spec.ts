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

test("Videos in sessions: the session plays the video step after the game and records it", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  await enrol(page, "ran@synthetic.test");
  const first = page.getByRole("region", { name: "Next up" }).getByRole("listitem").filter({ hasText: "Yoav Sela" });
  await expect(first.getByText("Tunnel Rush → ▶ Colour shapes")).toBeVisible();
  const child = (await first.locator(".nextup__name").textContent())!.trim();
  const given = child.split(" ")[0]!;
  await first.getByRole("link", { name: `Start session with ${child}` }).click();

  await expect(page.getByRole("listitem").filter({ hasText: "▶ Colour shapes" })).toBeVisible();
  await page.getByLabel("New PIN").fill("2468");
  await page.getByLabel("Repeat the PIN").fill("2468");
  await page.getByRole("button", { name: "Save PIN" }).click();
  await page.getByRole("button", { name: "Start", exact: true }).click();

  // The game first: skipped from the therapist controls.
  const game = page.frameLocator("iframe.gameframe");
  await expect(game.getByRole("button", { name: /Play|Let's go/ }).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Therapist controls" }).focus();
  await page.keyboard.press("Enter");
  const controls = page.getByRole("dialog", { name: "Therapist controls" });
  await controls.getByLabel("PIN").fill("2468");
  await controls.getByRole("button", { name: "Unlock" }).click();
  await controls.getByRole("button", { name: "Skip to the next game" }).click();

  await expect(page.getByRole("heading", { name: "Next: Colour shapes" })).toBeVisible();
  await page.getByRole("button", { name: "Start now" }).click();

  // The video: plays from the clinic's own server; Continue appears when it ends.
  await expect(page.getByRole("heading", { level: 1, name: "Colour shapes" })).toBeVisible();
  const video = page.locator("video.videostep__video");
  await expect(video).toHaveAttribute("src", /\/v1\/videos\/[0-9a-f-]+\/file\?v=2$/);
  await shot(page, "52-session-video");
  await axe(page, "video step");
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { level: 1, name: `Well done, ⁨${given}⁩!` })).toBeVisible();
  await page.getByRole("button", { name: "I'm the therapist" }).click();
  await page.getByLabel("PIN").fill("2468");
  await page.getByRole("button", { name: "Unlock" }).click();
  const watched = page.getByRole("region", { name: "Colour shapes" });
  await expect(watched.getByText("Watched to the end (0:10)")).toBeVisible();
  await expect(page.getByText("Saved", { exact: true })).toHaveCount(2);
  await page.getByRole("link", { name: `Back to ⁨${given}⁩` }).click();
  await expect(page.getByText(/1 of 4 sessions done/)).toBeVisible();
  await context.close();
});
