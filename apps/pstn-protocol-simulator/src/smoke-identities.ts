import { createHash } from "node:crypto";

export function createSmokeCallSid(runId: string, scenarioName: string, scenarioIndex: number) {
  return createSid("CA", `${runId}:${scenarioName}:${scenarioIndex}`);
}

export function createTwilioStreamSid(callSid: string) {
  return createSid("MZ", callSid);
}

function createSid(prefix: "CA" | "MZ", seed: string) {
  return `${prefix}${createHash("sha256").update(seed).digest("hex").slice(0, 32)}`;
}
