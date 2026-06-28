import { describe, expect, it } from "vitest";

import { getBuilderNodeAccent } from "./workflowBuilderTheme";

describe("getBuilderNodeAccent", () => {
  it("assigns a distinct accent to each builder node kind", () => {
    const accents = [
      getBuilderNodeAccent("entry").accent,
      getBuilderNodeAccent("agent").accent,
      getBuilderNodeAccent("condition").accent,
      getBuilderNodeAccent("human-escalation").accent,
      getBuilderNodeAccent("end").accent,
    ];

    expect(new Set(accents).size).toBe(accents.length);
  });

  it("keeps minimap colors aligned with node accents", () => {
    const escalationAccent = getBuilderNodeAccent("human-escalation");

    expect(escalationAccent.minimap).toBe(escalationAccent.accent);
    expect(escalationAccent.tint).toContain("rgba");
  });
});
