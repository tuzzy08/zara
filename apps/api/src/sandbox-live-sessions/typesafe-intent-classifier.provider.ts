import type { IntentClassifierOutput } from "@zara/core";
import { createHash } from "node:crypto";
import { TypeSafeError, type TypeSafeClient } from "../ai-judgements/typesafe-client";
import { redactText } from "../runtime-observability/runtime-observability";
import type { LiveSandboxIntentClassifier, LiveSandboxIntentClassifierInput } from "./sandbox-live-session-router";

export class TypeSafeIntentClassifierProvider implements LiveSandboxIntentClassifier {
  readonly availability = { configured: true, missingEnv: [] };

  constructor(private readonly client: Pick<TypeSafeClient, "evaluate">, readonly confidenceThreshold: number) {
    if (!Number.isFinite(confidenceThreshold) || confidenceThreshold < 0 || confidenceThreshold > 1) {
      throw new Error("TypeSafe intent confidence threshold must be between 0 and 1.");
    }
  }

  async classify(input: LiveSandboxIntentClassifierInput): Promise<IntentClassifierOutput> {
    if (input.latestCallerTurn.length > 2_000 || input.recentTranscript.length > 6 || input.recentTranscript.some((turn) => turn.text.length > 1_000)) {
      throw new Error("Intent classifier evidence exceeds the live limit.");
    }
    const criteria = Object.fromEntries(input.branches.map((branch, index) => [`b${index}`, redactText(`${branch.label}: ${branch.description}${branch.examples.length > 0 ? ` Examples: ${branch.examples.join("; ")}` : ""}`)]));
    criteria.no_match = "No configured branch clearly matches.";
    const result = await this.client.evaluate({
      state: {
        latestCallerTurn: redactText(input.latestCallerTurn),
        recentTranscript: input.recentTranscript.map(({ speaker, text }) => ({ speaker, text: redactText(text) })),
      },
      questions: {
        intent: {
          type: "choice",
          instructions: "Choose the one configured branch that clearly matches the caller's latest need. Handle negation. Choose no_match for unclear or mixed needs. Older turns are context only.",
          criteria,
        },
      },
      ...(input.abortSignal === undefined ? {} : { abortSignal: input.abortSignal }),
      timeoutMs: 1_500,
    });
    const answer = result.answers.intent;
    if (answer?.type !== "choice" || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1
      || (answer.choice !== "no_match" && !input.branches.some((_, index) => answer.choice === `b${index}`))) {
      throw new TypeSafeError("invalid_response");
    }
    const providerAssessment = {
      model: result.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      latencyMs: result.latencyMs,
      questionRevision: "intent-choice.v1",
      policyRevision: "intent-threshold.v1",
      sourceHash: createHash("sha256").update(JSON.stringify({ latestCallerTurn: input.latestCallerTurn, recentTranscript: input.recentTranscript, branches: input.branches })).digest("hex"),
    };
    const confidence = answer.confidence;
    const branch = input.branches.find((_, index) => answer.choice === `b${index}`);
    if (branch === undefined || confidence < this.confidenceThreshold) {
      return { matchedBranchId: null, intentKey: null, confidence, reason: "No configured branch met the TypeSafe intent threshold.", usedFallback: true, providerAssessment };
    }
    return { matchedBranchId: branch.id, intentKey: branch.intentKey, confidence, reason: `Matched configured branch '${branch.label}'.`, usedFallback: false, providerAssessment };
  }
}

export class ShadowTypeSafeIntentClassifierProvider implements LiveSandboxIntentClassifier {
  // ponytail: Four shadow requests cap load; use a worker only if measured volume needs it.
  private readonly pending = new Set<Promise<void>>();
  constructor(
    private readonly primary: LiveSandboxIntentClassifier,
    private readonly candidate: LiveSandboxIntentClassifier,
    private readonly sampleRate: number,
    private readonly record: (result: { status: "completed" | "failed"; turnId?: string; manifestId?: string; manifestVersion?: number; sourceHash: string; primaryBranchId?: string | null; candidateBranchId?: string | null; candidateConfidence?: number; providerAssessment?: IntentClassifierOutput["providerAssessment"] }) => void,
  ) {
    if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) {
      throw new Error("TypeSafe intent shadow sample rate must be between 0 and 1.");
    }
  }

  async classify(input: LiveSandboxIntentClassifierInput): Promise<IntentClassifierOutput> {
    const primary = await this.primary.classify(input);
    if (input.shadowAllowed === true && this.pending.size < 4 && Math.random() < this.sampleRate) {
      const identity = {
        ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
        ...(input.manifestId === undefined ? {} : { manifestId: input.manifestId }),
        ...(input.manifestVersion === undefined ? {} : { manifestVersion: input.manifestVersion }),
        questionRevision: "intent-choice.v1",
        policyRevision: "intent-shadow.v1",
        sourceHash: createHash("sha256").update(JSON.stringify({ latestCallerTurn: input.latestCallerTurn, recentTranscript: input.recentTranscript, branches: input.branches })).digest("hex"),
      };
      const task = this.candidate.classify(input).then(
        (candidate) => this.record({ status: "completed", ...identity, primaryBranchId: primary.matchedBranchId, candidateBranchId: candidate.matchedBranchId, candidateConfidence: candidate.confidence, providerAssessment: candidate.providerAssessment }),
        () => this.record({ status: "failed", ...identity }),
      ).catch(() => {});
      this.pending.add(task);
      void task.finally(() => this.pending.delete(task));
    }
    return primary;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled(this.pending);
  }
}
