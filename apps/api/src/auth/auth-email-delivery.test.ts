import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAuthEmailDeliveriesForTests, getAuthEmailDeliveriesForTests, resolveAuthEmailDeliveryConfig, sendAuthEmail } from "./auth-email-delivery";

const email = {
  kind: "email_verification" as const,
  to: "delivered@resend.dev",
  subject: "Verify your Zara email",
  url: "https://api.zharaai.com/api/auth/verify-email?token=synthetic-token&callbackURL=https%3A%2F%2Fzharaai.com",
  token: "synthetic-token",
  userId: "synthetic-user",
};

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); clearAuthEmailDeliveriesForTests(); });

describe("auth email provider boundary", () => {
  it("rejects partial Resend settings instead of sending tokens to the old webhook", () => {
    expect(() => resolveAuthEmailDeliveryConfig({ NODE_ENV: "production", RESEND_API_KEY: "re_synthetic", ZARA_AUTH_EMAIL_WEBHOOK_URL: "https://example.com/old" })).toThrow(/ZARA_AUTH_EMAIL_FROM/);
    expect(() => resolveAuthEmailDeliveryConfig({ NODE_ENV: "production", ZARA_AUTH_EMAIL_FROM: "support@zharaai.com" })).toThrow(/RESEND_API_KEY/);
  });

  it.each([401, 403, 200])("rejects a provider error or missing message ID without leaking its response (%s)", async (status) => {
    vi.stubEnv("RESEND_API_KEY", "re_synthetic");
    vi.stubEnv("ZARA_AUTH_EMAIL_FROM", "support@zharaai.com");
    const fetcher = vi.fn(async () => Response.json({ message: "re_synthetic synthetic-token" }, { status }));
    vi.stubGlobal("fetch", fetcher);
    const error = await sendAuthEmail(email).catch((failure: Error) => failure);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toMatch(/re_synthetic|synthetic-token/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("retries a lost response and temporary provider failure without delivering duplicate emails", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "re_synthetic");
    vi.stubEnv("ZARA_AUTH_EMAIL_FROM", "support@zharaai.com");
    const accepted = new Map<string, string>();
    let attempts = 0;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const key = new Headers(init.headers).get("idempotency-key")!;
      expect(key).not.toContain(email.token);
      const body = String(init.body);
      if (accepted.has(key)) expect(accepted.get(key)).toBe(body);
      accepted.set(key, body);
      attempts++;
      if (attempts === 1) throw new Error("socket closed after provider accepted email");
      if (attempts === 2) return Response.json({ message: "unavailable" }, { status: 503 });
      return Response.json({ id: "synthetic-email-id" });
    });
    await sendAuthEmail(email);
    expect(attempts).toBe(3);
    expect(accepted.size).toBe(1);
  });
  it("sends a verification link through Resend instead of the legacy webhook without retaining credentials", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "re_synthetic");
    vi.stubEnv("ZARA_AUTH_EMAIL_FROM", "Zara <support@zharaai.com>");
    vi.stubEnv("ZARA_AUTH_EMAIL_WEBHOOK_URL", "https://example.com/old");
    const requests: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      return Response.json({ id: "synthetic-email-id" });
    });
    await sendAuthEmail(email);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(String(requests[0]!.init.body));
    expect(body).toMatchObject({ from: "Zara <support@zharaai.com>", to: ["delivered@resend.dev"], subject: email.subject });
    expect(body.text).toContain(email.url);
    expect(body.html).toContain("&amp;callbackURL=");
    expect(String(requests[0]!.init.body)).not.toContain("re_synthetic");
    expect(new Headers(requests[0]!.init.headers).get("authorization")).toBe("Bearer re_synthetic");
    expect(getAuthEmailDeliveriesForTests()).toEqual([]);
  });
});
