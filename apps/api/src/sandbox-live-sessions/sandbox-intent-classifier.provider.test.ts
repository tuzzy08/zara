import { describe, expect, it } from "vitest";
import type { IntentRouteBranchConfig } from "@zara/core";

import { GeminiIntentClassifierProvider } from "./sandbox-intent-classifier.provider";

describe("GeminiIntentClassifierProvider", () => {
  it("calls the configured Gemini intent model and parses structured JSON", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const provider = new GeminiIntentClassifierProvider({
      apiKey: "gemini-key",
      baseUrl: "https://gemini.example.test",
      modelId: "gemini-3.1-flash-lite",
      fetch: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        matchedBranchId: "branch-billing",
                        intentKey: "billing",
                        confidence: 0.9,
                        reason: "The caller is asking about an invoice.",
                        usedFallback: false,
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        );
      },
    });

    const output = await provider.classify({
      nodeId: "condition-intent",
      modelAlias: "intent-classifier-fast",
      confidenceThreshold: 0.65,
      latestCallerTurn: "I need a copy of my invoice.",
      recentTranscript: [],
      branches: [
        branch({
          id: "branch-billing",
          label: "Billing",
          intentKey: "billing",
          targetNodeId: "agent-billing",
        }),
      ],
      fallback: {
        label: "General support",
      },
      inputWindow: {
        latestCallerTurn: true,
        recentTranscriptTurns: 6,
        includeConversationSummary: true,
        includePreviousAgentContext: true,
        includeRecentToolResults: true,
      },
    });

    expect(output).toEqual({
      matchedBranchId: "branch-billing",
      intentKey: "billing",
      confidence: 0.9,
      reason: "The caller is asking about an invoice.",
      usedFallback: false,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe(
      "https://gemini.example.test/v1beta/models/gemini-3.1-flash-lite:generateContent",
    );
    expect(requests[0]!.init.headers).toEqual({
      "Content-Type": "application/json",
      "x-goog-api-key": "gemini-key",
    });
    const body = JSON.stringify(JSON.parse(String(requests[0]!.init.body)));
    expect(body).toContain("branch-billing");
    expect(body).toContain("intent-classifier-fast");
    expect(body).not.toContain("agent-billing");
  });
});

function branch(input: {
  id: string;
  label: string;
  intentKey: string;
  targetNodeId: string;
}): IntentRouteBranchConfig {
  return {
    ...input,
    description: `${input.label} caller intent.`,
    examples: [`Example ${input.label}`],
  };
}
