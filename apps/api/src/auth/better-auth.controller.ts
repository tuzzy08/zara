import { All, Controller, Req, Res } from "@nestjs/common";

import { zaraAuth } from "./better-auth.instance";

@Controller("api/auth")
export class BetterAuthController {
  @All("{*authPath}")
  async handle(@Req() request: AuthHttpRequest, @Res() response: AuthHttpResponse) {
    const authResponse = await zaraAuth.handler(toWebRequest(request));

    response.status(authResponse.status);
    copyHeaders(authResponse.headers, response);
    response.send(Buffer.from(await authResponse.arrayBuffer()));
  }
}

interface AuthHttpRequest {
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
  method: string;
  originalUrl: string;
  protocol: string;
  get: (header: string) => string | undefined;
}

interface AuthHttpResponse {
  append: (header: string, value: string) => void;
  send: (body: Buffer) => void;
  setHeader: (header: string, value: string) => void;
  status: (statusCode: number) => AuthHttpResponse;
}

function toWebRequest(request: AuthHttpRequest) {
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

  const body = resolveRequestBody(request);

  return new Request(resolveRequestUrl(request), {
    ...(body === undefined ? {} : { body }),
    headers,
    method: request.method,
  });
}

function resolveRequestUrl(request: AuthHttpRequest) {
  const host = request.get("host") ?? "127.0.0.1:4010";
  return `${request.protocol}://${host}${request.originalUrl}`;
}

function resolveRequestBody(request: AuthHttpRequest) {
  if (request.method === "GET" || request.method === "HEAD") {
    return undefined;
  }

  if (typeof request.body === "string") {
    return request.body;
  }

  if (request.body instanceof Buffer) {
    return request.body.toString("utf8");
  }

  if (request.body !== undefined && request.body !== null) {
    return JSON.stringify(request.body);
  }

  return undefined;
}

function copyHeaders(headers: Headers, response: AuthHttpResponse) {
  const setCookies = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];

  for (const cookie of setCookies) {
    response.append("set-cookie", cookie);
  }

  headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      if (setCookies.length === 0) {
        response.append("set-cookie", value);
      }
      return;
    }

    response.setHeader(key, value);
  });
}
