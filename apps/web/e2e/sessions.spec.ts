/**
 * Slice 4 end to end (journey T2): start a session from Today, set the
 * device's kid-mode PIN, hand over, play, use the PIN-protected therapist
 * controls to skip and to end, and see the saved results in the summary.
 */
import { expect, test } from "@playwright/test";
import { axe, enrol, shot } from "./helpers.ts";

test("Noam runs a session: hand-off, two games, therapist controls, saved results", async ({ page }) => {
  test.setTimeout(120_000);
  await enrol(page, "noam@synthetic.test");

  const first = page.getByRole("region", { name: "Next up" }).getByRole("listitem").first();
  const child = (await first.locator(".nextup__name").textContent())!.trim();
  const given = child.split(" ")[0]!;
  await first.getByRole("link", { name: `Start session with ${child}` }).click();

  // Hand-off: this device has no kid-mode PIN yet.
  await expect(page.getByRole("heading", { level: 1, name: `Ready for \u2068${given}\u2069` })).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await page.getByLabel("New PIN").fill("2468");
  await page.getByLabel("Repeat the PIN").fill("1357");
  await page.getByRole("button", { name: "Save PIN" }).click();
  await expect(page.getByText("The two PINs don't match.")).toBeVisible();
  await page.getByLabel("Repeat the PIN").fill("2468");
  await page.getByRole("button", { name: "Save PIN" }).click();
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await axe(page, "session hand-off");
  await shot(page, "50-session-handoff");
  await page.getByRole("button", { name: "Start", exact: true }).click();

  // Game 1. Therapist controls by keyboard: a wrong PIN, then the right one, then skip.
  const game = page.frameLocator("iframe.gameframe");
  await expect(game.getByRole("button", { name: /Play|משחקים|Let's go/ }).first()).toBeVisible({ timeout: 20_000 });
  // Game 1 trains the left hemisphere: a warm digital clock, top right. (ADR 0008)
  await expect(game.locator(".hud-timer")).toHaveClass(/t-digital/);
  await expect(game.locator(".hud-timer")).toHaveClass(/side-right/);
  await shot(page, "51-session-game1");
  await page.getByRole("button", { name: "Therapist controls" }).focus();
  await page.keyboard.press("Enter");
  const controls = page.getByRole("dialog", { name: "Therapist controls" });
  await controls.getByLabel("PIN").fill("0000");
  await controls.getByRole("button", { name: "Unlock" }).click();
  await expect(controls.getByText("That's not the PIN. 4 tries left.")).toBeVisible();
  await controls.getByLabel("PIN").fill("2468");
  await controls.getByRole("button", { name: "Unlock" }).click();
  await axe(page, "therapist controls");
  await shot(page, "52-session-controls");
  await controls.getByRole("button", { name: "Skip to the next game" }).click();

  // Between games: a short countdown, or start right away.
  await expect(page.getByText("Game 2 of 2")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Next: Catch Me If You Can" })).toBeVisible();
  await shot(page, "53-session-between");
  await page.getByRole("button", { name: "Start now" }).click();

  // Game 2. Long press on the corner (a tap does nothing), then end the session.
  await expect(game.getByRole("button", { name: /Play|משחקים|Let's go/ }).first()).toBeVisible({ timeout: 20_000 });
  // Game 2 trains the right hemisphere: a cold emptying bar, top left.
  await expect(game.locator(".hud-timer")).toHaveClass(/t-bar/);
  await expect(game.locator(".hud-timer")).toHaveClass(/side-left/);
  await shot(page, "53b-session-game2");
  const corner = page.getByRole("button", { name: "Therapist controls" });
  await corner.click();
  await expect(controls).toHaveCount(0);
  await corner.hover();
  await page.mouse.down();
  await page.waitForTimeout(1800);
  await page.mouse.up();
  await controls.getByLabel("PIN").fill("2468");
  await controls.getByRole("button", { name: "Unlock" }).click();
  await controls.getByRole("button", { name: "End the session" }).click();

  // The child's screen, then the therapist's summary behind the PIN.
  await expect(page.getByRole("heading", { level: 1, name: `Well done, \u2068${given}\u2069!` })).toBeVisible();
  await page.getByRole("button", { name: "I'm the therapist" }).click();
  await page.getByLabel("PIN").fill("2468");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `\u2068${child}\u2069: session results` })).toBeVisible();
  await expect(page.getByText("Saved", { exact: true })).toHaveCount(2);
  await expect(page.getByText("Stopped early, so it doesn't count toward changing difficulty.")).toHaveCount(2);
  await axe(page, "session summary");
  await shot(page, "54-session-summary");

  // Both games have a result, so session 1 is done; the patient's card offers session 2.
  await page.getByRole("link", { name: `Back to \u2068${given}\u2069` }).click();
  await expect(page.getByText(/1 of 8 sessions done/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Start session 2" })).toBeVisible();
});
