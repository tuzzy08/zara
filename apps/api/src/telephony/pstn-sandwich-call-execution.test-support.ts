import { EventEmitter } from "node:events";
import { compileRuntimeManifest, createAgentRoleNode, createEndNode, createWorkflowGraph, publishWorkflowVersion } from "@zara/core";
import { AssemblyAiSttProvider } from "../sandbox-live-sessions/assemblyai-stt.provider";
import { CartesiaTtsProvider } from "../sandbox-live-sessions/cartesia-tts.provider";
import { OpenAiChatTextProvider } from "../sandbox-live-sessions/openai-chat-text.provider";
import { InMemoryPublishedWorkflowManifestRepository } from "../workflows/published-workflow-manifest.repository";
import type { TelephonyIncrementalRepository } from "./telephony-incremental.repository";
import { PstnSandwichCallExecution } from "./pstn-sandwich-call-execution";
import { defaultRuntimePromptPolicy } from "../runtime-prompt-policy/runtime-prompt-policy.models";

export async function createStandardPstnTestExecution(repository: TelephonyIncrementalRepository, audioBytes = 160) {
  const manifests = new InMemoryPublishedWorkflowManifestRepository();
  const graph = createWorkflowGraph({ id: "workflow-support", name: "Support", nodes: [
    { id: "entry", kind: "entry", label: "Call", position: { x: 0, y: 0 }, config: {} },
    createAgentRoleNode({ id: "agent-support", label: "Support", position: { x: 100, y: 0 },
      role: { name: "Jane", kind: "receptionist", businessName: "Shop", instructions: "Help the caller.",
        defaultModelTier: "cheap", languagePolicy: { defaultLanguage: "en", supportedLanguages: ["en"], allowMidCallSwitching: false } } }),
    createEndNode({ id: "end", label: "End", position: { x: 200, y: 0 }, end: { outcome: "resolved", closingMessage: "Goodbye." } }),
  ], edges: [{ id: "entry-support", sourceNodeId: "entry", targetNodeId: "agent-support" },
    { id: "support-end", sourceNodeId: "agent-support", targetNodeId: "end" }] });
  const publishedVersion = publishWorkflowVersion({ workflowId: graph.id, tenantId: "tenant-west-africa",
    workspaceId: "workspace-customer-success", environment: "production", createdBy: "test-operator", graph,
    existingVersions: [], runtime: "sandwich-pipeline", telephonyProvider: "twilio",
    memory: { mode: "scoped", retrievalScopes: ["session"], approvalRequired: true },
    budget: { monthlyCapUsd: 100, currentSpendUsd: 0, projectedCostPerMinuteUsd: 0.1, blockOnLimit: true } });
  const manifest = compileRuntimeManifest({ publishedVersion, modelRouting: [
    { id: "default", priority: 1, when: { callPhase: "discovery" }, useTier: "cheap", reason: "Phone support" },
  ], telemetry: { captureAudio: false, captureTranscript: false, redactSensitiveData: true, sinks: ["live-monitor"] } });
  await manifests.save({ ...manifest, publishedVersionId: "workflow-support-v1" });
  const sttSockets: StandardProviderTestSocket[] = [];
  const execution = new PstnSandwichCallExecution({ repository, manifests,
    promptPolicyService: { async selectPromptPolicyForSession() {
      return { revision: 1, hash: "test-policy-hash", policy: defaultRuntimePromptPolicy };
    } }, createProviders: () => ({
    stt: new AssemblyAiSttProvider({ apiKey: "test-only-key", websocketFactory: () => {
      const socket = new StandardProviderTestSocket("stt"); sttSockets.push(socket); return socket;
    } }),
    model: new OpenAiChatTextProvider({ apiKey: "test-only-key", fetch: async () => Response.json({
      choices: [{ message: { content: "Yes, we are open." } }],
    }) }),
    tts: new CartesiaTtsProvider({ apiKey: "test-only-key", apiVersion: "2026-03-01",
      websocketFactory: () => new StandardProviderTestSocket("tts", audioBytes) }),
  }) });
  return { execution, sttSockets };
}

export class StandardProviderTestSocket extends EventEmitter {
  readonly sent: Array<string | Buffer> = [];
  private closed = false;
  constructor(private readonly kind: "stt" | "tts", private readonly audioBytes = 160) {
    super();
    queueMicrotask(() => { this.emit("open"); if (kind === "stt") this.message({ type: "Begin", id: "test-stt-call" }); });
  }
  send(data: string | Buffer) {
    this.sent.push(data);
    if (typeof data !== "string") return;
    const payload = JSON.parse(data) as Record<string, unknown>;
    if (payload.type === "Terminate") {
      queueMicrotask(() => this.message({ type: "Termination", audio_duration_seconds: 1, session_duration_seconds: 2 }));
    } else if (this.kind === "tts") {
      queueMicrotask(() => {
        if (payload.continue === true) this.message({ type: "chunk", context_id: payload.context_id,
          data: Buffer.alloc(this.audioBytes, 127).toString("base64"), step_time: 20, done: false });
        else this.message({ type: "done", context_id: payload.context_id, done: true });
      });
    }
  }
  message(value: unknown) { if (!this.closed) this.emit("message", Buffer.from(JSON.stringify(value))); }
  close() { if (!this.closed) { this.closed = true; this.emit("close", 1000, Buffer.from("test close")); } }
}
