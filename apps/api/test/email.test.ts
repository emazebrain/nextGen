import { describe, expect, it } from "vitest";
import { createMailer, generateTempPassword } from "../src/email.ts";

describe("email", () => {
  it("generateTempPassword produces a string of at least 16 chars with mixed character classes", () => {
    const pw = generateTempPassword();
    expect(pw.length).toBeGreaterThanOrEqual(16);
    expect(pw).toMatch(/[a-z]/);
    expect(pw).toMatch(/[A-Z]/);
    expect(pw).toMatch(/[0-9]/);
  });

  it("createMailer without SMTP_HOST returns a no-op mailer", () => {
    const mailer = createMailer({});
    expect(mailer.available).toBe(false);
  });

  it("sendInvitation on a no-op mailer returns false", async () => {
    const mailer = createMailer({});
    const sent = await mailer.sendInvitation("x@test", "X", "pw123", "https://app/sign-in");
    expect(sent).toBe(false);
  });
});
