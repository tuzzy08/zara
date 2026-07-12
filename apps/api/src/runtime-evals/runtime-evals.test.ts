import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  loadRuntimeEvalFixtures,
  runtimeEvalDatasetIds,
  type RuntimeEvalExample,
} from "./runtime-eval-fixtures";
import {
  executePstnMediaEvalScenario,
  loadPstnMediaEvalFixtures,
  pstnMediaEvalDatasetId,
  scorePstnMediaEvalGate,
  scorePstnMediaEvalExample,
} from "./pstn-media-evals";
import {
  createLlmJudgeEvaluatorPlan,
  resolveRuntimeEvalRunConfig,
  scoreRuntimeEvalExample,
} from "./runtime-evaluators";

describe("runtime eval fixtures", () => {
  it("loads versioned packet fixture suites without raw sensitive data", () => {
    const fixtures = loadRuntimeEvalFixtures();

    expect(runtimeEvalDatasetIds).toEqual([
      "zara.intent-routing.v1",
      "zara.toolbelt.v1",
      "zara.transfer.v1",
      "zara.policy-guards.v1",
      "zara.end-to-end-call.v1",
    ]);
    expect(new Set(fixtures.map((fixture) => fixture.suite))).toEqual(new Set(runtimeEvalDatasetIds));
    expect(fixtures).toHaveLength(5);
    fixtures.forEach((fixture) => {
      expect(fixture.inputs.packet).toMatchObject({
        schemaVersion: "turn-runtime-packet.v1",
      });
      expect(fixture.inputs.manifestProjection).toMatchObject({
        manifestId: expect.any(String),
        version: expect.any(Number),
      });
    });

    const serialized = JSON.stringify(fixtures);
    expect(serialized).not.toContain("caller@example.com");
    expect(serialized).not.toContain("4242 4242 4242 4242");
    expect(serialized).not.toContain("secret://");
    expect(serialized).not.toContain("AUDIO_BASE64_PAYLOAD");
  });

  it("scores exact intent, target, fallback, tool, transfer, policy, and redaction outcomes", () => {
    const fixtures = loadRuntimeEvalFixtures();

    expect(score(fixture(fixtures, "intent-billing-route"), {
      selectedIntentKey: "billing",
      selectedTargetNodeId: "agent-billing",
      usedFallback: false,
      redactedTrace: "caller requested invoice help",
    }).scores).toMatchObject({
      exactSelectedIntent: 1,
      exactSelectedTarget: 1,
      fallbackBehavior: 1,
      redactionSafety: 1,
    });

    expect(score(fixture(fixtures, "toolbelt-missing-input"), {
      toolCallIds: [],
      missingInputRequested: true,
      redactedTrace: "asked caller for the missing order id",
    }).scores).toMatchObject({
      assignedToolOnly: 1,
      missingInputBehavior: 1,
      redactionSafety: 1,
    });

    expect(score(fixture(fixtures, "toolbelt-missing-input"), {
      toolCallIds: ["tool-order-status", "tool-unassigned-refund"],
      missingInputRequested: false,
      redactedTrace: "used an unassigned refund tool",
    }).scores).toMatchObject({
      assignedToolOnly: 0,
      missingInputBehavior: 0,
    });

    expect(score(fixture(fixtures, "transfer-billing-context"), {
      transferTargetAgentId: "agent-billing",
      transferContext: {
        sourceAgentId: "agent-front-desk",
        reason: "Caller needs invoice support.",
        callerNeedSummary: "Caller wants to dispute an invoice.",
        matchedIntentKey: "billing",
        safeToolSummaries: ["Account is active."],
      },
      redactedTrace: "billing transfer context only",
    }).scores).toMatchObject({
      transferTarget: 1,
      transferContext: 1,
      redactionSafety: 1,
    });

    expect(score(fixture(fixtures, "policy-guard-tool-output"), {
      policyWarnings: ["tool_output.untrusted", "agent_action.invalid"],
      redactedTrace: "safe summary without raw credential marker",
    }).scores).toMatchObject({
      policyWarnings: 1,
      redactionSafety: 1,
    });

    expect(score(fixture(fixtures, "end-to-end-contained-call"), {
      selectedIntentKey: "appointment",
      selectedTargetNodeId: "agent-scheduler",
      usedFallback: false,
      toolCallIds: ["tool-calendar-availability"],
      transferTargetAgentId: "agent-scheduler",
      transferContext: {
        sourceAgentId: "agent-front-desk",
        reason: "Caller wants to book an appointment.",
        callerNeedSummary: "Caller asked for tomorrow afternoon availability.",
        matchedIntentKey: "appointment",
        safeToolSummaries: ["Two appointment windows are available."],
      },
      policyWarnings: [],
      redactedTrace: "appointment routed and scheduled with safe tool output",
    }).passed).toBe(true);
  });
});

