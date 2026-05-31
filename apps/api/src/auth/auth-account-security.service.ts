import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";

import { zaraAuth } from "./better-auth.instance";

interface AccountSecurityHttpRequest {
  headers: Record<string, string | string[] | undefined>;
  protocol: string;
  get: (header: string) => string | undefined;
}

interface PasswordResetRequestBody {
  email?: unknown;
  redirectTo?: unknown;
}

interface EmailVerificationRequestBody {
  callbackURL?: unknown;
}

interface BetterAuthRequestOptions {
  body?: Record<string, unknown>;
  method?: "GET" | "POST";
}

export interface SessionMetadata {
  id: string;
  current: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

@Injectable()
export class AuthAccountSecurityService {
  async requestPasswordReset(request: AccountSecurityHttpRequest, body: PasswordResetRequestBody) {
    const email = normalizeEmail(body.email);
    const redirectTo = optionalString(body.redirectTo);

    await requestBetterAuth(request, "/request-password-reset", {
      body: {
        email,
        ...(redirectTo === undefined ? {} : { redirectTo }),
      },
      method: "POST",
    });

    return {
      ok: true,
      delivery: "queued" as const,
      message: "If this email exists in Zara, a password reset link has been sent.",
    };
  }

  async requestEmailVerification(request: AccountSecurityHttpRequest, body: EmailVerificationRequestBody) {
    const session = await this.requireSession(request);
    const user = asRecord(session["user"]);
    const email = normalizeEmail(user["email"]);

    if (user["emailVerified"] === true) {
      return {
        ok: true,
        delivery: "not_required" as const,
      };
    }

    await requestBetterAuth(request, "/send-verification-email", {
      body: {
        email,
        ...(optionalString(body.callbackURL) === undefined ? {} : { callbackURL: optionalString(body.callbackURL) }),
      },
      method: "POST",
    });

    return {
      ok: true,
      delivery: "queued" as const,
    };
  }

  async listSessions(request: AccountSecurityHttpRequest): Promise<{ ok: true; sessions: SessionMetadata[] }> {
    const currentSessionPayload = await this.requireSession(request);
    const currentSession = asRecord(currentSessionPayload["session"]);
    const currentToken = stringValue(currentSession["token"]);
    const sessionsPayload = await requestBetterAuth(request, "/list-sessions");
    const sessions = Array.isArray(sessionsPayload) ? sessionsPayload : [];

    return {
      ok: true,
      sessions: sessions.flatMap((sessionValue) => {
        const session = asRecord(sessionValue);
        const id = stringValue(session["id"]);
        const token = stringValue(session["token"]);
        const expiresAt = stringValue(session["expiresAt"]);
        const createdAt = stringValue(session["createdAt"]);
        const updatedAt = stringValue(session["updatedAt"]);

        if (
          id.length === 0 ||
          token.length === 0 ||
          expiresAt.length === 0 ||
          createdAt.length === 0 ||
          updatedAt.length === 0
        ) {
          return [];
        }

        return [{
          id,
          current: token === currentToken,
          createdAt,
          updatedAt,
          expiresAt,
          ipAddress: nullableString(session["ipAddress"]),
          userAgent: nullableString(session["userAgent"]),
        }];
      }),
    };
  }

  async revokeSession(request: AccountSecurityHttpRequest, sessionId: string) {
    await this.requireSession(request);
    const sessionsPayload = await requestBetterAuth(request, "/list-sessions");
    const sessions = Array.isArray(sessionsPayload) ? sessionsPayload : [];
    const session = sessions
      .map((value) => asRecord(value))
      .find((candidate) => stringValue(candidate["id"]) === sessionId);
    const token = stringValue(session?.["token"]);

    if (token.length === 0) {
      throw new NotFoundException("Session was not found for the signed-in user.");
    }

    await requestBetterAuth(request, "/revoke-session", {
      body: { token },
      method: "POST",
    });

    return { ok: true };
  }

  private async requireSession(request: AccountSecurityHttpRequest) {
    const sessionPayload = asRecord(await requestBetterAuth(request, "/get-session?disableCookieCache=true"));
    const user = asRecord(sessionPayload["user"]);

    if (stringValue(user["id"]).length === 0) {
      throw new UnauthorizedException("A signed-in session is required.");
    }

    return sessionPayload;
  }
}

async function requestBetterAuth(
  request: AccountSecurityHttpRequest,
  path: string,
  options: BetterAuthRequestOptions = {},
) {
  const response = await zaraAuth.handler(toBetterAuthRequest(request, path, options));

  if (!response.ok) {
    throw new BadRequestException(await responseMessage(response));
  }

  const text = await response.text();

  if (text.trim().length === 0) {
    return null;
  }

  return JSON.parse(text) as unknown;
}

function toBetterAuthRequest(
  request: AccountSecurityHttpRequest,
  path: string,
  options: BetterAuthRequestOptions,
) {
  const headers = new Headers();

  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined || key.toLowerCase() === "content-length") {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
      continue;
    }

    headers.set(key, value);
  }

  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  const host = request.get("host") ?? "127.0.0.1:4010";
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);

  return new Request(`${request.protocol}://${host}/api/auth${path}`, {
    ...(body === undefined ? {} : { body }),
    headers,
    method: options.method ?? "GET",
  });
}

async function responseMessage(response: Response) {
  try {
    const payload = asRecord(JSON.parse(await response.text()));
    return stringValue(payload["message"]) || stringValue(asRecord(payload["error"])["message"]) || "Auth security request failed.";
  } catch {
    return "Auth security request failed.";
  }
}

function normalizeEmail(value: unknown) {
  const email = stringValue(value).trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException("Enter a valid email address.");
  }

  return email;
}

function optionalString(value: unknown) {
  const normalized = stringValue(value).trim();
  return normalized.length === 0 ? undefined : normalized;
}

function nullableString(value: unknown) {
  const normalized = stringValue(value).trim();
  return normalized.length === 0 ? null : normalized;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}
