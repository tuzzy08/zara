import { Injectable } from "@nestjs/common";

import { zaraAuth } from "./better-auth.instance";

export interface AuthInvitationsHttpRequest {
  headers: Record<string, string | string[] | undefined>;
  protocol: string;
  get: (header: string) => string | undefined;
}

export interface AuthInvitationsHttpResponse {
  append: (header: string, value: string) => void;
}

export interface AuthOperationSuccess<TBody = unknown> {
  ok: true;
  body: TBody;
  status: number;
}

export interface AuthOperationFailure {
  ok: false;
  body: unknown;
  message: string;
  status: number;
}

export type AuthOperationResult<TBody = unknown> =
  | AuthOperationSuccess<TBody>
  | AuthOperationFailure;

export interface AuthInvitationsSessionGateway {
  getSession: () => Promise<AuthOperationResult>;
  signUpEmail: (input: {
    email: string;
    password: string;
    name: string;
  }) => Promise<AuthOperationResult>;
  signInEmail: (input: {
    email: string;
    password: string;
  }) => Promise<AuthOperationResult>;
  createInvitation: (input: {
    organizationId: string;
    email: string;
    role: string;
    workspaceId?: string | undefined;
    workspaceRole?: string | undefined;
  }) => Promise<AuthOperationResult>;
  acceptInvitation: (input: {
    invitationId: string;
  }) => Promise<AuthOperationResult>;
  cancelInvitation: (input: {
    invitationId: string;
  }) => Promise<AuthOperationResult>;
  listInvitations: (input: {
    organizationId: string;
  }) => Promise<AuthOperationResult<unknown[]>>;
  getFullOrganization: (input: {
    organizationId: string;
  }) => Promise<AuthOperationResult>;
}

@Injectable()
export class AuthInvitationsGateway {
  createSession(
    request: AuthInvitationsHttpRequest,
    response: AuthInvitationsHttpResponse,
  ): AuthInvitationsSessionGateway {
    return new BetterAuthInvitationsSessionGateway(request, response);
  }
}

class BetterAuthInvitationsSessionGateway implements AuthInvitationsSessionGateway {
  private readonly cookies = new Map<string, string>();

  constructor(
    private readonly request: AuthInvitationsHttpRequest,
    private readonly response: AuthInvitationsHttpResponse,
  ) {
    this.captureCookieHeader(request.headers["cookie"]);
  }

  getSession() {
    return this.send("/get-session", "GET");
  }

  signUpEmail(input: { email: string; password: string; name: string }) {
    return this.send("/sign-up/email", "POST", input);
  }

  signInEmail(input: { email: string; password: string }) {
    return this.send("/sign-in/email", "POST", input);
  }

  createInvitation(input: {
    organizationId: string;
    email: string;
    role: string;
    workspaceId?: string | undefined;
    workspaceRole?: string | undefined;
  }) {
    return this.send("/organization/invite-member", "POST", input);
  }

  acceptInvitation(input: { invitationId: string }) {
    return this.send("/organization/accept-invitation", "POST", input);
  }

  cancelInvitation(input: { invitationId: string }) {
    return this.send("/organization/cancel-invitation", "POST", input);
  }

  async listInvitations(input: { organizationId: string }) {
    const result = await this.send<unknown[]>(
      `/organization/list-invitations?organizationId=${encodeURIComponent(input.organizationId)}`,
      "GET",
    );

    if (!result.ok) {
      return result;
    }

    return {
      ...result,
      body: Array.isArray(result.body) ? result.body : [],
    };
  }

  getFullOrganization(input: { organizationId: string }) {
    return this.send(
      `/organization/get-full-organization?organizationId=${encodeURIComponent(input.organizationId)}`,
      "GET",
    );
  }

  private async send<TBody = unknown>(
    path: string,
    method: "GET" | "POST",
    body?: unknown,
  ): Promise<AuthOperationResult<TBody>> {
    const authResponse = await zaraAuth.handler(this.toRequest(path, method, body));
    this.captureResponseCookies(authResponse.headers);

    const parsedBody = await parseResponseBody(authResponse);

    if (!authResponse.ok) {
      return {
        ok: false,
        body: parsedBody,
        message: resolveErrorMessage(parsedBody),
        status: authResponse.status,
      };
    }

    return {
      ok: true,
      body: parsedBody as TBody,
      status: authResponse.status,
    };
  }

  private toRequest(path: string, method: "GET" | "POST", body?: unknown) {
    const headers = new Headers();

    for (const [key, value] of Object.entries(this.request.headers)) {
      if (
        value === undefined ||
        key.toLowerCase() === "content-length" ||
        key.toLowerCase() === "cookie"
      ) {
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

    headers.set("accept", "application/json");

    const cookieHeader = this.toCookieHeader();

    if (cookieHeader.length > 0) {
      headers.set("cookie", cookieHeader);
    }

    if (method === "POST") {
      headers.set("content-type", "application/json");
    }

    const host = this.request.get("host") ?? "127.0.0.1:4010";

    return new Request(`${this.request.protocol}://${host}/api/auth${path}`, {
      headers,
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  private captureCookieHeader(value: string | string[] | undefined) {
    const cookieHeader = Array.isArray(value) ? value.join("; ") : value ?? "";

    for (const cookie of cookieHeader.split(";")) {
      const pair = cookie.trim();
      const separatorIndex = pair.indexOf("=");

      if (separatorIndex <= 0) {
        continue;
      }

      this.cookies.set(pair.slice(0, separatorIndex), pair);
    }
  }

  private captureResponseCookies(headers: Headers) {
    const setCookies = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];

    for (const cookie of setCookies) {
      this.response.append("set-cookie", cookie);
      this.captureSetCookie(cookie);
    }
  }

  private captureSetCookie(cookie: string) {
    const pair = cookie.split(";")[0]?.trim() ?? "";
    const separatorIndex = pair.indexOf("=");

    if (separatorIndex <= 0) {
      return;
    }

    this.cookies.set(pair.slice(0, separatorIndex), pair);
  }

  private toCookieHeader() {
    return [...this.cookies.values()].join("; ");
  }
}

async function parseResponseBody(response: Response) {
  const text = await response.text();

  if (text.trim().length === 0) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function resolveErrorMessage(value: unknown) {
  const record = asRecord(value);
  const error = record["error"];
  const errorRecord = asRecord(error);

  return stringValue(record["message"])
    || stringValue(errorRecord["message"])
    || stringValue(record["statusText"])
    || "Authentication request failed.";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}
