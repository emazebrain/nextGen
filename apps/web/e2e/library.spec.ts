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
  await expect.poll(async () => timer.locator(".fill").evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a), { timeout: 12_000 }).toBeLessThan(1); // generous: other game tests share the CPU
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

test("Orbital Order: practice hands over to the game, played through the hidden planet buttons", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await enrol(page, "adi@synthetic.test");
  await page.goto("/library/orbital-order");
  await page.getByRole("radio", { name: "Timed + Lives", exact: true }).check();
  await page.getByRole("button", { name: "Start preview" }).click(); // practice on (the default)

  const game = page.frameLocator("iframe.gameframe");
  await game.getByRole("button", { name: "Play" }).click();
  const planets = game.getByRole("group", { name: "Planets" }).getByRole("button");
  const names = () => planets.allTextContents();

  /** Reads the rule from the sign and taps the chain with the keyboard, like a switch or screen-reader user. */
  async function playChain() {
    await expect(planets.first()).toBeAttached({ timeout: 20_000 });
    const sign = (await game.locator(".oo-banner").textContent()) ?? "";
    const skip = ((await game.locator(".oo-banner .oo-sr").textContent()) ?? "").trim();
    const up = sign.includes("Smallest to biggest");
    const board = await names();
    const chain = board
      .filter((n) => n.slice(n.indexOf(", ") + 2) !== skip)
      .map((n) => Number(n.split(",")[0]))
      .sort((a, b) => (up ? a - b : b - a));
    expect(chain.length).toBeGreaterThan(1);
    for (const g of chain) {
      await planets.filter({ hasText: new RegExp(`^${g}, `) }).press("Enter");
      await page.waitForTimeout(140);
    }
    await expect.poll(async () => (await names()).join("|"), { timeout: 5000 }).not.toBe(board.join("|"));
  }

  for (let i = 0; i < 3; i++) await playChain(); // three practice boards
  // The handover that used to freeze: practice → the five plain taps.
  await expect(game.getByText("Tap the glowing planet.")).toBeVisible({ timeout: 10_000 });
  const timer = game.locator(".hud-timer .time");
  for (let i = 0; i < 5; i++) {
    await planets.filter({ hasText: /glowing$/ }).press("Enter");
    await page.waitForTimeout(600);
  }
  await expect(game.getByText("Great tapping! Now follow the rule.")).toBeVisible();
  await expect(timer).toHaveText("2:00"); // still waiting: the clock starts on the first probe tap
  await playChain();
  await expect(timer).not.toHaveText("2:00", { timeout: 4000 });
  await shot(page, "37-orbital-order-probe");
  await stopFromPauseMenu(page);
  await expect(game.getByRole("heading", { name: "Great effort!" })).toBeVisible();
  await context.close();
});

test("Tunnel Rush: practice run, then the clock waits for the first steer; steering buttons stay physical in Hebrew (ADR 0014)", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await enrol(page, "omer@synthetic.test");
  await page.goto("/library/tunnel-rush");
  await expect(page.getByRole("heading", { level: 1, name: "Tunnel Rush" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Timed", exact: true })).toBeChecked(); // recommended mode
  await page.getByLabel("Objects").selectOption("cartoon_faces");
  await page.getByLabel("Language").selectOption("he");
  await page.getByRole("button", { name: "Start preview" }).click(); // practice on (the default)

  const game = page.frameLocator("iframe.gameframe");
  await game.getByRole("button", { name: "משחקים!" }).click();
  // Practice: 20 s at difficulty 1, then the runtime's "practice done" and the real run.
  const left = game.getByRole("button", { name: "היגוי שמאלה" });
  const right = game.getByRole("button", { name: "היגוי ימינה" });
  await expect(left).toBeVisible({ timeout: 20_000 });
  const lb = (await left.boundingBox())!;
  const rb = (await right.boundingBox())!;
  expect(lb.x).toBeLessThan(rb.x); // physical left and right, not mirrored in Hebrew
  await right.click();
  await expect(game.getByText("החליקו או הקישו על חץ כדי להתחיל!")).toBeVisible({ timeout: 30_000 });
  const timer = game.locator(".hud-timer .time");
  await page.waitForTimeout(1200);
  await expect(timer).toHaveText("2:00"); // the clock waits for the first steer
  await shot(page, "38-tunnel-rush-ready");
  await right.press("Enter");
  await expect(timer).not.toHaveText("2:00", { timeout: 4000 });
  await stopFromPauseMenu(page);
  await expect(game.getByRole("heading", { name: "כל הכבוד על המאמץ!" })).toBeVisible();
  await context.close();
});

test("Beep Beep: practice with guide arrows, then a board played with the keyboard; the exit follows the hemisphere (ADR 0015)", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await enrol(page, "rina@synthetic.test");
  await page.goto("/library/beep-beep");
  await expect(page.getByRole("heading", { level: 1, name: "Beep Beep" })).toBeVisible();
  await page.getByRole("radio", { name: "Cold, right hemisphere" }).check();
  await page.getByRole("button", { name: "Start preview" }).click(); // practice on (the default)

  const game = page.frameLocator("iframe.gameframe");
  await game.getByRole("button", { name: "Play" }).click();
  await expect(game.getByText("Follow the arrows to free the hero.")).toBeVisible({ timeout: 20_000 });
  const vehicles = game.getByRole("group", { name: "Vehicles" }).getByRole("button");
  await expect(vehicles.first()).toHaveText(/^Blue tugboat, goes left and right/); // cold look
  await expect(game.getByRole("button", { name: "Undo" })).toBeDisabled();
  await shot(page, "39-beep-beep-practice");
  // The practice board can be finished by asking for the next move each time: H is the hint key, and the fourth
  // hint step makes the move. (Keys, not clicks: clicks wait for animation frames, which are slow in CI.)
  await vehicles.first().focus();
  for (let i = 0; i < 40; i++) {
    if (await game.getByText(/^Level \d+$/).count()) break;
    await page.keyboard.press("h");
    await page.waitForTimeout(150);
  }
  await expect(game.getByText(/^Level \d+$/)).toBeVisible({ timeout: 15_000 });
  const timer = game.locator(".hud-timer .time");
  const before = await timer.textContent();
  await page.waitForTimeout(1200);
  await expect(timer).toHaveText(before!); // the clock waits for the first move
  // A first move with the keyboard: focus a vehicle and slide it.
  let moved = false;
  for (let i = 0; i < 12 && !moved; i++) {
    await vehicles.nth(i % (await vehicles.count())).focus();
    for (const k of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
      await page.keyboard.press(k);
      if (/^[1-9]/.test((await game.locator("[data-moves]").textContent()) ?? "")) {
        moved = true;
        break;
      }
    }
  }
  expect(moved).toBe(true);
  await expect(timer).not.toHaveText(before!, { timeout: 4000 });
  await stopFromPauseMenu(page);
  await expect(game.getByRole("heading", { name: "Great effort!" })).toBeVisible();
  await context.close();
});
