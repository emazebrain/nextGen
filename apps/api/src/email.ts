/**
 * Email module — invitation emails via Resend HTTP API (spec §Email).
 *
 * Uses Resend's REST API (https://api.resend.com) over HTTPS — no SMTP
 * needed, so it works on Railway and other hosts that block outbound SMTP.
 * Falls back to a no-op mailer when RESEND_API_KEY is not configured, so the
 * API still works in development without email credentials.
 *
 * **No patient data in emails.** The invitation mentions no clinic name, no
 * organization name, and no role — just the platform name and credentials.
 */
import { randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Temporary password generation
// ---------------------------------------------------------------------------

const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const ALL = LOWER + UPPER + DIGITS;

/** Generate a random 16-character password with at least one of each class. */
export function generateTempPassword(): string {
  // Start with base64url random bytes, then guarantee all three classes.
  const chars = randomBytes(16).toString("base64url").slice(0, 16).split("");
  // Replace the last three chars to ensure at least one of each class.
  const rb = randomBytes(3);
  chars[chars.length - 3] = LOWER[rb[0]! % LOWER.length]!;
  chars[chars.length - 2] = UPPER[rb[1]! % UPPER.length]!;
  chars[chars.length - 1] = DIGITS[rb[2]! % DIGITS.length]!;
  return chars.join("");
}

// ---------------------------------------------------------------------------
// Mailer
// ---------------------------------------------------------------------------

export interface MailerConfig {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  // Legacy SMTP vars — kept so createMailer(process.env) doesn't need changes
  // in server.ts. Ignored when RESEND_API_KEY is set.
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_SECURE?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
}

export interface Mailer {
  available: boolean;
  sendInvitation(
    to: string,
    name: string,
    tempPassword: string,
    loginUrl: string,
  ): Promise<boolean>;
}

const RESEND_API_URL = "https://api.resend.com/emails";

export function createMailer(env: MailerConfig): Mailer {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    return {
      available: false,
      async sendInvitation() {
        console.warn("[email] RESEND_API_KEY not configured — invitation email not sent");
        return false;
      },
    };
  }

  const from = env.EMAIL_FROM ?? "eMazeBrain <onboarding@resend.dev>";

  return {
    available: true,
    async sendInvitation(to, name, tempPassword, loginUrl) {
      try {
        const res = await fetch(RESEND_API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: [to],
            subject: "You've been invited to eMazeBrain",
            text: invitationText(name, tempPassword, loginUrl),
            html: invitationHtml(name, tempPassword, loginUrl),
          }),
        });
        if (!res.ok) {
          const body = await res.text();
          console.error(`[email] Resend API error (${res.status}):`, body);
          return false;
        }
        const data = await res.json();
        console.log("[email] Invitation sent via Resend, id:", (data as { id?: string }).id);
        return true;
      } catch (err) {
        console.error("[email] Failed to send invitation:", err);
        return false;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Email templates — no patient data, no clinic/org/role info (spec §Email)
// ---------------------------------------------------------------------------

function invitationText(name: string, tempPassword: string, loginUrl: string): string {
  return [
    `Hello ${name},`,
    "",
    "You've been invited to eMazeBrain.",
    "",
    `Your temporary password is: ${tempPassword}`,
    "",
    "Please sign in and change your password immediately:",
    loginUrl,
    "",
    "This password is temporary and must be changed on your first sign-in.",
    "",
    "— The eMazeBrain Team",
  ].join("\n");
}

function invitationHtml(name: string, tempPassword: string, loginUrl: string): string {
  // Simple inline CSS, mobile-friendly. No external resources.
  return `<!DOCTYPE html>
<html dir="ltr" lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:32px auto;background:#ffffff;border-radius:8px;padding:32px">
<tr><td>
  <h1 style="font-size:20px;margin:0 0 16px">Welcome to eMazeBrain</h1>
  <p style="font-size:15px;line-height:1.5;color:#333">Hello ${escapeHtml(name)},</p>
  <p style="font-size:15px;line-height:1.5;color:#333">You've been invited to eMazeBrain.</p>
  <p style="font-size:15px;line-height:1.5;color:#333">Your temporary password is:</p>
  <p style="font-size:18px;font-family:monospace;background:#f0f0f0;padding:12px;border-radius:4px;text-align:center;letter-spacing:1px">${escapeHtml(tempPassword)}</p>
  <p style="font-size:15px;line-height:1.5;color:#333">Please sign in and change your password immediately:</p>
  <p style="text-align:center;margin:24px 0"><a href="${escapeHtml(loginUrl)}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-size:15px">Sign In</a></p>
  <p style="font-size:13px;color:#666">This password is temporary and must be changed on your first sign-in.</p>
</td></tr>
</table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
