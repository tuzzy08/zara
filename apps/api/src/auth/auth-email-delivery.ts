import { Logger } from "@nestjs/common";
import { createHash } from "node:crypto";

export type AuthEmailKind = "email_verification" | "password_reset";

export interface AuthEmailDelivery {
  kind: AuthEmailKind;
  to: string;
  subject: string;
  url: string;
  token: string;
  userId: string;
  at: string;
}

type AuthEmailDeliveryMode = "memory" | "log" | "webhook" | "resend";

interface AuthEmailDeliveryConfig {
  mode: AuthEmailDeliveryMode;
  webhookUrl?: string;
  apiKey?: string;
  from?: string;
}

const authEmailDeliveries: AuthEmailDelivery[] = [];
const authEmailLogger = new Logger("AuthEmailDelivery");

export async function sendAuthEmail(input: Omit<AuthEmailDelivery, "at">) {
  const delivery: AuthEmailDelivery = {
    ...input,
    at: new Date().toISOString(),
  };

  const config = resolveAuthEmailDeliveryConfig(process.env);

  if (config.mode === "memory") authEmailDeliveries.push(delivery);
  if (config.mode === "resend") {
    await postResendEmail(config.apiKey!, config.from!, delivery);
    return;
  }

  if (config.mode === "webhook") {
    await postAuthEmailWebhook(config.webhookUrl!, delivery);
    return;
  }

  if (config.mode === "log") {
    authEmailLogger.log(`${delivery.kind} queued for ${delivery.to}: ${delivery.url}`);
  }
}

export function clearAuthEmailDeliveriesForTests() {
  authEmailDeliveries.splice(0, authEmailDeliveries.length);
}

export function getAuthEmailDeliveriesForTests(): AuthEmailDelivery[] {
  return authEmailDeliveries.map((delivery) => ({ ...delivery }));
}

export function resolveAuthEmailDeliveryConfig(
  env: Record<string, string | undefined>,
): AuthEmailDeliveryConfig {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.ZARA_AUTH_EMAIL_FROM?.trim();
  if (apiKey && from) return { mode: "resend", apiKey, from };
  if (apiKey || from) throw new Error("RESEND_API_KEY and ZARA_AUTH_EMAIL_FROM must both be set for auth email delivery.");
  const webhookUrl = env.ZARA_AUTH_EMAIL_WEBHOOK_URL?.trim();

  if (webhookUrl !== undefined && webhookUrl.length > 0) {
    return {
      mode: "webhook",
      webhookUrl,
    };
  }

  if (env.NODE_ENV === "production") {
    throw new Error("Configure RESEND_API_KEY with ZARA_AUTH_EMAIL_FROM, or ZARA_AUTH_EMAIL_WEBHOOK_URL, for production auth email delivery.");
  }

  return {
    mode: env.NODE_ENV === "test" ? "memory" : "log",
  };
}

async function postResendEmail(apiKey: string, from: string, delivery: AuthEmailDelivery) {
  const body = JSON.stringify({
    from, to: [delivery.to], subject: delivery.subject,
    ...renderAuthEmail(delivery),
  });
  const request = {
    method: "POST", body,
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}`,
      "idempotency-key": `auth-email/${createHash("sha256").update(body).digest("hex")}` },
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response | undefined;
    try {
      response = await fetch("https://api.resend.com/emails", { ...request, signal: AbortSignal.timeout(10_000) });
    } catch {
      // The provider can accept a request before the connection fails. Reuse its key.
    }
    if (response?.ok) {
      const result = await response.json().catch(() => null) as { id?: unknown } | null;
      if (typeof result?.id !== "string" || !result.id) throw new Error("Auth email delivery returned an invalid receipt.");
      return;
    }
    const retryable = !response || response.status === 429 || response.status >= 500;
    if (!retryable || attempt === 2) throw new Error(`Auth email delivery failed (${response?.status ?? "network"}).`);
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
}

async function postAuthEmailWebhook(webhookUrl: string, delivery: AuthEmailDelivery) {
  const response = await fetch(webhookUrl, {
    body: JSON.stringify({ ...delivery, ...renderAuthEmail(delivery) }),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Auth email webhook failed with ${response.status}.`);
  }
}

function renderAuthEmail(delivery: AuthEmailDelivery) {
  const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
  const url = escape(delivery.url);
  if (delivery.kind === "password_reset") return {
    text: `Reset your password for Zara:\n\n${delivery.url}\n\nIf you did not request this email, ignore it.`,
    html: `<p>Reset your password for Zara.</p><p><a href="${url}">Reset your password</a></p><p>If you did not request this email, ignore it.</p>`,
  };

  return {
    text: `ZARA\n\nVerify your email\n\nConfirm this email address to continue setting up your Zara workspace.\n\nVerify email:\n${delivery.url}\n\nAfter verification, select Continue setup to open your dashboard. Your original signup details are saved. If the link has expired, return to signup and select Continue an existing signup to request a new link.\n\nIf you did not create a Zara account, you can ignore this email.\nNeed help? Contact support@zharaai.com.`,
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Verify your Zara email</title></head>
<body style="margin:0;padding:0;background-color:#f5f5f5;color:#171717;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Verify your email to finish setting up your Zara workspace.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f5f5f5;table-layout:fixed;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;table-layout:fixed;">
        <tr><td style="padding:24px 28px;background-color:#171717;color:#ffffff;font-size:22px;font-weight:600;letter-spacing:4px;">ZARA</td></tr>
        <tr><td style="padding:32px 28px;background-color:#ffffff;">
          <p style="margin:0 0 12px;color:#666666;font-size:12px;line-height:18px;letter-spacing:1px;">ACCOUNT SETUP</p>
          <h1 style="margin:0 0 16px;font-size:28px;line-height:34px;font-weight:600;letter-spacing:-0.6px;">Verify your email</h1>
          <p style="margin:0 0 24px;color:#4d4d4d;font-size:16px;line-height:25px;">Confirm this email address to continue setting up your Zara workspace.</p>
          <table role="presentation" cellspacing="0" cellpadding="0" width="100%"><tr><td align="center" bgcolor="#171717" style="border-radius:6px;">
            <a href="${url}" style="display:block;padding:15px 20px;color:#ffffff;text-decoration:none;font-size:16px;line-height:22px;font-weight:600;">Verify email</a>
          </td></tr></table>
          <p style="margin:24px 0 0;color:#4d4d4d;font-size:16px;line-height:25px;">After verification, select Continue setup to open your dashboard. Your original signup details are saved.</p>
          <p style="margin:24px 0 8px;color:#666666;font-size:13px;line-height:20px;">Button not working? Copy this link into your browser:</p>
          <p style="margin:0;font-size:12px;line-height:19px;word-break:break-all;overflow-wrap:anywhere;"><a href="${url}" style="color:#0072f5;text-decoration:underline;word-break:break-all;">${url}</a></p>
          <p style="margin:24px 0 0;color:#666666;font-size:13px;line-height:20px;">If the link has expired, return to signup and select Continue an existing signup to request a new link.</p>
        </td></tr>
        <tr><td style="padding:24px 28px;color:#666666;font-size:13px;line-height:20px;">
          <p style="margin:0 0 8px;">If you did not create a Zara account, you can ignore this email.</p>
          <p style="margin:0;">Need help? <a href="mailto:support@zharaai.com" style="color:#4d4d4d;text-decoration:underline;">Contact Zara support</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`,
  };
}
