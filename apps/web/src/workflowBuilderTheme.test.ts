import { describe, expect, it } from "vitest";

import { getBuilderNodeAccent } from "./workflowBuilderTheme";

describe("getBuilderNodeAccent", () => {
  it("assigns a distinct accent to each builder node kind", () => {
    const accents = [
      getBuilderNodeAccent("entry").accent,
      getBuilderNodeAccent("agent").accent,
      getBuilderNodeAccent("tool").accent,
      getBuilderNodeAccent("handoff").accent,
      getBuilderNodeAccent("condition").accent,
      getBuilderNodeAccent("human-escalation").accent,
      getBuilderNodeAccent("end").accent,
    ];

    expect(new Set(accents).size).toBe(accents.length);
  });

  it("keeps minimap colors aligned with node accents", () => {
    const handoffAccent = getBuilderNodeAccent("handoff");

    expect(handoffAccent.minimap).toBe(handoffAccent.accent);
    expect(handoffAccent.tint).toContain("rgba");
  });
});
