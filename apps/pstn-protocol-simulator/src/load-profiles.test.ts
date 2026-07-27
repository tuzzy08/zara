import { describe, expect, it } from "vitest";

import {
  assertLoadProfileApproved,
  createBuiltInLoadProfile,
  loadScenarioNames,
} from "./load-profiles";

describe("PSTN load profiles", () => {
  it("pins the release step curve and complete scenario catalog", () => {
    const profile = createBuiltInLoadProfile("stepped");

    expect(profile.stages.map((stage) => stage.concurrency)).toEqual([1, 5, 10, 20, 40, 60, 100]);
    expect(loadScenarioNames).toEqual(expect.arrayContaining([
      "normal",
      "delayed-provider-readiness",
      "twilio-marks",
      "interruption-clear",
      "tool-call",
      "same-provider-handoff",
      "cross-provider-handoff",
      "long-audio-output",
      "provider-quota-error",
      "provider-closure",
      "exporter-failure",
    ]));
  });

  it("defines same-tenant, cross-tenant, failure, and two-hour soak profiles", () => {
    const burst = createBuiltInLoadProfile("burst", { qualifiedTarget: 20 });
    const failure = createBuiltInLoadProfile("failure", { qualifiedTarget: 20 });
    const soak = createBuiltInLoadProfile("soak", { qualifiedTarget: 20 });

    expect(burst.stages.map((stage) => stage.tenantMode)).toEqual(["same-tenant", "cross-tenant"]);
    expect(failure.stages.flatMap((stage) => stage.scenarios)).toEqual(expect.arrayContaining([
      "provider-quota-error",
      "provider-closure",
      "exporter-failure",
    ]));
    expect(soak.stages).toEqual([
      expect.objectContaining({
        concurrency: 20,
        durationMs: 2 * 60 * 60 * 1_000,
        arrivalRatePerSecond: 400,
        verifyDrain: true,
      }),
    ]);
  });

  it("keeps CI smoke separate from explicitly approved release-scale work", () => {
    expect(() => assertLoadProfileApproved(createBuiltInLoadProfile("ci-smoke"), false)).not.toThrow();
    expect(() => assertLoadProfileApproved(createBuiltInLoadProfile("stepped"), false)).toThrow(
      "ZARA_PSTN_LOAD_APPROVED=true",
    );
    expect(() => assertLoadProfileApproved(createBuiltInLoadProfile("stepped"), true)).not.toThrow();
  });
});
