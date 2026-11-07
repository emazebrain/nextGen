/**
 * Offline therapist devices, end to end (offline devices spec; ADR 0019). One browser context is one tablet;
 * context.setOffline() pulls the network cable. Synthetic accounts and patients from the seed only.
 */
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { axe, enrol, PASSWORD, shot } from "./helpers.ts";
import { totp } from "./totp.ts";

const PIN = "2468";

/** A second sign-in on the same tablet: a fresh code (codes are single-use; enrolment used its own step). */
async function signInAgain(page: Page, email: string, enrolled: { secret: string; at: number }) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Enter your code" })).toBeVisible();
  const at = Math.max(Date.now(), enrolled.at + 30_000);
  const wait = at - Date.now();
  if (wait > 0) await page.waitForTimeout(wait);
  await page.getByLabel("Authentication code").fill(totp(enrolled.secret, at)); // six digits submit by themselves
  await expect(page).toHaveURL(/\/today$/);
}

async function setUpOffline(page: Page, password: string, next = "/today") {
  await page.goto(`/setup-offline?next=${encodeURIComponent(next)}`);
  await expect(page.getByRole("heading", { level: 1, name: "Set up offline use" })).toBeVisible();
  await page.getByLabel("Offline password", { exact: true }).fill(password);
  await page.getByLabel("Repeat the password").fill(password);
  await page.getByRole("button", { name: "Set up offline use" }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/\//g, "\\/")}$`));
}

/** Fetch this therapist's offline data now and wait until it's stored on the device. */
async function updateNow(page: Page) {
  await page.goto("/settings/device");
  const button = page.getByRole("button", { name: "Update now" });
  await expect(button).toBeEnabled();
  await button.click();
  // Every therapist space on this device holds a saved bundle (record names are visible; their contents are encrypted).
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const names = (await indexedDB.databases()).map((d) => d.name ?? "").filter((n) => n.startsWith("emb.space."));
          if (!names.length) return false;
          for (const name of names) {
            const db: IDBDatabase = await new Promise((res, rej) => {
              const r = indexedDB.open(name);
              r.onsuccess = () => res(r.result);
              r.onerror = () => rej(r.error);
            });
            const keys: IDBValidKey[] = db.objectStoreNames.contains("records")
              ? await new Promise((res) => {
                  const r = db.transaction("records").objectStore("records").getAllKeys();
                  r.onsuccess = () => res(r.result);
                })
              : [];
            db.close();
            if (!keys.includes("bundle")) return false;
          }
          return true;
        }),
      { timeout: 30_000 },
    )
    .toBe(true);
}

/** Keep the session videos on this device and wait for the one this protocol uses. */
async function downloadVideos(page: Page) {
  await page.getByRole("radio", { name: /Play from this device/ }).check();
  await page.getByRole("button", { name: "Update now" }).click();
  await expect(page.getByText(/^1 video · /)).toBeVisible({ timeout: 30_000 });
}

/** The service worker controls the page and has the app cached: safe to pull the cable. */
async function readyForOffline(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

async function goOfflineAndUnlock(context: BrowserContext, page: Page, who: RegExp | null, password: string) {
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "No connection" })).toBeVisible();
  if (who) await page.getByRole("radio", { name: who }).check();
  await page.getByLabel("Offline password").fill(password);
  await page.getByRole("button", { name: "Unlock" }).click();
}

/** Start the child's session from Today, skip the game from the therapist controls, watch the video. */
async function playSession(page: Page, child: string) {
  const row = page.getByRole("region", { name: "Next up" }).getByRole("listitem").filter({ hasText: child });
  await expect(row.getByText("Tunnel Rush → ▶ Colour shapes")).toBeVisible();
  await row.getByRole("link", { name: new RegExp(`Start session with .*${child}`) }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "▶ Colour shapes" })).toBeVisible();
  const start = page.getByRole("button", { name: "Start", exact: true });
  await expect(page.getByLabel("New PIN").or(start)).toBeVisible();
  if (await page.getByLabel("New PIN").isVisible()) {
    await page.getByLabel("New PIN").fill(PIN);
    await page.getByLabel("Repeat the PIN").fill(PIN);
    await page.getByRole("button", { name: "Save PIN" }).click();
  }
  await start.click();
  const game = page.frameLocator("iframe.gameframe");
  const play = game.getByRole("button", { name: /Play|Let's go/ }).first();
  await expect(play).toBeVisible({ timeout: 20_000 });
  await expect(play).toBeFocused();
  // The game may take keyboard focus back while it settles: open the controls until the dialog is really there.
  const controls = page.getByRole("dialog", { name: "Therapist controls" });
  await expect(async () => {
    await page.getByRole("button", { name: "Therapist controls" }).focus();
    await page.keyboard.press("Enter");
    await expect(controls).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15_000 });
  await controls.getByLabel("PIN").fill(PIN);
  await controls.getByRole("button", { name: "Unlock" }).click();
  await controls.getByRole("button", { name: "Skip to the next game" }).click();
  await expect(page.getByRole("heading", { name: "Next: Colour shapes" })).toBeVisible();
  await page.getByRole("button", { name: "Start now" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Colour shapes" })).toBeVisible();
  await expect(page.locator("video.videostep__video")).toHaveAttribute("src", /\/v1\/videos\/[0-9a-f-]+\/file\?v=2$/);
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible({ timeout: 25_000 });
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Well done/ })).toBeVisible();
}

