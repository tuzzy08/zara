import { beforeAll, describe, expect, it } from "vitest";
import { createAgentToolAvailableAction, parseAgentActionText, resolveRuntimeAgent, type InstructionImprovementResult } from "@zara/core";
import { InstructionImprovementService } from "../agents/instruction-improvement.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import type { RuntimePromptPolicyService } from "../runtime-prompt-policy/runtime-prompt-policy.service";
import type { PostgresPoolService } from "../database/postgres-pool.service";
import type { ConnectorToolsService } from "../integrations/connector-tools.service";
import { OpenAiChatTextProvider } from "../sandbox-live-sessions/openai-chat-text.provider";
import { GeminiChatTextProvider } from "../sandbox-live-sessions/gemini-chat-text.provider";
import { defaultRuntimePromptPolicy } from "../runtime-prompt-policy/runtime-prompt-policy.models";
import { buildRuntimeEvalManifest } from "./runtime-eval-executor";
import { loadRuntimeEvalFixtures } from "./runtime-eval-fixtures";

// Paid provider check with synthetic tenant data. No real database or tools are used.
describe("live instruction improvement comparison", () => {
  const original = "Help callers track orders. Be polite. Do not promise delivery dates.";
  let improved: InstructionImprovementResult;
  const fixture = loadRuntimeEvalFixtures().find(item => item.id === "toolbelt-missing-input")!;
  const manifest = buildRuntimeEvalManifest(fixture.inputs);
  const assignment = manifest.agentToolAssignments[0]!;
  beforeAll(async () => {
    if (!process.env.OPENAI_API_KEY || !process.env.GEMINI_API_KEY) throw new Error("Live comparison requires OpenAI and Gemini credentials.");
    const workspaces = new WorkspacesService();
    workspaces.setMembershipRole({ organizationId: "synthetic-eval", workspaceId: "workspace-default", userId: "eval-builder", role: "builder", actorUserId: "eval-builder" });
    const service = new InstructionImprovementService(workspaces,
      { getPromptPolicy: async () => defaultRuntimePromptPolicy } as unknown as RuntimePromptPolicyService,
      { pool: { query: async () => ({ rows: [{ count: 1 }] }) } } as unknown as PostgresPoolService,
      { listTools: () => [] } as unknown as ConnectorToolsService);
    improved = await service.improve({ workspaceId: "workspace-default", name: "Order support", businessName: "Synthetic shop",
      agentClass: "support", instructions: original,
      languagePolicy: { defaultLanguage: "en", supportedLanguages: ["en"], allowMidCallSwitching: false },
      tools: [{ id: assignment.id, label: "Order lookup", whenToUse: "Check the current order status", requiredInputs: ["orderId"], requiresHumanApproval: false, available: true }],
      handoffTargets: [],
    }, { organizationId: "synthetic-eval", userId: "eval-builder", role: "builder" });
    expect(improved.originalInstructions).toBe(original);
    expect(improved.instructions.length).toBeLessThanOrEqual(12000);
    expect(improved.instructions).toMatch(/delivery/i);
    expect(improved.handoffTargetIds).toEqual([]);
    process.stdout.write(`Instruction draft comparison ${JSON.stringify({ generatorModel: process.env.INSTRUCTION_IMPROVEMENT_MODEL ?? "gpt-4.1", instructions: improved.instructions, originalCharacters: original.length,
      improvedCharacters: improved.instructions.length, changes: improved.changes.length, questions: improved.questions.length, conflicts: improved.conflicts.length })}\n`);
  }, 45_000);

  const scenarios = [
    { id: "missing-input", transcript: "Can you check my order?" },
    { id: "ready", transcript: "Check order 123 now." },
    { id: "failed", transcript: "Did you get the order status?" },
    { id: "unknown-date", transcript: "Promise that order 123 will arrive tomorrow." },
  ];
  for (const providerId of ["openai", "google-gemini"] as const) {
    it.each(scenarios)(`${providerId}: $id`, async scenario => {
      const model = providerId === "openai" ? process.env.OPENAI_PROMPT_EVAL_MODEL ?? "gpt-4.1-mini"
        : process.env.GEMINI_PROMPT_EVAL_MODEL ?? "gemini-3.1-flash-lite";
      const provider = providerId === "openai" ? new OpenAiChatTextProvider({ apiKey: process.env.OPENAI_API_KEY! })
        : new GeminiChatTextProvider({ apiKey: process.env.GEMINI_API_KEY! });
      const scores: Array<{ version: string; passed: boolean; characters: number; latencyMs: number }> = [];
      const responses: string[] = [];
      for (const [version, instructions] of [["original", original], ["improved", improved.instructions]] as const) {
        const agent = { ...resolveRuntimeAgent(manifest, manifest.entryAgentId)!, instructions, modelProvider: providerId, modelId: model };
        const start = performance.now();
        let text = "";
        for await (const chunk of provider.streamText({ manifest, activeAgent: agent, transcript: scenario.transcript, tier: "cheap",
          promptPolicy: defaultRuntimePromptPolicy, context: { callPhase: "discovery", language: "en" }, agentActionMode: true,
          agentContext: { latestCallerTurn: scenario.transcript, recentTranscript: [],
            availableActions: ["missing-input", "ready"].includes(scenario.id) ? [createAgentToolAvailableAction(assignment)] : [],
            toolResults: scenario.id === "failed" ? [{ toolName: "Order lookup", status: "failed", summary: "Order lookup failed. No status was returned." }] : [] },
          abortSignal: AbortSignal.timeout(25_000),
        })) text += chunk;
        const action = parseAgentActionText(text);
        responses.push(text);
        const passed = scenario.id === "ready" ? action.type === "call_tool" && action.toolAssignmentId === assignment.id && action.arguments.orderId === "123"
          : action.type === "respond" && (scenario.id === "missing-input" ? /(?:order|reference).*(?:number|id)|(?:number|id).*(?:order|reference)/i.test(action.responseText)
            : scenario.id === "failed" ? /fail|unable|cannot|could not|couldn't|wasn['’]t able|don['’]t have.*status|not.*(?:available|retrieve|check|return)/i.test(action.responseText)
              : /cannot|can't|unable|do not|don't|not able|can't guarantee/i.test(action.responseText));
        scores.push({ version, passed, characters: text.length, latencyMs: Math.round(performance.now() - start) });
      }
      process.stdout.write(`Held-out comparison ${JSON.stringify({ providerId, model, scenario: scenario.id, scores })}\n`);
      expect(scores[1]?.passed, JSON.stringify({ responses, instructions: improved.instructions })).toBe(true);
    });
  }
});
