import { Logger } from "@nestjs/common";

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

type AuthEmailDeliveryMode = "memory" | "log" | "webhook";

interface AuthEmailDeliveryConfig {
  mode: AuthEmailDeliveryMode;
  webhookUrl?: string;
}

const authEmailDeliveries: AuthEmailDelivery[] = [];
const authEmailLogger = new Logger("AuthEmailDelivery");

export async function sendAuthEmail(input: Omit<AuthEmailDelivery, "at">) {
  const delivery: AuthEmailDelivery = {
    ...input,
    at: new Date().toISOString(),
  };

  authEmailDeliveries.push(delivery);

  const config = resolveAuthEmailDeliveryConfig(process.env);

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
  const webhookUrl = env.ZARA_AUTH_EMAIL_WEBHOOK_URL?.trim();

  if (webhookUrl !== undefined && webhookUrl.length > 0) {
    return {
      mode: "webhook",
      webhookUrl,
    };
  }

  if (env.NODE_ENV === "production") {
    throw new Error("ZARA_AUTH_EMAIL_WEBHOOK_URL is required in production for auth email delivery.");
  }

  return {
    mode: env.NODE_ENV === "test" ? "memory" : "log",
  };
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
