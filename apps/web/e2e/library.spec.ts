/**
 * Slice 2 end to end: the Library lists the games, and the preview runs the
 * real Catch Me If You Can in a sandboxed frame with the shared HUD.
 */
import { expect, test, type Page } from "@playwright/test";
import { axe, enrol, shot } from "./helpers.ts";

test.describe.configure({ mode: "serial" });

async function stopFromPauseMenu(page: Page) {
  const game = page.frameLocator("iframe.gameframe");
  await game.getByRole("button", { name: /Pause|השהיה/ }).click();
  const hold = game.locator("[data-quit]");
  await hold.hover();
  await page.mouse.down();
  await page.waitForTimeout(2300); // stopping needs a 2-second hold
  await page.mouse.up();
}

// The game renders continuously with software WebGL in CI, which is slow: allow more than the default 30 s.
test.describe.configure({ timeout: 150_000 });

test("the library lists games and previews Catch Me If You Can in both palettes", async ({ page }) => {
  await enrol(page, "gil@synthetic.test");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Library" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
  await axe(page, "library");
  await shot(page, "30-library");

  await page.getByRole("link", { name: /Catch Me If You Can/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Catch Me If You Can" })).toBeVisible();
  await axe(page, "game page");
  await shot(page, "31-game-page");

  // Warm palette, Lives mode, no practice.
  await page.getByRole("radio", { name: "Lives", exact: true }).check();
  await page.getByLabel("Start with practice").uncheck();
  await page.getByRole("button", { name: "Start preview" }).click();
  await expect(page.getByRole("navigation")).toHaveCount(0);

  const frame = page.locator("iframe.gameframe");
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  const game = page.frameLocator("iframe.gameframe");
  await expect(game.getByRole("heading", { name: "Catch Me If You Can" })).toBeVisible({ timeout: 15000 });
  await shot(page, "32-game-instructions");
  await game.getByRole("button", { name: "Play" }).click();
  await expect(game.locator(".hud-hearts .heart.full")).toHaveCount(3);
  await expect(game.locator(".hud-timer")).toBeHidden(); // Lives mode: no clock on screen
  await page.waitForTimeout(600);
  await shot(page, "33-game-warm");

  // Tap a tile on two boards in a row: the centre of the first quarter of the board.
  // Each tap draws a new board; a rendering error there used to freeze the game after the first one.
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const box = (await frame.boundingBox())!;
  for (let i = 0; i < 2; i++) {
    await page.mouse.click(box.x + box.width / 2 - 60, box.y + box.height / 2 - 40);
    await page.waitForTimeout(1500);
  }
  expect(errors).toEqual([]);

  await stopFromPauseMenu(page);
  await expect(game.getByRole("heading", { name: "Great effort!" })).toBeVisible();
  await expect(game.getByRole("img", { name: /of 3 stars/ })).toBeVisible();
  // The summary closes by itself after 10 s; on a slow machine it may already have gone.
  const finished = page.getByText("Preview finished. Nothing was saved.");
  await Promise.race([game.getByRole("button", { name: "Done" }).click().catch(() => {}), finished.waitFor()]);
  await expect(finished).toBeVisible();
  await expect(page.getByText("Stopped early")).toBeVisible();
  await axe(page, "preview finished");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Catch Me If You Can" })).toBeVisible();
});

test("cold palette, timed, in Hebrew: the clock waits for the first tap, and the bar sits top left", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await enrol(page, "shira@synthetic.test");
  await page.goto("/library/catch-me-if-you-can");
  await page.getByRole("radio", { name: "Cold, right hemisphere" }).check();
  await page.getByRole("radio", { name: "Timed", exact: true }).check();
  await page.getByLabel("Game language").selectOption("he");
  await page.getByLabel("Start with practice").uncheck();
  await page.getByRole("button", { name: "Start preview" }).click();

  const game = page.frameLocator("iframe.gameframe");
  await game.getByRole("button", { name: "משחקים!" }).click();
  const timer = game.locator(".hud-timer");
  await expect(timer).toHaveClass(/side-left/); // opposite the right hemisphere (ADR 0008)
  await expect(timer).toHaveClass(/t-bar/); // cold: an emptying bar, not a clock
  await expect(timer.locator(".time")).toHaveText("2:00");
  await page.waitForTimeout(1500);
  await expect(timer.locator(".time")).toHaveText("2:00"); // not started: no tap yet
  const box = (await page.locator("iframe.gameframe").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 - 60, box.y + box.height / 2 - 40);
  await expect(timer.locator(".time")).not.toHaveText("2:00", { timeout: 4000 });
  // The bar empties as time passes.
  await expect.poll(async () => timer.locator(".fill").evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a), { timeout: 4000 }).toBeLessThan(1);
  const tb = (await timer.boundingBox())!;
  expect(tb.x + tb.width).toBeLessThan(box.width / 2); // physical left, not mirrored in Hebrew
  await shot(page, "34-game-cold-he");
  await stopFromPauseMenu(page);
  await expect(game.getByRole("heading", { name: "כל הכבוד על המאמץ!" })).toBeVisible();
  await context.close();
});

