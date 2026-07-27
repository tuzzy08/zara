import { describe, expect, it } from "vitest";

import { formatSmokeFailure } from "./smoke-output";

describe("PSTN protocol smoke output", () => {
  it("does not print provider-controlled error text", () => {
    const output = formatSmokeFailure(new Error("provider close leaked-secret-number-+15551234567"));

    expect(output).toContain('"outcome":"failed"');
    expect(output).toContain('"errorCode":"pstn_protocol_smoke_failed"');
    expect(output).not.toContain("leaked-secret");
    expect(output).not.toContain("+15551234567");
  });
});
