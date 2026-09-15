import { describe, expect, it } from "vitest";
import { loadRuntimeEvalFixtures } from "./runtime-eval-fixtures";
import { executeRuntimeEval } from "./runtime-eval-executor";
import { scoreRuntimeEvalExample } from "./runtime-evaluators";

describe("runtime evaluation target", () => {
  it("executes fixture inputs without reading expected answers", async () => {
    for (const fixture of loadRuntimeEvalFixtures()) {
      const output = await executeRuntimeEval(fixture.inputs);
      expect(scoreRuntimeEvalExample(fixture, output as Record<string, unknown>).passed, fixture.id).toBe(true);
    }
  });

  it("fails the score when the classifier selects a different route", async () => {
    const fixture = loadRuntimeEvalFixtures()[0]!;
    const changed = structuredClone(fixture.inputs);
    changed.classifierOutput = {
      matchedBranchId: "appointment", intentKey: "appointment", confidence: 0.95,
      reason: "Appointment request", usedFallback: false,
    };
    const output = await executeRuntimeEval(changed);
    expect(output.selectedTargetNodeId).toBe("agent-scheduler");
    expect(scoreRuntimeEvalExample(fixture, output as Record<string, unknown>).passed).toBe(false);
  });

  it("observes the server rejection of an unassigned tool", async () => {
    const fixture = loadRuntimeEvalFixtures().find((item) => item.id === "toolbelt-missing-input")!;
    const changed = structuredClone(fixture.inputs);
    changed.agentAction = JSON.stringify({
      type: "call_tool", toolCallId: "call-unknown", toolAssignmentId: "unassigned",
      arguments: {}, reason: "Untrusted tool request",
    });
    const output = await executeRuntimeEval(changed);
    expect(output.toolCallIds).toEqual([]);
    expect(output.missingInputRejected).toBe(false);
    expect(scoreRuntimeEvalExample(fixture, output as Record<string, unknown>).passed).toBe(false);
  });
});
