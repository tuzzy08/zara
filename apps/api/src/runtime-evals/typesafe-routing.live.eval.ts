import { expect, it } from "vitest";
import { TypeSafeClient } from "../ai-judgements/typesafe-client";
import { evaluateHandoffQuality, evaluateModelAssistance } from "../sandbox-live-sessions/typesafe-runtime-evaluator";
import { TypeSafeIntentClassifierProvider } from "../sandbox-live-sessions/typesafe-intent-classifier.provider";

const handoffs = [
  { id: "billing-fit", caller: "Please transfer me to billing about an invoice.", target: "billing", summary: "Caller needs invoice help.", expected: [true, false, true] },
  { id: "wrong-target", caller: "I need technical support for a broken login.", target: "billing", summary: "Caller needs invoice help.", expected: [false, false, false] },
  { id: "refused-transfer", caller: "Do not transfer me. I will call later.", target: "billing", summary: "Caller wants billing help now.", expected: [false, true, false] },
  { id: "unsupported-summary", caller: "My invoice is overdue.", target: "billing", summary: "The caller paid invoice INV-2 today.", expected: [true, false, false] },
] as const;
const advice = [
  { id: "routine", caller: "What are your opening hours?", expected: "routine" },
  { id: "clarify", caller: "Can you check my order?", expected: "needs_clarification" },
  { id: "reasoning", caller: "We use 12,000 call minutes per month and can spend at most $350. Basic costs $200 for 10,000 minutes plus $0.03 for each extra minute. Growth costs $300 for 20,000 minutes. Pro costs $500 for 30,000 minutes. Compare all three and recommend one.", expected: "needs_stronger_reasoning" },
] as const;
const intents = [
  { id: "synonym", caller: "Can you send me a statement of what I owe?", expected: "invoice" },
  { id: "negation", caller: "I do not want a refund. I need the invoice explained.", expected: "invoice" },
  { id: "mixed", caller: "I need a refund and a new invoice, but I cannot decide which first.", expected: null },
  { id: "language-change", caller: "Bonjour, pouvez-vous m'envoyer ma facture?", expected: "invoice" },
  { id: "no-match", caller: "Hello, I just wanted to say thanks.", expected: null },
] as const;

it("scores synthetic handoff and model advice cases with the live TypeSafe model", async () => {
  const apiKey = process.env.TYPESAFE_API_KEY;
  const model = process.env.TYPESAFE_MODEL;
  if (!apiKey || !model) throw new Error("TYPESAFE_API_KEY and TYPESAFE_MODEL are required for the paid TypeSafe evaluation.");
  const client = new TypeSafeClient({ apiKey, model });
  let errors = 0;
  for (const scenario of handoffs) {
    const actual = await evaluateHandoffQuality(client, {
      latestCallerTurn: scenario.caller, recentTranscript: [],
      selectedTarget: { id: scenario.target, name: "Billing", kind: "billing" },
      permittedTargets: [{ id: "billing", name: "Billing", kind: "billing" },
        { id: "support", name: "Support", kind: "support" }],
      reason: "Agent requested a transfer.", callerNeedSummary: scenario.summary, safeToolResults: [],
    });
    const observed = [actual.targetFit >= 0.5, actual.refusalIgnored >= 0.5, actual.summarySupported >= 0.5];
    errors += observed.filter((value, index) => value !== scenario.expected[index]).length;
    process.stdout.write(`zara.typesafe-routing.v1/${scenario.id}: ${JSON.stringify({ expected: scenario.expected, observed,
      model: actual.model, latencyMs: actual.latencyMs, usage: actual.usage })}\n`);
  }
  for (const scenario of advice) {
    const actual = await evaluateModelAssistance(client, { latestCallerTurn: scenario.caller,
      recentTranscript: [], currentTier: "cheap" });
    if (actual.choice !== scenario.expected) errors++;
    process.stdout.write(`zara.typesafe-routing.v1/${scenario.id}: ${JSON.stringify({ expected: scenario.expected,
      observed: actual.choice, model: actual.model, latencyMs: actual.latencyMs, usage: actual.usage })}\n`);
  }
  const classifier = new TypeSafeIntentClassifierProvider(client, 0.65);
  for (const scenario of intents) {
    const actual = await classifier.classify({
      nodeId: "synthetic-route", modelAlias: "intent-classifier-fast", confidenceThreshold: 0.65,
      latestCallerTurn: scenario.caller, recentTranscript: [],
      branches: [
        { id: "refund", label: "Refund", intentKey: "refund", description: "Request money back for a charge", examples: [], targetNodeId: "agent-refund" },
        { id: "invoice", label: "Invoice", intentKey: "invoice", description: "Ask for an invoice, bill, or statement of charges", examples: [], targetNodeId: "agent-invoice" },
      ],
      fallback: { label: "Ask for detail" },
      inputWindow: { latestCallerTurn: true, recentTranscriptTurns: 0, includeConversationSummary: false,
        includePreviousAgentContext: false, includeRecentToolResults: false },
    });
    if (actual.matchedBranchId !== scenario.expected) errors++;
    process.stdout.write(`zara.typesafe-routing.v1/${scenario.id}: ${JSON.stringify({ expected: scenario.expected,
      observed: actual.matchedBranchId, confidence: actual.confidence, model: actual.providerAssessment?.model,
      latencyMs: actual.providerAssessment?.latencyMs })}\n`);
  }
  expect(errors).toBe(0);
}, 120_000);
