import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface OneTimeStreamTokenClaims {
  subject: string;
  scope: Record<string, string>;
  expiresAt: string;
  nonce: string;
}

export function createOneTimeStreamToken(input: {
  secret: Buffer;
  subject: string;
  scope: Record<string, string>;
  expiresAt: string;
}) {
  const claims: OneTimeStreamTokenClaims = {
    subject: input.subject,
    scope: sortScope(input.scope),
    expiresAt: input.expiresAt,
    nonce: randomBytes(24).toString("base64url"),
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signature = signPayload(input.secret, payload);
  const token = `${payload}.${signature}`;

  return {
    token,
    tokenHash: hashOneTimeStreamToken(token),
    expiresAt: input.expiresAt,
  };
}

export function hashOneTimeStreamToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

export function verifyOneTimeStreamToken(input: {
  secret: Buffer;
  token: string;
  expectedSubject: string;
  expectedScope: Record<string, string>;
  now?: string | undefined;
}) {
  const [payload, signature] = input.token.split(".");
  if (payload === undefined || signature === undefined || payload.length === 0 || signature.length === 0) {
    return false;
  }

  if (!safeEqual(signature, signPayload(input.secret, payload))) {
    return false;
  }

  const claims = parseClaims(payload);
  if (claims === undefined || claims.subject !== input.expectedSubject) {
    return false;
  }

  const nowMs = Date.parse(input.now ?? new Date().toISOString());
  const expiresAtMs = Date.parse(claims.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    return false;
  }

  return JSON.stringify(sortScope(claims.scope)) === JSON.stringify(sortScope(input.expectedScope));
}

export function resolveOneTimeStreamTokenSecret() {
  const configuredSecret = process.env.ZARA_STREAM_TOKEN_SECRET ?? process.env.BETTER_AUTH_SECRET;
  return configuredSecret === undefined || configuredSecret.length === 0
    ? randomBytes(32)
    : createHash("sha256").update(configuredSecret, "utf8").digest();
}

function parseClaims(payload: string): OneTimeStreamTokenClaims | undefined {
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }

    const candidate = parsed as Partial<OneTimeStreamTokenClaims>;
    if (
      typeof candidate.subject !== "string" ||
      typeof candidate.expiresAt !== "string" ||
      typeof candidate.nonce !== "string" ||
      candidate.scope === undefined ||
      candidate.scope === null ||
      typeof candidate.scope !== "object" ||
      Array.isArray(candidate.scope)
    ) {
      return undefined;
    }

    return {
      subject: candidate.subject,
      expiresAt: candidate.expiresAt,
      nonce: candidate.nonce,
      scope: Object.fromEntries(
        Object.entries(candidate.scope).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      ),
    };
  } catch {
    return undefined;
  }
}

function signPayload(secret: Buffer, payload: string) {
  return createHmac("sha256", secret).update(payload, "utf8").digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.byteLength === rightBuffer.byteLength && timingSafeEqual(leftBuffer, rightBuffer);
}

function sortScope(scope: Record<string, string>) {
  return Object.fromEntries(Object.entries(scope).sort(([left], [right]) => left.localeCompare(right)));
}
