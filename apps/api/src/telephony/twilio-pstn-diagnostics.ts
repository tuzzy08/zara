import type { Logger } from "@nestjs/common";

const twilioPstnLogPrefix = "[twilio-pstn]";
const maxArrayItems = 12;
const maxObjectDepth = 4;

type LoggableValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | LoggableValue[]
  | { [key: string]: LoggableValue };

export type TwilioPstnDiagnosticFields = Record<string, unknown>;

export function logTwilioPstnDiagnostic(
  logger: Pick<Logger, "log">,
  event: string,
  fields: TwilioPstnDiagnosticFields = {},
) {
  logger.log(formatTwilioPstnDiagnostic(event, fields));
}

export function warnTwilioPstnDiagnostic(
  logger: Pick<Logger, "warn">,
  event: string,
  fields: TwilioPstnDiagnosticFields = {},
) {
  logger.warn(formatTwilioPstnDiagnostic(event, fields));
}

export function safeTwilioDiagnosticErrorMessage(error: unknown) {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "unknown_error";
}

function formatTwilioPstnDiagnostic(event: string, fields: TwilioPstnDiagnosticFields) {
  return `${twilioPstnLogPrefix} ${event} ${JSON.stringify(sanitizeDiagnosticFields(fields))}`;
}

function sanitizeDiagnosticFields(fields: TwilioPstnDiagnosticFields) {
  return sanitizeDiagnosticValue(fields, "", 0) as Record<string, LoggableValue>;
}

function sanitizeDiagnosticValue(value: unknown, key: string, depth: number): LoggableValue {
  if (isSensitiveKey(key)) {
    return "[redacted]";
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return isPhoneLikeKey(key) ? maskPhoneNumber(value) : value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    if (depth >= maxObjectDepth) {
      return "[max-depth]";
    }

    return value
      .slice(0, maxArrayItems)
      .map((item) => sanitizeDiagnosticValue(item, key, depth + 1));
  }

  if (typeof value === "object") {
    if (depth >= maxObjectDepth) {
      return "[max-depth]";
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeDiagnosticValue(entryValue, entryKey, depth + 1),
      ]),
    ) as Record<string, LoggableValue>;
  }

  return String(value);
}

function isSensitiveKey(key: string) {
  const normalizedKey = key.toLowerCase();
  if (normalizedKey.startsWith("has") || normalizedKey.endsWith("present") || normalizedKey.endsWith("keys")) {
    return false;
  }

  return /auth|secret|signature|token|authorization/i.test(key);
}

function isPhoneLikeKey(key: string) {
  const normalizedKey = key.toLowerCase();

  return (
    normalizedKey === "from" ||
    normalizedKey === "to" ||
    normalizedKey === "phonenumber" ||
    normalizedKey === "callernumber" ||
    normalizedKey === "callednumber" ||
    normalizedKey === "callerphonenumber" ||
    normalizedKey === "calledphonenumber"
  );
}

function maskPhoneNumber(value: string) {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }

  const digits = trimmed.replace(/\D+/g, "");
  if (digits.length < 4) {
    return "****";
  }

  const suffix = digits.slice(-4);
  return trimmed.startsWith("+") ? `+*******${suffix}` : `*******${suffix}`;
}
