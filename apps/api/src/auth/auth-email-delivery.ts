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
  const action = delivery.kind === "email_verification" ? "Verify your email" : "Reset your password";
  const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
  const body = JSON.stringify({
    from, to: [delivery.to], subject: delivery.subject,
    text: `${action} for Zara:\n\n${delivery.url}\n\nIf you did not request this email, ignore it.`,
    html: `<p>${action} for Zara.</p><p><a href="${escape(delivery.url)}">${action}</a></p><p>If you did not request this email, ignore it.</p>`,
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
    body: JSON.stringify(delivery),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Auth email webhook failed with ${response.status}.`);
  }
}