describe("runtime eval execution", () => {
  it("defines openevals judge wrappers for qualitative runtime behavior", () => {
    const plan = createLlmJudgeEvaluatorPlan({
      modelAlias: "eval-judge-local",
      promptVersion: "runtime-eval-judge.v1",
    });

    expect(plan.map((evaluator) => evaluator.scoreKey)).toEqual([
      "transfer_context_acknowledgement",
      "safe_tool_output_summary",
      "missing_input_question",
      "role_policy_adherence",
    ]);
    expect(plan.every((evaluator) => evaluator.library === "openevals")).toBe(true);
    expect(plan.every((evaluator) => typeof evaluator.createEvaluator === "function")).toBe(true);
    expect(plan.every((evaluator) => evaluator.promptVersion === "runtime-eval-judge.v1")).toBe(true);
  });

  it("resolves dry-run and LangSmith upload metadata separately from ordinary tests", () => {
    expect(resolveRuntimeEvalRunConfig({})).toMatchObject({
      upload: false,
      project: "zara-runtime-evals",
      datasetVersion: "v1",
      metadata: {
        packetSchema: "turn-runtime-packet.v1",
        modelAlias: "local-fixture",
        releaseVersion: "local",
      },
      tags: [
        "dataset:v1",
        "packet:turn-runtime-packet.v1",
        "model:local-fixture",
        "release:local",
      ],
    });

    expect(resolveRuntimeEvalRunConfig({
      LANGSMITH_TRACING: "true",
      LANGSMITH_API_KEY: "test-key",
      LANGSMITH_PROJECT: "zara-runtime-ci",
      RUNTIME_EVAL_DATASET_VERSION: "v1.2026-05-27",
      RUNTIME_EVAL_MODEL_ALIAS: "intent-classifier-fast",
      ZARA_RELEASE_VERSION: "release-2026-05-27",
    })).toMatchObject({
      upload: true,
      project: "zara-runtime-ci",
      datasetVersion: "v1.2026-05-27",
      metadata: {
        modelAlias: "intent-classifier-fast",
        releaseVersion: "release-2026-05-27",
      },
      tags: [
        "dataset:v1.2026-05-27",
        "packet:turn-runtime-packet.v1",
        "model:intent-classifier-fast",
        "release:release-2026-05-27",
      ],
    });
  });

  it("keeps runtime evals on a separate Vitest config and npm script", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    const evalConfig = readFileSync("ls.vitest.config.ts", "utf8");

    expect(packageJson.scripts["eval:runtime"]).toBe("vitest run --config ls.vitest.config.ts");
    expect(packageJson.scripts.test).toBe("vitest");
    expect(packageJson.scripts["test:run"]).toBe("vitest run");
    expect(evalConfig).toContain("**/runtime.eval.ts");
    expect(evalConfig).toContain("langsmith/vitest/reporter");
  });
});