test("Peek Peek: hearts per board by default, pictures to choose, and an open board first (ADR 0012)", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await enrol(page, "ofir@synthetic.test");
  await page.goto("/library/peek-peek");
  await expect(page.getByRole("heading", { level: 1, name: "Peek Peek" })).toBeVisible();
  await expect(page.getByLabel("Hearts")).toHaveValue("auto");
  await page.getByLabel("Pictures").selectOption("household");
  await page.getByLabel("Start with practice").uncheck();
  await page.getByRole("button", { name: "Start preview" }).click();

  const game = page.frameLocator("iframe.gameframe");
  await game.getByRole("button", { name: "Play" }).click();
  // The control trial: the board stays open and the child finds every copy of one picture.
  await expect(game.getByText("Find every copy of this picture.")).toBeVisible({ timeout: 20_000 });
  await expect(game.locator(".pp-pic img")).toBeVisible();
  const timer = game.locator(".hud-timer");
  await expect(timer).toHaveClass(/side-right/); // warm: clock top right (ADR 0008)
  await page.waitForTimeout(1200);
  await expect(timer.locator(".time")).toHaveText("2:00"); // the clock waits for the first tap after the first study phase
  await shot(page, "35-peek-peek-control");
  await stopFromPauseMenu(page);
  await expect(game.getByRole("heading", { name: "Great effort!" })).toBeVisible();
  await context.close();
});

test("Orbital Order: letters, night look, plain taps first and the clock waits for the probe (ADR 0013)", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await enrol(page, "lior@synthetic.test");
  await page.goto("/library/orbital-order");
  await expect(page.getByRole("heading", { level: 1, name: "Orbital Order" })).toBeVisible();
  await expect(page.getByLabel("Hearts")).not.toHaveValue("auto");
  await expect(page.getByRole("radio", { name: "Lives", exact: true })).toBeChecked(); // recommended mode
  await page.getByRole("radio", { name: "Timed + Lives", exact: true }).check();
  await page.getByLabel("Planets show").selectOption("letters");
  await page.getByLabel("Night sky look").check();
  await page.getByLabel("Start with practice").uncheck();
  await page.getByRole("button", { name: "Start preview" }).click();

  const game = page.frameLocator("iframe.gameframe");
  await game.getByRole("button", { name: "Play" }).click();
  // Motor baseline: one glowing planet to tap, unscored.
  await expect(game.getByText("Tap the glowing planet.")).toBeVisible({ timeout: 20_000 });
  const timer = game.locator(".hud-timer");
  await page.waitForTimeout(1200);
  await expect(timer.locator(".time")).toHaveText("2:00"); // the session clock starts on the first probe tap
  await shot(page, "36-orbital-order-motor");
  await stopFromPauseMenu(page);
  await expect(game.getByRole("heading", { name: "Great effort!" })).toBeVisible();
  await context.close();
});
