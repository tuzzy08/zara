import { describe, expect, it, vi } from "vitest";
import { ShadowTypeSafeIntentClassifierProvider, TypeSafeIntentClassifierProvider } from "./typesafe-intent-classifier.provider";

const input = {
  nodeId: "route-1",
  modelAlias: "intent-classifier-fast" as const,
  confidenceThreshold: 0.65,
  latestCallerTurn: "I do not need a refund. Please explain my invoice.",
  recentTranscript: [],
  branches: [
    { id: "refund", label: "Refund", intentKey: "refund", description: "Request a refund", examples: [], targetNodeId: "agent-refund" },
    { id: "invoice", label: "Invoice", intentKey: "invoice", description: "Ask about an invoice", examples: [], targetNodeId: "agent-invoice" },
  ],
  fallback: { label: "Ask for detail" },
  inputWindow: { latestCallerTurn: true, recentTranscriptTurns: 0, includeConversationSummary: false, includePreviousAgentContext: false, includeRecentToolResults: false },
};

describe("TypeSafeIntentClassifierProvider", () => {
  it("returns only configured branch facts and keeps graph targets out of the request", async () => {
    const evaluate = vi.fn().mockResolvedValue({ model: "jev-1.13.0", usage: { inputTokens: 20, outputTokens: 4 }, latencyMs: 30, answers: { intent: { type: "choice", choice: "b1", confidence: 0.82, probabilities: { b0: 0.1, b1: 0.82, no_match: 0.08 } } } });
    const provider = new TypeSafeIntentClassifierProvider({ evaluate } as never, 0.75);
    expect(await provider.classify(input)).toMatchObject({ matchedBranchId: "invoice", intentKey: "invoice", confidence: 0.82, reason: "Matched configured branch 'Invoice'.", usedFallback: false, providerAssessment: { model: "jev-1.13.0", inputTokens: 20, outputTokens: 4, latencyMs: 30 } });
    expect(evaluate.mock.calls[0]?.[0]?.questions.intent.criteria).toEqual({ b0: "Refund: Request a refund", b1: "Invoice: Ask about an invoice", no_match: "No configured branch clearly matches." });
    expect(JSON.stringify(evaluate.mock.calls[0]?.[0])).not.toContain("targetNodeId");
  });

  it("rejects an unknown choice and uses fallback for a low-confidence choice", async () => {
    const metadata = { model: "jev-1.13.0", usage: { inputTokens: 20, outputTokens: 4 }, latencyMs: 30 };
    const evaluate = vi.fn().mockResolvedValueOnce({ ...metadata, answers: { intent: { type: "choice", choice: "other", confidence: 0.9, probabilities: {} } } }).mockResolvedValueOnce({ ...metadata, answers: { intent: { type: "choice", choice: "b1", confidence: 0.7, probabilities: {} } } });
    const provider = new TypeSafeIntentClassifierProvider({ evaluate } as never, 0.75);
    await expect(provider.classify(input)).rejects.toMatchObject({ code: "invalid_response" });
    expect((await provider.classify(input)).usedFallback).toBe(true);
  });

  it("abstains on oversized evidence before an external request", async () => {
    const evaluate = vi.fn();
    const provider = new TypeSafeIntentClassifierProvider({ evaluate } as never, 0.75);
    await expect(provider.classify({ ...input, latestCallerTurn: `${"x".repeat(2_000)} Please cancel this.` })).rejects.toThrow("exceeds");
    expect(evaluate).not.toHaveBeenCalled();
  });
});

it("keeps the Gemini result when a sampled TypeSafe shadow check fails", async () => {
  const primary = { classify: vi.fn().mockResolvedValue({ matchedBranchId: "invoice", intentKey: "invoice", confidence: 0.8, reason: "primary", usedFallback: false }) };
  const candidate = { classify: vi.fn().mockRejectedValue(new Error("unavailable")) };
  const record = vi.fn();
  const provider = new ShadowTypeSafeIntentClassifierProvider(primary, candidate, 1, record);
  expect(await provider.classify({ ...input, shadowAllowed: true })).toMatchObject({ matchedBranchId: "invoice" });
  await vi.waitFor(() => expect(record).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" })));
});

it("skips the intent shadow request when transcript retention is not allowed", async () => {
  const primary = { classify: vi.fn().mockResolvedValue({ matchedBranchId: null, intentKey: null, confidence: 0.8, reason: "fallback", usedFallback: true }) };
  const candidate = { classify: vi.fn() };
  const provider = new ShadowTypeSafeIntentClassifierProvider(primary, candidate, 1, vi.fn());
  await provider.classify({ ...input, shadowAllowed: false });
  expect(candidate.classify).not.toHaveBeenCalled();
});
