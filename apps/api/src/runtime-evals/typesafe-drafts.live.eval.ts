import { expect, it } from "vitest";
import { TypeSafeClient } from "../ai-judgements/typesafe-client";
import { InMemoryMemoryStateRepository } from "../memory/memory-state.repository";
import { MemoryService } from "../memory/memory.service";

// Synthetic held-out labels stay in this file. The provider receives only source text.
const memoryCases = [
  { id: "preference-without-keyword", turns: ["I am vegetarian."], expected: "caller" },
  { id: "temporary-need", turns: ["I need a taxi for today."], expected: "none" },
  { id: "third-party-quote", turns: ["My sister said she is vegetarian."], expected: "none" },
  { id: "later-correction", turns: ["I prefer SMS.", "Please note that.", "Actually, use email instead."], expected: "none" },
  { id: "negation", turns: ["I never said I prefer phone calls."], expected: "none" },
  { id: "account-fact", turns: ["Our renewal date is 15 October."], accountId: "account-1", expected: "account" },
] as const;

const knowledgeCases = [
  { id: "refund-procedure", title: "Refund procedure", text: "First confirm eligibility. Then issue the refund.", expected: "procedure" },
  { id: "price-list", title: "Price list", text: "The basic service costs 20 USD per month.", expected: "pricing" },
  { id: "escalation", title: "Help route", text: "When the first agent cannot resolve a case, send it to a supervisor.", expected: "escalation" },
  { id: "mixed-policy", title: "Mixed notes", text: "Office hours are 9 to 5. Staff must confirm identity before sharing an invoice. See the equipment guide for setup.", expected: "general_reference" },
] as const;

it("compares TypeSafe draft suggestions with the current rules", async () => {
  const apiKey = process.env.TYPESAFE_API_KEY;
  const model = process.env.TYPESAFE_MODEL;
  if (!apiKey || !model) throw new Error("TYPESAFE_API_KEY and TYPESAFE_MODEL are required for the paid TypeSafe evaluation.");
  const client = new TypeSafeClient({ apiKey, model });
  let modelErrors = 0;
  let ruleErrors = 0;
  for (const scenario of memoryCases) {
    const input = {
      actorUserId: "eval-operator", callSessionId: scenario.id, transcriptId: scenario.id,
      callerIdentity: { kind: "phone" as const, value: "+2348000000000" },
      ...( "accountId" in scenario ? { accountId: scenario.accountId } : {}), optIn: true,
      transcript: scenario.turns.map((text, index) => ({ id: `turn-${index}`, speaker: "caller" as const, text })),
    };
    const enabled = new MemoryService(new InMemoryMemoryStateRepository(), undefined, undefined, undefined,
      { client, memoryMode: "enabled", knowledgeMode: "off" });
    const baseline = new MemoryService(new InMemoryMemoryStateRepository());
    const enabledResult = await enabled.extractMemoryDrafts("eval-tenant", input);
    const actual = enabledResult.drafts
      .find((draft) => draft.source.transcriptEventIds?.includes("turn-0"))?.scope ?? "none";
    const rule = (await baseline.extractMemoryDrafts("eval-tenant", input)).drafts
      .find((draft) => draft.source.transcriptEventIds?.includes("turn-0"))?.scope ?? "none";
    modelErrors += Number(actual !== scenario.expected);
    ruleErrors += Number(rule !== scenario.expected);
    process.stdout.write(`${scenario.id}: ${JSON.stringify({ expected: scenario.expected, actual, rule,
      model: enabledResult.judgmentMetadata?.model, usage: enabledResult.judgmentMetadata && {
        inputTokens: enabledResult.judgmentMetadata.inputTokens,
        outputTokens: enabledResult.judgmentMetadata.outputTokens,
        latencyMs: enabledResult.judgmentMetadata.latencyMs,
      } })}\n`);
  }
  for (const scenario of knowledgeCases) {
    const input = { actorUserId: "eval-operator", sourceType: "pdf" as const,
      workspaceId: "eval-workspace", title: scenario.title, text: scenario.text };
    const enabled = new MemoryService(new InMemoryMemoryStateRepository(), undefined, undefined, undefined,
      { client, memoryMode: "off", knowledgeMode: "enabled" });
    const baseline = new MemoryService(new InMemoryMemoryStateRepository());
    const enabledDraft = (await enabled.createKnowledgeSource("eval-tenant", input)).reviewDrafts[0];
    const actual = enabledDraft?.suggestedKind;
    const rule = (await baseline.createKnowledgeSource("eval-tenant", input)).reviewDrafts[0]?.suggestedKind;
    modelErrors += Number(actual !== scenario.expected);
    ruleErrors += Number(rule !== scenario.expected);
    process.stdout.write(`${scenario.id}: ${JSON.stringify({ expected: scenario.expected, actual, rule,
      model: enabledDraft?.kindAssessment?.model,
      usage: enabledDraft?.kindAssessment && {
        inputTokens: enabledDraft.kindAssessment.inputTokens,
        outputTokens: enabledDraft.kindAssessment.outputTokens,
        latencyMs: enabledDraft.kindAssessment.latencyMs,
      } })}\n`);
  }
  process.stdout.write(`Draft error counts: ${JSON.stringify({ cases: memoryCases.length + knowledgeCases.length, modelErrors, ruleErrors })}\n`);
  expect(modelErrors).toBeLessThan(ruleErrors);
}, 120_000);
