import type { PstnLoadReport } from "./load-runner";

const forbiddenKeys = new Set([
  "accountsid",
  "authtoken",
  "authorization",
  "apikey",
  "credential",
  "caller",
  "from",
  "to",
  "phonenumber",
  "streamtoken",
  "transcript",
  "payload",
  "media",
]);

export function serializeLoadReport(report: PstnLoadReport) {
  assertSafeKeys(report);
  return `${JSON.stringify(report, null, 2)}\n`;
}

function assertSafeKeys(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertSafeKeys(item);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const canonicalKey = key.replace(/[^a-z0-9]/giu, "").toLowerCase();
    if (forbiddenKeys.has(canonicalKey)) {
      throw new Error(`PSTN load report contains forbidden field '${key}'.`);
    }
    assertSafeKeys(child);
  }
}
