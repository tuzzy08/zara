import { describe, expect, it } from "vitest";

import { createSmokeCallSid, createTwilioStreamSid } from "./smoke-identities";

describe("PSTN protocol smoke identities", () => {
  it("creates unique Twilio call and stream SIDs across scenarios and runs", () => {
    const first = createSmokeCallSid("run-one", "normal", 0);
    const secondScenario = createSmokeCallSid("run-one", "interrupted", 1);
    const secondRun = createSmokeCallSid("run-two", "normal", 0);

    expect(new Set([first, secondScenario, secondRun]).size).toBe(3);
    expect([first, secondScenario, secondRun].every((sid) => /^CA[0-9a-f]{32}$/u.test(sid))).toBe(true);
    expect(new Set([
      createTwilioStreamSid(first),
      createTwilioStreamSid(secondScenario),
      createTwilioStreamSid(secondRun),
    ]).size).toBe(3);
  });
});