const patientId = async (page: Page, child: string) => {
  const href = await page.getByRole("region", { name: "Next up" }).getByRole("link", { name: new RegExp(child) }).first().getAttribute("href");
  return href!.split("/").pop()!;
};

test("a therapist sets up offline use, goes offline, unlocks with her password and runs a session that uploads once online", async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  await enrol(page, "tamar@synthetic.test");
  await setUpOffline(page, "tamar-tablet-1", "/settings/device");
  await axe(page, "device page");
  await downloadVideos(page);
  await shot(page, "61-device-page");
  await page.getByRole("link", { name: "Today" }).first().click();
  const lia = await patientId(page, "Lia Mor");
  await readyForOffline(page);

  await goOfflineAndUnlock(context, page, null, "tamar-tablet-1");
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole("status").filter({ hasText: /Showing saved data from/ })).toBeVisible();
  await playSession(page, "Lia Mor");
  await page.getByRole("button", { name: "I'm the therapist" }).click();
  await page.getByLabel("PIN").fill(PIN);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("region", { name: "Colour shapes" }).getByText("Watched to the end (0:10)")).toBeVisible();
  // In-app navigation keeps the space open (a full reload would ask for the password again).
  await page.getByRole("link", { name: /Back to/ }).click();
  await page.getByRole("link", { name: "Today" }).first().click();
  await expect(page.getByText("Will send 2 results")).toBeVisible();
  // Today has moved on: Lia's next session is not before today, so she isn't "next up" again.
  await expect(page.getByRole("region", { name: "Next up" }).getByText("Lia Mor")).toHaveCount(0);

  // Back online: the waiting results go out once, and the server has the session.
  await context.setOffline(false);
  await expect(page.getByText("Will send 2 results")).toHaveCount(0, { timeout: 30_000 });
  const sessions = await page.request.get(`/v1/patients/${lia}/sessions`);
  expect(sessions.ok()).toBe(true);
  expect((await sessions.json()).sessions).toHaveLength(1);
  await context.close();
});

test("a second therapist on the same tablet can't see the first one's patients but sends her waiting results", async ({ browser }) => {
  test.setTimeout(300_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  const oren = await enrol(page, "oren@synthetic.test");
  await setUpOffline(page, "oren-tablet-1");
  await updateNow(page);
  await context.clearCookies(); // the tablet changes hands (the space stays)
  const gali = await enrol(page, "gali@synthetic.test");
  await setUpOffline(page, "gali-tablet-1", "/settings/device");
  await downloadVideos(page);
  await page.getByRole("link", { name: "Today" }).first().click();
  const itay = await patientId(page, "Itay Ron");
  await readyForOffline(page);

  await context.setOffline(true);
  await page.reload();
  const who = page.getByRole("radiogroup", { name: "Who's using the tablet?" });
  await expect(who).toContainText("Gali Ron");
  await expect(who).toContainText("Oren Katz");
  await axe(page, "offline sign-in");
  await shot(page, "60-offline-sign-in");
  await page.getByRole("radio", { name: /Gali Ron/ }).check();
  await page.getByLabel("Offline password").fill("gali-tablet-1");
  await page.getByRole("button", { name: "Unlock" }).click();
  await playSession(page, "Itay Ron");

  // Oren takes the tablet, still offline: his own space, his own patients only.
  await page.goto("/offline");
  await page.getByRole("radio", { name: /Oren Katz/ }).check();
  await page.getByLabel("Offline password").fill("oren-tablet-1");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("region", { name: "Next up" })).toContainText("Shai Paz");
  await expect(page.getByRole("heading", { level: 1, name: /Oren/ })).toBeVisible();
  await expect(page.getByText("Itay Ron")).toHaveCount(0);

  // Online, Oren signs in: Gali's waiting results go out with his sign-in, credited to her.
  await context.setOffline(false);
  await context.clearCookies();
  await signInAgain(page, "oren@synthetic.test", oren);
  await expect(page.getByText(/Will send \d+ results?/)).toHaveCount(0, { timeout: 30_000 });
  await context.clearCookies();
  await signInAgain(page, "gali@synthetic.test", gali);
  const sessions = (await (await page.request.get(`/v1/patients/${itay}/sessions`)).json()).sessions as unknown[];
  expect(sessions).toHaveLength(1);
  await context.close();
});

test("play from the network: offline, the pre-flight names the video that isn't here and the session runs without it", async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  await enrol(page, "dvir@synthetic.test");
  await setUpOffline(page, "dvir-tablet-1");
  await axe(page, "today after setup");
  await readyForOffline(page);
  await goOfflineAndUnlock(context, page, null, "dvir-tablet-1");
  const row = page.getByRole("region", { name: "Next up" }).getByRole("listitem").filter({ hasText: "Nir Gal" });
  await row.getByRole("link", { name: /Start session with .*Nir Gal/ }).click();
  await expect(page.getByText("One step isn't on this device:")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "▶ Colour shapes" })).toBeVisible();
  await page.getByRole("button", { name: "Start without it" }).click();
  await page.getByLabel("New PIN").fill(PIN);
  await page.getByLabel("Repeat the PIN").fill(PIN);
  await page.getByRole("button", { name: "Save PIN" }).click();
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "▶ Colour shapes" })).toHaveCount(0);
  await context.close();
});
