/**
 * Slice 1 end to end: a therapist adds a patient, links a parent, and the
 * parent signs consent in Hebrew on the tablet, which unlocks sessions. A
 * clinic manager archives and restores the patient and sees the team.
 */
import { expect, test } from "@playwright/test";
import { axe, enrol, shot } from "./helpers.ts";

test.describe.configure({ mode: "serial" });

const CHILD = "Tamar Shalev";

test("a therapist adds a patient, with clear errors and a duplicate warning", async ({ page }) => {
  await enrol(page, "dana@synthetic.test");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Patients" }).click();
  await page.getByRole("link", { name: "Add patient" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Add patient" })).toBeVisible();

  await page.getByRole("button", { name: "Add patient" }).click();
  await expect(page.getByRole("alert")).toHaveText("Some fields need attention.");
  await expect(page.getByLabel("First name")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("First name")).toBeFocused();
  await axe(page, "add patient (errors)");
  await shot(page, "20-add-patient-errors");

  await page.getByLabel("First name").fill("Tamar");
  await page.getByLabel("Last name").fill("Shalev");
  await page.getByLabel("Date of birth").fill("2018-05-14");
  await page.getByText("More details").click();
  await page.getByLabel("Alert for the care team").fill("Prefers short breaks between games");
  await page.getByRole("button", { name: "Add patient" }).click();

  await expect(page.getByRole("heading", { level: 1, name: CHILD })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Patient added." })).toBeVisible();
  await expect(page.getByText("Prefers short breaks between games")).toBeVisible();
  await expect(page.getByText("Waiting for consent")).toBeVisible();
  await axe(page, "new patient");
  await shot(page, "21-patient-new");

  // The same child again: warned, not blocked.
  await page.goto("/patients/new");
  await page.getByLabel("First name").fill("tamar");
  await page.getByLabel("Last name").fill("Shalev");
  await page.getByLabel("Date of birth").fill("2018-05-14");
  await page.getByRole("button", { name: "Add patient" }).click();
  await expect(page.getByText("A patient with this name and date of birth already exists")).toBeVisible();
  await page.getByRole("link", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/\/patients$/);
  await page.context().storageState({ path: "test-results/.dana.json" });
});

test.describe("as Dana", () => {
  test.use({ storageState: "test-results/.dana.json" });

  test("links parents and records consent in Hebrew, which unlocks sessions", async ({ page }) => {
    await page.goto("/patients");
    await page.getByRole("link", { name: /Tamar Shalev/ }).click();
    await page.getByRole("link", { name: "Family and consent" }).click();
    await expect(page.getByText("No parent or guardian is linked yet.")).toBeVisible();

    await page.getByRole("button", { name: "Add parent or guardian" }).click();
    const form = page.getByRole("form", { name: "Add parent or guardian" });
    await form.getByLabel("Full name").fill("Orit Shalev");
    await form.getByLabel("Mobile phone").fill("call me");
    await form.getByRole("button", { name: "Add" }).click();
    await expect(form.getByText("Enter a phone number using digits")).toBeVisible();
    await form.getByLabel("Mobile phone").fill("+972 50 000 1234");
    await form.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText("Orit Shalev")).toBeVisible();

    await page.getByRole("button", { name: "Add parent or guardian" }).click();
    const form2 = page.getByRole("form", { name: "Add parent or guardian" });
    await form2.getByLabel("Full name").fill("Rina Shalev");
    await form2.getByLabel("Relationship to the child").selectOption({ label: "Grandparent" });
    await form2.getByLabel("Legal guardian, can give consent").uncheck();
    await form2.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText("Rina Shalev")).toBeVisible();
    await axe(page, "family");
    await shot(page, "22-family");

    await page.getByRole("link", { name: "Record consent" }).first().click();
    await expect(page.getByRole("navigation")).toHaveCount(0); // no app navigation while the parent holds the tablet
    await expect(page.getByRole("radio", { name: /Rina/ })).toHaveCount(0); // only legal guardians can sign
    await page.getByRole("button", { name: "Hand the tablet to Orit Shalev" }).click();

    await page.getByRole("radio", { name: "עברית" }).check();
    const text = page.locator(".consenttext");
    await expect(text).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1, name: "הסכמה עבור Tamar" })).toBeVisible();
    await page.getByRole("button", { name: "חתימה" }).click();
    await expect(page.getByRole("alert")).toContainText("לא בוצע שינוי");
    await page.getByLabel("מפגשים במרפאה").check();
    await page.getByLabel("תוכנית ביתית").check();
    await page.getByLabel("השם המלא שלך").fill("אורית שלו");
    await page.getByLabel(/אני האפוטרופוס החוקי/).check();
    await axe(page, "consent (he)");
    await shot(page, "23-consent-he");
    await page.getByRole("button", { name: "חתימה" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "תודה, Orit Shalev" })).toBeVisible();
    await shot(page, "24-consent-done");

    await page.getByRole("link", { name: "Back to Tamar" }).click();
    await expect(page.getByText("Waiting for consent")).toHaveCount(0);
    const consent = page.getByRole("region", { name: "Consent" });
    await expect(consent.getByRole("listitem").filter({ hasText: "Clinic sessions" })).toContainText("Given");
    await expect(consent.getByRole("listitem").filter({ hasText: "Home program" })).toContainText("Given");
    await expect(consent.getByRole("listitem").filter({ hasText: "Messages with the therapist" })).toContainText("Not given");
    await expect(page.locator(".phead")).toContainText("Active");
  });

  test("edits details", async ({ page }) => {
    await page.goto("/patients");
    await page.getByRole("link", { name: /Tamar Shalev/ }).click();
    await page.getByRole("link", { name: "Edit" }).click();
    await page.getByLabel("Dominant hand").selectOption({ label: "Left" });
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Changes saved.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Details" })).toContainText("Left");
  });
});

test("a clinic manager archives and restores a patient, and sees the team", async ({ page }) => {
  await enrol(page, "ronit@synthetic.test");
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("link", { name: "Team" }).click();
  const team = page.getByRole("table", { name: "People who work in this clinic" });
  await expect(team.getByRole("row")).toHaveCount(14); // header + the thirteen seeded staff in Tel Aviv
  await axe(page, "team");

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Patients" }).click();
  await page.getByRole("link", { name: /Tamar Shalev/ }).first().click();
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Archive patient" }).click();
  const dialog = page.getByRole("dialog", { name: "Archive Tamar Shalev?" });
  await expect(dialog).toBeVisible();
  await axe(page, "archive dialog");
  await shot(page, "25-archive-dialog");
  await dialog.getByRole("button", { name: "Archive patient" }).click();
  await expect(page).toHaveURL(/\/patients$/);

  await page.getByRole("radio", { name: "Archived" }).click();
  await expect(page.getByRole("radio", { name: "Archived" })).toBeChecked();
  await page.getByRole("link", { name: /Tamar Shalev/ }).click();
  await expect(page.getByText("This patient is archived.")).toBeVisible();
  await page.getByRole("button", { name: "Restore patient" }).click();
  await expect(page.getByText("This patient is archived.")).toHaveCount(0);
});
