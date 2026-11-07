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
  await enrol(page, "sapir@synthetic.test");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Videos" })).toHaveCount(0);
  await page.goto("/admin/videos");
  await expect(page.getByRole("heading", { name: "Only platform admins can manage videos" })).toBeVisible();
  await context.close();
});
