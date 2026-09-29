import { describe, expect, it, vi } from "vitest";
import { evaluateHandoffQuality, evaluateModelAssistance } from "./typesafe-runtime-evaluator";

describe("TypeSafe runtime shadow evaluation", () => {
  it("judges handoff fit, refusal, and summary support from redacted permitted evidence", async () => {
    const evaluate = vi.fn().mockResolvedValue({
      answers: { target_fit: { type: "noul", noul: 0.91 }, refusal_ignored: { type: "noul", noul: 0.04 },
        summary_supported: { type: "noul", noul: 0.82 } },
      model: "jev-1.13", usage: { inputTokens: 12, outputTokens: 3 }, latencyMs: 21,
    });
    const result = await evaluateHandoffQuality({ evaluate }, {
      latestCallerTurn: "Transfer me to billing. Email ada@example.com.",
      recentTranscript: [{ speaker: "agent", text: "I can transfer you." }],
      selectedTarget: { id: "billing", name: "Billing ada@example.com", kind: "billing" },
      permittedTargets: [{ id: "billing", name: "Billing ada@example.com", kind: "billing" }],
      reason: "Billing help requested.", callerNeedSummary: "Caller needs invoice help.",
      safeToolResults: [{ toolName: "Invoice lookup", status: "completed", summary: "Invoice 4 is open.",
        safeOutput: { rawSecret: "must-not-send" } }],
    });
    expect(result).toEqual({ targetFit: 0.91, refusalIgnored: 0.04, summarySupported: 0.82,
      model: "jev-1.13", usage: { inputTokens: 12, outputTokens: 3 }, latencyMs: 21 });
    expect(evaluate).toHaveBeenCalledOnce();
    expect(evaluate.mock.calls[0]?.[0]).toMatchObject({ timeoutMs: 1_500,
      questions: { target_fit: { type: "noul" }, refusal_ignored: { type: "noul" }, summary_supported: { type: "noul" } } });
    const sent = JSON.stringify(evaluate.mock.calls[0]?.[0].state);
    expect(sent).toContain("[redacted-email]");
    expect(sent).not.toContain("ada@example.com");
    expect(sent).not.toContain("must-not-send");
  });

  it("returns only model advice and usage for a bounded turn", async () => {
    const evaluate = vi.fn().mockResolvedValue({ answers: { advice: { type: "choice", choice: "needs_clarification",
      confidence: 0.88, probabilities: { routine: 0.05, needs_clarification: 0.9, needs_stronger_reasoning: 0.05 } } },
      model: "jev-1.13", usage: { inputTokens: 8, outputTokens: 2 }, latencyMs: 12 });
    const result = await evaluateModelAssistance({ evaluate }, { latestCallerTurn: "Which account?",
      recentTranscript: [], currentTier: "cheap" });
    expect(result).toEqual({ choice: "needs_clarification", confidence: 0.88,
      model: "jev-1.13", usage: { inputTokens: 8, outputTokens: 2 }, latencyMs: 12 });
    expect(evaluate.mock.calls[0]?.[0]).toMatchObject({ timeoutMs: 1_500,
      questions: { advice: { type: "choice", criteria: { routine: expect.any(String),
        needs_clarification: expect.any(String), needs_stronger_reasoning: expect.any(String) } } } });
  });

  it("rejects incomplete context without sending a partial request", async () => {
    const evaluate = vi.fn();
    await expect(evaluateModelAssistance({ evaluate }, { latestCallerTurn: "x".repeat(12_001),
      recentTranscript: [], currentTier: "cheap" })).rejects.toMatchObject({ code: "invalid_request" });
    expect(evaluate).not.toHaveBeenCalled();
  });
});