describe("PSTN media eval execution", () => {
  it("loads distinct cost-optimized, OpenAI, and Gemini deterministic release gates", () => {
    const fixtures = loadPstnMediaEvalFixtures();

    expect(pstnMediaEvalDatasetId).toBe("zara.pstn-media.v1");
    expect(fixtures.filter((fixture) => fixture.inputs.releaseGate === "cost-optimized").map((fixture) => fixture.id)).toEqual([
      "pstn-clean-successful-phone-test",
      "pstn-no-frame-timeout",
      "pstn-tts-first-byte-timeout",
      "pstn-caller-barge-in",
      "pstn-provider-stop-before-response",
    ]);

    const premiumScenarios = [
      "normal-flow",
      "startup-buffering",
      "readiness-timeout",
      "congestion",
      "queue-overflow",
      "playback-overflow",
      "interruption",
      "handoff-replacement-failure",
      "cleanup",
      "runtime-provider-drift",
    ];

    for (const [releaseGate, runtimeProvider] of [
      ["premium-openai", "openai-realtime"],
      ["premium-gemini", "gemini-live"],
    ] as const) {
      const providerFixtures = fixtures.filter((fixture) => fixture.inputs.releaseGate === releaseGate);

      expect(providerFixtures.map((fixture) => fixture.inputs.scenarioKey)).toEqual(premiumScenarios);
      expect(providerFixtures).toHaveLength(premiumScenarios.length);
      providerFixtures.forEach((fixture) => {
        expect(fixture.inputs).toMatchObject({
          runtimePath: "pstn-premium-realtime",
          runtimeProvider,
        });
      });
    }

    const successful = fixtures.find((fixture) => fixture.id === "pstn-clean-successful-phone-test");
    if (successful === undefined) {
      throw new Error("Expected PSTN fixture.");
    }

    const scorecard = scorePstnMediaEvalExample(successful, {
      checklist: {
        verifiedWebhook: true,
        allowedCallerMatched: true,
        mediaWebSocketConnected: true,
        inboundFrameReceived: true,
        transcriptCreated: true,
        agentResponseGenerated: true,
        outboundAudioSent: true,
        cleanEnd: true,
        noFatalError: true,
      },
      latency: {
        firstResponseLatencyMs: 1180,
        firstResponseClassification: "good",
        ttsFirstByteLatencyMs: 320,
      },
      emittedSignals: [
        "webhook.received",
        "route.selected",
        "media.websocket_connected",
        "media.first_inbound_frame",
        "transcript.created",
        "tts.first_byte",
        "media.first_outbound_frame",
        "call.ended",
      ],
      releaseGate: "cost-optimized",
      runtimePath: "pstn-sandwich",
      runtimeProvider: "cost-optimized",
    });

    expect(scorecard.passed).toBe(true);
    expect(scorecard.scores).toMatchObject({
      checklist: 1,
      latencyClassification: 1,
      requiredSignals: 1,
      releaseGate: 1,
      runtimeIdentity: 1,
    });
  });

  it("fails an empty release gate instead of accepting zero observations", () => {
    const fixtures = loadPstnMediaEvalFixtures().filter(
      (fixture) => fixture.inputs.releaseGate !== "premium-gemini",
    );

    expect(scorePstnMediaEvalGate(fixtures, {}).gates["premium-gemini"]).toEqual({
      passed: false,
      passedCount: 0,
      totalCount: 0,
    });
  });

  it("derives provider overload observations from the premium call actor", async () => {
    const fixtures = loadPstnMediaEvalFixtures();

    for (const releaseGate of ["premium-openai", "premium-gemini"] as const) {
      const congestion = fixtures.find((fixture) => (
        fixture.inputs.releaseGate === releaseGate
        && fixture.inputs.scenarioKey === "congestion"
      ));
      if (congestion === undefined) throw new Error(`Expected ${releaseGate} congestion fixture.`);

      expect(scorePstnMediaEvalExample(
        congestion,
        await executePstnMediaEvalScenario(congestion),
      ).passed).toBe(true);
      expect(scorePstnMediaEvalExample(
        congestion,
        await executePstnMediaEvalScenario(congestion, { suppressProviderCongestion: true }),
      ).passed).toBe(false);
    }
  });

  it("fails stale-audio, completion-mark, and cleanup scenarios when observed behavior regresses", async () => {
    const fixtures = loadPstnMediaEvalFixtures();
    const premiumFixture = (scenarioKey: string) => {
      const match = fixtures.find((fixture) => (
        fixture.inputs.releaseGate === "premium-openai"
        && fixture.inputs.scenarioKey === scenarioKey
      ));
      if (match === undefined) throw new Error(`Expected premium fixture '${scenarioKey}'.`);
      return match;
    };

    const interruption = premiumFixture("interruption");
    const normalFlow = premiumFixture("normal-flow");
    const cleanup = premiumFixture("cleanup");

    expect(scorePstnMediaEvalExample(
      interruption,
      await executePstnMediaEvalScenario(interruption, { suppressInterruption: true }),
    ).passed).toBe(false);
    expect(scorePstnMediaEvalExample(
      normalFlow,
      await executePstnMediaEvalScenario(normalFlow, { suppressCompletionAcknowledgement: true }),
    ).passed).toBe(false);
    expect(scorePstnMediaEvalExample(
      cleanup,
      await executePstnMediaEvalScenario(cleanup, { suppressSecondStop: true }),
    ).passed).toBe(false);
  });

  it("fails only the affected provider gate when observed runtime identity drifts", async () => {
    const fixtures = loadPstnMediaEvalFixtures();
    const outputs = Object.fromEntries(await Promise.all(fixtures.map(async (fixture) => [
      fixture.id,
      await executePstnMediaEvalScenario(fixture),
    ])));
    const driftFixture = fixtures.find((fixture) => (
      fixture.inputs.releaseGate === "premium-openai"
      && fixture.inputs.scenarioKey === "runtime-provider-drift"
    ));
    if (driftFixture === undefined) {
      throw new Error("Expected OpenAI provider drift fixture.");
    }
    outputs[driftFixture.id] = await executePstnMediaEvalScenario(driftFixture, {
      runtimeProvider: "gemini-live",
    });

    expect(scorePstnMediaEvalGate(fixtures, outputs)).toEqual({
      passed: false,
      gates: {
        "cost-optimized": { passed: true, passedCount: 5, totalCount: 5 },
        "premium-openai": { passed: false, passedCount: 9, totalCount: 10 },
        "premium-gemini": { passed: true, passedCount: 10, totalCount: 10 },
      },
    });
  });

  it("keeps PSTN evals on a separate command and config from ordinary tests", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    const evalConfig = readFileSync("pstn.vitest.config.ts", "utf8");

    expect(packageJson.scripts["eval:pstn"]).toBe("vitest run --config pstn.vitest.config.ts");
    expect(evalConfig).toContain("**/*.pstn.eval.ts");
    expect(evalConfig).toContain("langsmith/vitest/reporter");
    expect(packageJson.scripts["test:run"]).toBe("vitest run");
  });
});

function fixture(fixtures: RuntimeEvalExample[], id: string): RuntimeEvalExample {
  const match = fixtures.find((candidate) => candidate.id === id);

  if (match === undefined) {
    throw new Error(`Fixture '${id}' was not found.`);
  }

  return match;
}

function score(fixture: RuntimeEvalExample, output: Record<string, unknown>) {
  return scoreRuntimeEvalExample(fixture, output);
}
