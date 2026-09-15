import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  compileRuntimeManifest, createAgentRoleNode, createConditionNode, createEndNode, createWorkflowGraph, publishWorkflowVersion,
  type PstnAudioFrame,
} from "@zara/core";
import { AssemblyAiSttProvider } from "../sandbox-live-sessions/assemblyai-stt.provider";
import { CartesiaTtsProvider } from "../sandbox-live-sessions/cartesia-tts.provider";
import { createLiveSandboxTextModelProvider } from "../sandbox-live-sessions/sandbox-text-model-provider-factory";
import { resolveLiveSandboxProviderConfig } from "../sandbox-live-sessions/sandbox-live-env";
import { RuntimeAgentToolExecutorService } from "../sandbox-live-sessions/runtime-agent-tool-executor.service";
import { DefaultLiveSandboxToolRegistry } from "../sandbox-live-sessions/sandbox-live-sessions.providers";
import { ToolPermissionGrantsService } from "../integrations/tool-permission-grants.service";
import { GeminiIntentClassifierProvider } from "../sandbox-live-sessions/sandbox-intent-classifier.provider";
import { createRuntimeObservabilityRecorder, type LangSmithRuntimeTraceProjection } from "../runtime-observability/runtime-observability";
import { ProviderUsageRecordingRepository } from "../billing/provider-usage-recording.repository";
import { usageRecordingTestPool } from "../billing/provider-usage-recording.test-support";
import { InMemoryPublishedWorkflowManifestRepository } from "../workflows/published-workflow-manifest.repository";
import { InMemoryTelephonyIncrementalRepository } from "./telephony-incremental.repository.test-helper";
import { PstnSandwichCallExecution } from "./pstn-sandwich-call-execution";
import { defaultRuntimePromptPolicy } from "../runtime-prompt-policy/runtime-prompt-policy.models";
import { PstnPremiumPlaybackAdmission } from "./pstn-premium-playback-admission";

describe("standard PSTN call execution", () => {
  afterEach(() => vi.useRealTimers());

  it("finishes call stop while an opening speech socket is still closing", async () => {
    const harness = await createHarness({ deferredTtsClose: true });
    try {
      const started = harness.execution.start(harness.start);
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const socket = harness.connections[0]!.socket;
      socket.emit("open"); socket.message({ type: "Begin", id: "provider-call-a" }); await started;
      socket.message({ type: "Turn", turn_order: 0, transcript: "Hello", end_of_turn: true });
      await vi.waitFor(() => expect(harness.ttsConnections).toHaveLength(1));
      const stopping = harness.execution.stop(harness.start).then(() => "stopped");
      socket.message({ type: "Termination", audio_duration_seconds: 1, session_duration_seconds: 2 });
      expect(await Promise.race([stopping, new Promise(resolve => setTimeout(() => resolve("pending"), 100))])).toBe("stopped");
      expect(harness.ttsConnections[0]!.sent).toEqual([]);
    } finally {
      harness.ttsConnections[0]?.emit("close", 1000, Buffer.from("stopped"));
      await harness.cleanup();
    }
  });

  it("keeps replacement speech alive when the interrupted socket closes late", async () => {
    const harness = await createHarness({ deferredTtsClose: true });
    try {
      const started = harness.execution.start(harness.start);
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const socket = harness.connections[0]!.socket;
      socket.emit("open"); socket.message({ type: "Begin", id: "provider-call-a" }); await started;
      socket.message({ type: "Turn", turn_order: 0, transcript: "Hello", end_of_turn: true });
      await vi.waitFor(() => expect(harness.ttsConnections).toHaveLength(1));
      const oldTts = harness.ttsConnections[0]!;
      oldTts.emit("open"); await vi.waitFor(() => expect(oldTts.sent.length).toBeGreaterThan(0));
      oldTts.message({ type: "chunk", context_id: "ctx-1", data: Buffer.alloc(160, 127).toString("base64"), step_time: 20, done: false });
      await vi.waitFor(() => expect(harness.output.media).toHaveLength(1));
      socket.message({ type: "SpeechStarted" });
      socket.message({ type: "Turn", turn_order: 1, transcript: "Thank you", end_of_turn: true });
      await vi.waitFor(() => expect(harness.ttsConnections).toHaveLength(2));
      const replacement = harness.ttsConnections[1]!;
      replacement.emit("open"); await vi.waitFor(() => expect(replacement.sent.length).toBeGreaterThan(0));
      oldTts.emit("close", 1000, Buffer.from("interrupted"));
      replacement.message({ type: "chunk", context_id: "ctx-2", data: Buffer.alloc(160, 127).toString("base64"), step_time: 20, done: false });
      replacement.message({ type: "done", context_id: "ctx-2", done: true });
      await vi.waitFor(() => expect(harness.output.media).toHaveLength(2));
      expect(harness.output.closes).toEqual([]);
    } finally { await harness.cleanup(); }
  });

  it("cancels a response while its phone checkpoint is being saved", async () => {
    let release!: () => void;
    let saving = false;
    let modelRequests = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const harness = await createHarness({ checkpointWrite: async () => { saving = true; await gate; },
      modelFetch: async () => { modelRequests += 1; return Response.json({ choices: [{ message: { content: "Hello" } }] }); } });
    try {
      const started = harness.execution.start(harness.start);
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const socket = harness.connections[0]!.socket;
      socket.emit("open"); socket.message({ type: "Begin", id: "provider-call-a" }); await started;
      socket.message({ type: "Turn", turn_order: 0, transcript: "Hello", end_of_turn: true });
      await vi.waitFor(() => expect(saving).toBe(true));
      socket.message({ type: "SpeechStarted" });
      release();
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(modelRequests).toBe(0);
      expect(harness.ttsConnections).toEqual([]);
    } finally { release(); await harness.cleanup(); }
  });

  it("retains a failed lifecycle result after provider cleanup", async () => {
    const harness = await createHarness();
    try {
      const started = harness.execution.start(harness.start);
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const socket = harness.connections[0]!.socket;
      socket.emit("open"); socket.message({ type: "Begin", id: "provider-call-a" }); await started;
      socket.emit("error", new Error("provider disconnected"));
      const stopping = harness.execution.stop(harness.start);
      socket.message({ type: "Termination", audio_duration_seconds: 1, session_duration_seconds: 2 });
      expect(await stopping).toMatchObject({ status: "failed" });
    } finally { await harness.cleanup(); }
  });

  it("shares queued speech capacity across calls and releases it on stop", async () => {
    const admission = new PstnPremiumPlaybackAdmission(160);
    const first = await createHarness({ playbackAdmission: admission });
    const second = await createHarness({ playbackAdmission: admission });
    try {
      for (const harness of [first, second]) {
        const started = harness.execution.start(harness.start);
        await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
        const socket = harness.connections[0]!.socket;
        socket.emit("open"); socket.message({ type: "Begin", id: "provider-call-a" }); await started;
        socket.message({ type: "Turn", turn_order: 0, transcript: "Hello", end_of_turn: true });
        await vi.waitFor(() => expect(harness.ttsConnections).toHaveLength(1));
        const tts = harness.ttsConnections[0]!;
        tts.emit("open"); await vi.waitFor(() => expect(tts.sent.length).toBeGreaterThan(0));
        tts.message({ type: "chunk", context_id: "ctx-1", data: Buffer.alloc(8160, 127).toString("base64"), step_time: 20, done: false });
        tts.message({ type: "done", context_id: "ctx-1", done: true });
      }
      await vi.waitFor(() => expect(second.output.closes).toEqual(["standard_call_provider_failed"]));
      expect(first.output.closes).toEqual([]);
      const stopping = first.execution.stop(first.start);
      first.connections[0]!.socket.message({ type: "Termination", audio_duration_seconds: 1, session_duration_seconds: 2 });
      await stopping;
      expect(admission.getResidentBytes()).toBe(0);
    } finally { await first.cleanup(); await second.cleanup(); }
  });

  it("does not send speech after a stopped call finishes voice lookup", async () => {
    let release!: (voice: string) => void;
    let lookupStarted = false;
    const harness = await createHarness({ voiceLookup: () => {
      lookupStarted = true; return new Promise(resolve => { release = resolve; });
    } });
    try {
      const started = harness.execution.start(harness.start);
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const socket = harness.connections[0]!.socket;
      socket.emit("open"); socket.message({ type: "Begin", id: "provider-call-a" }); await started;
      socket.message({ type: "Turn", turn_order: 0, transcript: "Hello", end_of_turn: true });
      await vi.waitFor(() => expect(harness.ttsConnections).toHaveLength(1));
      const tts = harness.ttsConnections[0]!;
      tts.emit("open"); await vi.waitFor(() => expect(lookupStarted).toBe(true));
      const stopping = harness.execution.stop(harness.start);
      socket.message({ type: "Termination", audio_duration_seconds: 1, session_duration_seconds: 2 });
      await stopping;
      release("provider-voice-a");
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(tts.sent).toEqual([]);
    } finally { release?.("provider-voice-a"); await harness.cleanup(); }
  });

  it("closes the call safely on malformed TTS provider JSON", async () => {
    const harness = await createHarness();
    try {
      const started = harness.execution.start(harness.start);
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const socket = harness.connections[0]!.socket;
      socket.emit("open"); socket.message({ type: "Begin", id: "provider-call-a" }); await started;
      socket.message({ type: "Turn", turn_order: 0, transcript: "Hello", end_of_turn: true });
      await vi.waitFor(() => expect(harness.ttsConnections).toHaveLength(1));
      const tts = harness.ttsConnections[0]!;
      tts.emit("open"); await vi.waitFor(() => expect(tts.sent.length).toBeGreaterThan(0));
      expect(() => tts.emit("message", Buffer.from("{bad-json"))).not.toThrow();
      await vi.waitFor(() => expect(harness.output.closes).toEqual(["standard_call_provider_failed"]));
    } finally { await harness.cleanup(); }
  });

  it.each([false, true])("bounds speech completion and unacknowledged playback (provider done: %s)", async providerDone => {
    const harness = await createHarness();
    try {
      const started = harness.execution.start(harness.start);
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const socket = harness.connections[0]!.socket;
      socket.emit("open"); socket.message({ type: "Begin", id: "provider-call-a" }); await started;
      socket.message({ type: "Turn", turn_order: 0, transcript: "Hello", end_of_turn: true });
      await vi.waitFor(() => expect(harness.ttsConnections).toHaveLength(1));
      const tts = harness.ttsConnections[0]!;
      tts.emit("open"); await vi.waitFor(() => expect(tts.sent.length).toBeGreaterThan(0));
      vi.useFakeTimers();
      tts.message({ type: "chunk", context_id: "ctx-1", data: Buffer.alloc(160, 127).toString("base64"), step_time: 20, done: false });
      if (providerDone) tts.message({ type: "done", context_id: "ctx-1", done: true });
      await vi.advanceTimersByTimeAsync(0);
      for (let second = 0; second < 30; second += 1) {
        harness.execution.appendAudio({ ...harness.start, audioBase64: Buffer.alloc(160, 127).toString("base64") });
        await vi.advanceTimersByTimeAsync(1000);
      }
      expect(harness.output.closes).toEqual(["standard_call_provider_failed"]);
      expect(tts.closed).toBe(true);
    } finally { vi.useRealTimers(); await harness.cleanup(); }
  });

  it("ends an intent request after eight seconds while caller media continues", async () => {
    let requestSignal: AbortSignal | null | undefined;
    const harness = await createHarness({ intentRoute: true, classifierFetch: async (_url, init) => {
      requestSignal = init?.signal;
      return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    } });
    try {
      const started = harness.execution.start(harness.start);
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const socket = harness.connections[0]!.socket;
      socket.emit("open"); socket.message({ type: "Begin", id: "provider-call-a" }); await started;
      vi.useFakeTimers();
      socket.message({ type: "Turn", turn_order: 0, transcript: "I was charged twice.", end_of_turn: true });
      await vi.advanceTimersByTimeAsync(0);
      for (let second = 0; second < 8; second += 1) {
        harness.execution.appendAudio({ ...harness.start, audioBase64: Buffer.alloc(160, 127).toString("base64") });
        await vi.advanceTimersByTimeAsync(1000);
      }
      expect(harness.output.closes).toEqual(["standard_call_provider_failed"]);
      expect(requestSignal?.aborted).toBe(true);
    } finally { vi.useRealTimers(); await harness.cleanup(); }
  });

  it("ignores a repeated provider readiness message", async () => {
    const harness = await createHarness();
    try {
      const started = harness.execution.start(harness.start);
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const socket = harness.connections[0]!.socket;
      socket.emit("open"); socket.message({ type: "Begin", id: "provider-call-a" }); await started;
      expect(() => socket.message({ type: "Begin", id: "provider-call-a" })).not.toThrow();
      expect(harness.output.closes).toEqual([]);
    } finally { await harness.cleanup(); }
  });

  it("ends a ready call after five seconds without any inbound media frames", async () => {
    const harness = await createHarness();
    try {
      const started = harness.execution.start(harness.start);
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const socket = harness.connections[0]!.socket;
      vi.useFakeTimers();
      socket.emit("open"); socket.message({ type: "Begin", id: "provider-call-a" }); await started;
      await vi.advanceTimersByTimeAsync(4999);
      expect(harness.output.closes).toEqual([]);
      harness.execution.appendAudio({ ...harness.start, audioBase64: Buffer.alloc(160, 127).toString("base64") });
      await vi.advanceTimersByTimeAsync(4999);
      expect(harness.output.closes).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(harness.output.closes).toEqual(["standard_call_provider_failed"]);
    } finally { vi.useRealTimers(); await harness.cleanup(); }
  });

  it("cancels a pending intent request when the call stops", async () => {
    let requestSignal: AbortSignal | null | undefined;
    let classifierStarted = false;
    const harness = await createHarness({ intentRoute: true, classifierFetch: async (_url, init) => {
      classifierStarted = true; requestSignal = init?.signal;
      return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    } });
    try {
      const started = harness.execution.start(harness.start);
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const socket = harness.connections[0]!.socket;
      socket.emit("open"); socket.message({ type: "Begin", id: "provider-call-a" }); await started;
      socket.message({ type: "Turn", turn_order: 0, transcript: "I was charged twice.", end_of_turn: true });
      await vi.waitFor(() => expect(classifierStarted).toBe(true));
      const stopping = harness.execution.stop(harness.start);
      expect(requestSignal?.aborted).toBe(true);
      socket.message({ type: "Termination", audio_duration_seconds: 1, session_duration_seconds: 2 });
      await stopping;
      expect(harness.ttsConnections).toEqual([]);
    } finally { await harness.cleanup(); }
  });

  it("does not start a tool from a late model response after call stop", async () => {
    let respond!: (response: Response) => void;
    let modelStarted = false;
    let permissionReads = 0;
    const harness = await createHarness({ toolbelt: true, permissionRead: () => { permissionReads += 1; }, modelFetch: async () => {
      modelStarted = true; return new Promise(resolve => { respond = resolve; });
    } });
    try {
      const started = harness.execution.start(harness.start);
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const socket = harness.connections[0]!.socket;
      socket.emit("open"); socket.message({ type: "Begin", id: "provider-call-a" }); await started;
      socket.message({ type: "Turn", turn_order: 0, transcript: "Find my ticket.", end_of_turn: true });
      await vi.waitFor(() => expect(modelStarted).toBe(true));
      const stopping = harness.execution.stop(harness.start);
      respond(Response.json({ choices: [{ message: { content: JSON.stringify({ action: { type: "call_tool", toolCallId: "lookup-1",
        toolAssignmentId: "agent-a:search", arguments: { query: "open tickets" }, reason: "Find ticket" } }) } }] }));
      socket.message({ type: "Termination", audio_duration_seconds: 1, session_duration_seconds: 2 });
      await stopping;
      expect(permissionReads).toBe(0);
    } finally { await harness.cleanup(); }
  });

  it("waits for an in-flight tool operation to finish before call cleanup completes", async () => {
    let release!: () => void;
    const permissionGate = new Promise<void>(resolve => { release = resolve; });
    let permissionRead = false;
    const harness = await createHarness({ toolbelt: true, permissionRead: async () => { permissionRead = true; await permissionGate; },
      modelFetch: async () => Response.json({ choices: [{ message: { content: JSON.stringify({ action: { type: "call_tool", toolCallId: "lookup-1",
        toolAssignmentId: "agent-a:search", arguments: { query: "open tickets" }, reason: "Find ticket" } }) } }] }) });
    try {
      const started = harness.execution.start(harness.start);
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const socket = harness.connections[0]!.socket;
      socket.emit("open"); socket.message({ type: "Begin", id: "provider-call-a" }); await started;
      socket.message({ type: "Turn", turn_order: 0, transcript: "Find my ticket.", end_of_turn: true });
      await vi.waitFor(() => expect(permissionRead).toBe(true));
      let stopped = false;
      const stopping = harness.execution.stop(harness.start).then(() => { stopped = true; });
      socket.message({ type: "Termination", audio_duration_seconds: 1, session_duration_seconds: 2 });
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(stopped).toBe(false);
      release(); await stopping;
      expect(stopped).toBe(true);
      expect(harness.ttsConnections).toEqual([]);
    } finally { release(); await harness.cleanup(); }
  });

  it("closes a terminal workflow only after the goodbye playback is acknowledged", async () => {
    const harness = await createHarness();
    try {
      const started = harness.execution.start(harness.start);
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const socket = harness.connections[0]!.socket;
      socket.emit("open"); socket.message({ type: "Begin", id: "provider-call-a" }); await started;
      socket.message({ type: "Turn", turn_order: 0, transcript: "Hello", end_of_turn: true });
      await vi.waitFor(() => expect(harness.ttsConnections).toHaveLength(1));
      const tts = harness.ttsConnections[0]!;
      tts.emit("open"); await vi.waitFor(() => expect(tts.sent.length).toBeGreaterThan(0));
      tts.message({ type: "done", context_id: "ctx-1", done: true });
      await vi.waitFor(() => expect(harness.output.marks).toHaveLength(1));
      harness.execution.acknowledgePlaybackMark({ ...harness.start, name: harness.output.marks[0]! });
      socket.message({ type: "Turn", turn_order: 1, transcript: "Thank you", end_of_turn: true });
      await vi.waitFor(() => expect(tts.sent.some(value => JSON.parse(String(value)).transcript === "Goodbye.")).toBe(true));
      tts.message({ type: "chunk", context_id: "ctx-2", data: Buffer.alloc(160, 127).toString("base64"), step_time: 20, done: false });
      tts.message({ type: "done", context_id: "ctx-2", done: true });
      await vi.waitFor(() => expect(harness.output.marks).toHaveLength(3));
      expect(harness.output.closes).toEqual([]);
      harness.execution.acknowledgePlaybackMark({ ...harness.start, name: harness.output.marks[1]! });
      expect(harness.output.closes).toEqual([]);
      harness.execution.acknowledgePlaybackMark({ ...harness.start, name: harness.output.marks[2]! });
      expect(harness.output.closes).toEqual(["standard_call_completed"]);
    } finally { await harness.cleanup(); }
  });

  it("closes a call instead of retaining more than two pending final turns", async () => {
    const harness = await createHarness();
    try {
      const started = harness.execution.start(harness.start);
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const socket = harness.connections[0]!.socket;
      socket.emit("open"); socket.message({ type: "Begin", id: "provider-call-a" }); await started;
      for (let turn = 0; turn < 3; turn += 1) socket.message({ type: "Turn", turn_order: turn, transcript: "Hello", end_of_turn: true });
      expect(harness.output.closes).toEqual(["standard_call_provider_failed"]);
      socket.message({ type: "Termination", audio_duration_seconds: 0, session_duration_seconds: 1 });
    } finally { await harness.cleanup(); }
  });

  it.each(["{invalid-json", "null", "[]"])("closes only the affected call on an invalid STT provider message (%s)", async payload => {
    const harness = await createHarness();
    try {
      const started = harness.execution.start(harness.start);
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const socket = harness.connections[0]!.socket;
      socket.emit("open"); socket.message({ type: "Begin", id: "provider-call-a" }); await started;
      expect(() => socket.emit("message", Buffer.from(payload))).not.toThrow();
      expect(harness.output.closes).toEqual(["standard_call_provider_failed"]);
      socket.message({ type: "Termination", audio_duration_seconds: 0, session_duration_seconds: 1 });
    } finally { await harness.cleanup(); }
  });

  it("does not open a provider after stop during dispatch loading", async () => {
    let release!: () => void;
    const readGate = new Promise<void>(resolve => { release = resolve; });
    const harness = await createHarness({ readGate });
    try {
      const result = harness.execution.start(harness.start).then(() => "started", () => "rejected");
      await harness.execution.stop(harness.start);
      release();
      expect(await Promise.race([result, new Promise(resolve => setTimeout(() => resolve("pending"), 100))])).toBe("rejected");
      expect(harness.connections).toEqual([]);
    } finally { await harness.cleanup(); }
  });

  it("rejects a duplicate start while the first start is still loading", async () => {
    const harness = await createHarness();
    try {
      const first = harness.execution.start(harness.start);
      const second = harness.execution.start(harness.start).then(() => "started", () => "rejected");
      await vi.waitFor(() => expect(harness.connections.length).toBeGreaterThan(0));
      for (const { socket } of harness.connections) {
        socket.emit("open"); socket.message({ type: "Begin", id: "provider-call-a" });
      }
      await first;
      expect(await second).toBe("rejected");
      expect(harness.connections).toHaveLength(1);
    } finally { await harness.cleanup(); }
  });

  it("uses the configured intent classifier for a published condition route", async () => {
    const modelBodies: string[] = [];
    const harness = await createHarness({ intentRoute: true, modelFetch: async (_url, init) => {
      modelBodies.push(String(init?.body)); return Response.json({ choices: [{ message: { content: "Let me check the charge." } }] });
    } });
    try {
      const started = harness.execution.start(harness.start);
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const socket = harness.connections[0]!.socket;
      socket.emit("open"); socket.message({ type: "Begin", id: "provider-call-a" }); await started;
      socket.message({ type: "Turn", turn_order: 0, transcript: "I was charged twice.", end_of_turn: true });
      await vi.waitFor(() => expect(modelBodies).toHaveLength(1));
      expect(JSON.parse(modelBodies[0]!).messages[0].content).toContain('"agentId":"agent-b"');
    } finally { await harness.cleanup(); }
  });

  it("starts and stops a manifest-pinned phone session through the shared call lifecycle", async () => {
    const harness = await createHarness();
    try {
      const started = harness.execution.start(harness.start);
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const socket = harness.connections[0]!.socket;
      socket.emit("open"); socket.message({ type: "Begin", id: "provider-call-a" });
      expect(await started).toMatchObject({ callSessionId: "call-a", tenantId: "tenant-a", workspaceId: "workspace-a",
        sourceMode: "pstn", status: "listening", publishedVersionId: harness.manifest.publishedVersionId });
      const stopped = harness.execution.stop(harness.start);
      socket.message({ type: "Termination", audio_duration_seconds: 0, session_duration_seconds: 1 });
      expect(await stopped).toMatchObject({ status: "ended", callSessionId: "call-a" });
    } finally { await harness.cleanup(); }
  });

  it("waits for the transfer announcement playback before the target agent continues", async () => {
    const modelBodies: string[] = [];
    const harness = await createHarness({ handoff: true, modelFetch: async (_url, init) => {
      modelBodies.push(String(init?.body));
      return Response.json({ choices: [{ message: { content: modelBodies.length === 1
        ? JSON.stringify({ action: { type: "handoff_to_agent", targetAgentId: "agent-b", reason: "Billing help", callerNeedSummary: "Explain invoice INV-1042" } })
        : "I can help with your invoice." } }] });
    } });
    try {
      const started = harness.execution.start(harness.start);
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const socket = harness.connections[0]!.socket;
      socket.emit("open"); socket.message({ type: "Begin", id: "provider-call-a" }); await started;
      socket.message({ type: "Turn", turn_order: 0, transcript: "Explain my invoice.", end_of_turn: true });
      await vi.waitFor(() => expect(harness.ttsConnections).toHaveLength(1));
      const tts = harness.ttsConnections[0]!;
      tts.emit("open");
      await vi.waitFor(() => expect(tts.sent.length).toBeGreaterThan(0));
      expect(JSON.parse(String(tts.sent[0])).transcript).toBe("I will connect you with Billing.");
      tts.message({ type: "chunk", context_id: "ctx-1", data: Buffer.alloc(160, 127).toString("base64"), step_time: 20, done: false });
      tts.message({ type: "done", context_id: "ctx-1", done: true });
      await vi.waitFor(() => expect(harness.output.marks).toHaveLength(2));
      expect(modelBodies).toHaveLength(1);
      for (const name of [...harness.output.marks]) harness.execution.acknowledgePlaybackMark({ ...harness.start, name });
      await vi.waitFor(() => expect(modelBodies).toHaveLength(2));
      expect(JSON.parse(modelBodies[1]!).messages[0].content).toContain('"agentId":"agent-b"');
      expect(modelBodies[1]).toContain("Explain invoice INV-1042");
    } finally { await harness.cleanup(); }
  });

  it("cancels a model request that exceeds eight seconds", async () => {
    let modelStarted = false;
    const harness = await createHarness({ modelFetch: async (_url, init) => {
      modelStarted = true;
      return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    } });
    try {
      const started = harness.execution.start(harness.start);
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const socket = harness.connections[0]!.socket;
      socket.emit("open"); socket.message({ type: "Begin", id: "provider-call-a" }); await started;
      vi.useFakeTimers();
      socket.message({ type: "Turn", turn_order: 0, transcript: "Hello", end_of_turn: true });
      await vi.waitFor(() => expect(modelStarted).toBe(true));
      await vi.advanceTimersByTimeAsync(8000);
      expect(harness.output.closes).toEqual(["standard_call_provider_failed"]);
      expect(harness.ttsConnections).toEqual([]);
    } finally { vi.useRealTimers(); await harness.cleanup(); }
  });

  it("ends a call when speech output has no first audio after two seconds", async () => {
    const harness = await createHarness();
    try {
      const started = harness.execution.start(harness.start);
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const socket = harness.connections[0]!.socket;
      socket.emit("open"); socket.message({ type: "Begin", id: "provider-call-a" }); await started;
      vi.useFakeTimers();
      socket.message({ type: "Turn", turn_order: 0, transcript: "Hello", end_of_turn: true });
      await vi.waitFor(() => expect(harness.ttsConnections).toHaveLength(1));
      await vi.advanceTimersByTimeAsync(2000);
      expect(harness.output.closes).toEqual(["standard_call_provider_failed"]);
      expect(harness.ttsConnections[0]!.closed).toBe(true);
    } finally { vi.useRealTimers(); await harness.cleanup(); }
  });

  it("stops the model tool loop after two tool requests", async () => {
    let modelRequests = 0;
    const harness = await createHarness({ toolbelt: true, modelFetch: async () => {
      modelRequests += 1;
      return Response.json({ choices: [{ message: { content: JSON.stringify({ action: modelRequests <= 3
        ? { type: "call_tool", toolCallId: `lookup-${modelRequests}`, toolAssignmentId: "agent-a:search", arguments: { query: "open tickets" }, reason: "Find ticket" }
        : { type: "respond", responseText: "Unexpected extra model request." } }) } }] });
    } });
    try {
      const started = harness.execution.start(harness.start);
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const socket = harness.connections[0]!.socket;
      socket.emit("open"); socket.message({ type: "Begin", id: "provider-call-a" }); await started;
      socket.message({ type: "Turn", turn_order: 0, transcript: "Find my ticket.", end_of_turn: true });
      await vi.waitFor(() => expect(harness.ttsConnections).toHaveLength(1));
      expect(modelRequests).toBe(3);
    } finally { await harness.cleanup(); }
  });

  it("runs structured tool requests through tenant grants and speaks only the final response", async () => {
    const modelBodies: string[] = [];
    const harness = await createHarness({ toolbelt: true, modelFetch: async (_url, init) => {
      modelBodies.push(String(init?.body));
      return Response.json({ choices: [{ message: { content: modelBodies.length === 1
        ? JSON.stringify({ action: { type: "call_tool", toolCallId: "lookup-1", toolAssignmentId: "agent-a:search", arguments: { query: "open tickets" }, reason: "Find caller ticket" } })
        : JSON.stringify({ action: { type: "respond", responseText: "I cannot access the ticket system." } }) } }] });
    } });
    try {
      const started = harness.execution.start(harness.start);
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const socket = harness.connections[0]!.socket;
      socket.emit("open"); socket.message({ type: "Begin", id: "provider-call-a" }); await started;
      socket.message({ type: "Turn", turn_order: 0, transcript: "Find my ticket.", end_of_turn: true });
      await vi.waitFor(() => expect(modelBodies).toHaveLength(2));
      expect(modelBodies[1]).toContain("permission was denied");
      await vi.waitFor(() => expect(harness.ttsConnections).toHaveLength(1));
      const tts = harness.ttsConnections[0]!;
      tts.emit("open");
      await vi.waitFor(() => expect(tts.sent.length).toBeGreaterThan(0));
      expect(JSON.parse(String(tts.sent[0])).transcript).toBe("I cannot access the ticket system.");
    } finally { await harness.cleanup(); }
  });

  it("closes a call when queued inbound audio exceeds four seconds", async () => {
    const harness = await createHarness();
    try {
      const started = harness.execution.start(harness.start);
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const socket = harness.connections[0]!.socket;
      socket.emit("open"); socket.message({ type: "Begin", id: "provider-call-a" }); await started;
      vi.useFakeTimers();
      for (let index = 0; index < 205; index += 1) {
        harness.execution.appendAudio({ ...harness.start, audioBase64: Buffer.alloc(160, 127).toString("base64") });
      }
      expect(harness.output.closes).toEqual(["standard_call_provider_failed"]);
      expect(socket.sent.filter(Buffer.isBuffer)).toHaveLength(1);
    } finally { vi.useRealTimers(); await harness.cleanup(); }
  });

  it("processes one final transcript per provider turn, including a later formatted copy", async () => {
    const harness = await createHarness();
    try {
      const started = harness.execution.start(harness.start);
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const socket = harness.connections[0]!.socket;
      socket.emit("open"); socket.message({ type: "Begin", id: "provider-call-a" }); await started;
      socket.message({ type: "Turn", turn_order: 0, transcript: "Are you open?", end_of_turn: true });
      socket.message({ type: "Turn", turn_order: 0, transcript: "Are you open?", end_of_turn: true, turn_is_formatted: true });
      await vi.waitFor(() => expect(harness.ttsConnections).toHaveLength(1));
      const tts = harness.ttsConnections[0]!;
      tts.emit("open");
      await vi.waitFor(() => expect(tts.sent.length).toBeGreaterThan(0));
      tts.message({ type: "done", context_id: "ctx-1", done: true });
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(tts.sent.map(value => JSON.parse(String(value)).context_id)).toEqual(["ctx-1", "ctx-1"]);
    } finally { await harness.cleanup(); }
  });

  it("paces queued phone audio at real time instead of sending an initial burst", async () => {
    const harness = await createHarness();
    try {
      const started = harness.execution.start(harness.start);
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const socket = harness.connections[0]!.socket;
      socket.emit("open"); socket.message({ type: "Begin", id: "provider-call-a" }); await started;
      vi.useFakeTimers();
      for (let index = 0; index < 6; index += 1) {
        harness.execution.appendAudio({ ...harness.start, audioBase64: Buffer.alloc(160, index).toString("base64") });
      }
      expect(socket.sent).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(59);
      expect(socket.sent).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(socket.sent).toHaveLength(2);
      expect(socket.sent[1]).toEqual(Buffer.concat([Buffer.alloc(160, 3), Buffer.alloc(160, 4), Buffer.alloc(160, 5)]));
    } finally { vi.useRealTimers(); await harness.cleanup(); }
  });

  it.each(["premium", "terminal", "workspace", "missing-workspace", "missing-phone", "missing-route", "profile", "blocked", "blocked-session", "failed-lifecycle"] as const)("rejects a %s call scope before a provider starts", async invalidScope => {
    const harness = await createHarness({ invalidScope });
    try {
      const outcome = harness.execution.start(harness.start).then(() => "started", () => "rejected");
      expect(await Promise.race([outcome, new Promise(resolve => setTimeout(() => resolve("pending"), 100))])).toBe("rejected");
      expect(harness.connections).toEqual([]);
    } finally { await harness.cleanup(); }
  });

  it("ends a call that has no STT readiness acknowledgement after two seconds", async () => {
    const harness = await createHarness();
    try {
      const started = harness.execution.start(harness.start);
      const outcome = started.then(() => "started", () => "rejected");
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const socket = harness.connections[0]!.socket;
      socket.emit("open");
      expect(await Promise.race([outcome, new Promise(resolve => setTimeout(() => resolve("pending"), 2300))])).toBe("rejected");
      expect(socket.sent).toContain('{"type":"Terminate"}');
      socket.message({ type: "Termination", audio_duration_seconds: 0, session_duration_seconds: 2 });
    } finally { await harness.cleanup(); }
  });

  it.each([false, true])("closes the speech socket on call stop, including completed output (%s)", async finishSpeech => {
    const harness = await createHarness();
    try {
      const started = harness.execution.start(harness.start);
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const socket = harness.connections[0]!.socket;
      socket.emit("open");
      socket.message({ type: "Begin", id: "provider-call-a" });
      await started;
      socket.message({ type: "Turn", turn_order: 0, transcript: "Are you open?", end_of_turn: true });
      await vi.waitFor(() => expect(harness.ttsConnections).toHaveLength(1));
      const tts = harness.ttsConnections[0]!;
      if (finishSpeech) {
        tts.emit("open");
        await vi.waitFor(() => expect(tts.sent.length).toBeGreaterThan(0));
        tts.message({ type: "done", context_id: "ctx-1", done: true });
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      const stopped = harness.execution.stop(harness.start);
      expect(tts.closed).toBe(true);
      socket.message({ type: "Termination", audio_duration_seconds: 2, session_duration_seconds: 3 });
      await stopped;
      expect(harness.output.closes).toEqual([]);
    } finally { await harness.cleanup(); }
  });

  it.each(["openai", "google-gemini"] as const)("cancels a pending %s model request when the caller starts speaking", async modelProvider => {
    const requests: RequestInit[] = [];
    const harness = await createHarness({ modelProvider, modelFetch: async (_url, init) => {
      requests.push(init!);
      return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    } });
    try {
      const started = harness.execution.start(harness.start);
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const socket = harness.connections[0]!.socket;
      socket.emit("open");
      socket.message({ type: "Begin", id: "provider-call-a" });
      await started;
      socket.message({ type: "Turn", turn_order: 0, transcript: "Are you open?", end_of_turn: true });
      await vi.waitFor(() => expect(requests).toHaveLength(1));
      socket.message({ type: "SpeechStarted" });
      expect(requests[0]?.signal?.aborted).toBe(true);
      expect(harness.ttsConnections).toEqual([]);
    } finally { await harness.cleanup(); }
  });

  it("clears playback once on provider-confirmed caller speech and drops late response audio", async () => {
    const harness = await createHarness();
    try {
      const started = harness.execution.start(harness.start);
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const socket = harness.connections[0]!.socket;
      socket.emit("open");
      socket.message({ type: "Begin", id: "provider-call-a" });
      await started;
      socket.message({ type: "Turn", turn_order: 0, transcript: "Are you open?", end_of_turn: true });
      await vi.waitFor(() => expect(harness.ttsConnections).toHaveLength(1));
      const tts = harness.ttsConnections[0]!;
      tts.emit("open");
      await vi.waitFor(() => expect(tts.sent.length).toBeGreaterThan(0));
      tts.message({ type: "chunk", context_id: "ctx-1", data: Buffer.alloc(160, 127).toString("base64"), step_time: 20, done: false });
      await vi.waitFor(() => expect(harness.output.media).toHaveLength(1));
      socket.message({ type: "SpeechStarted" });
      socket.message({ type: "SpeechStarted" });
      expect(harness.output.clears).toBe(1);
      tts.message({ type: "chunk", context_id: "ctx-1", data: Buffer.alloc(160, 126).toString("base64"), step_time: 20, done: false });
      tts.message({ type: "done", context_id: "ctx-1", done: true });
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(harness.output.media).toHaveLength(1);
      expect(harness.output.closes).toEqual([]);
      expect(tts.closed).toBe(true);
    } finally { await harness.cleanup(); }
  });

  it("answers a final caller turn with native phone audio and call-scoped model usage", async () => {
    const harness = await createHarness();
    try {
      const started = harness.execution.start(harness.start);
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const socket = harness.connections[0]!.socket;
      socket.emit("open");
      socket.message({ type: "Begin", id: "provider-call-a" });
      await started;
      socket.message({ type: "Turn", turn_order: 0, transcript: "Are you open?", end_of_turn: true });
      await vi.waitFor(() => expect(harness.ttsConnections).toHaveLength(1));
      const tts = harness.ttsConnections[0]!;
      tts.emit("open");
      await vi.waitFor(() => expect(tts.sent.length).toBeGreaterThan(0));
      expect(JSON.parse(String(tts.sent[0]))).toMatchObject({ transcript: "Yes, we are open.",
        output_format: { container: "raw", encoding: "pcm_mulaw", sample_rate: 8000 } });
      tts.message({ type: "chunk", context_id: "ctx-1", data: Buffer.alloc(320, 127).toString("base64"), step_time: 20, done: false });
      tts.message({ type: "done", context_id: "ctx-1", done: true });
      await vi.waitFor(() => expect(harness.output.media).toHaveLength(2));
      expect(harness.output.media[0]).toMatchObject({ callSessionId: "call-a", mediaStreamId: "stream-a", direction: "outbound",
        codec: { name: "g711_mulaw", sampleRateHz: 8000, channels: 1 }, payloadBase64: Buffer.alloc(160, 127).toString("base64") });
      expect(harness.output.marks.length).toBeGreaterThanOrEqual(2);
      expect(harness.output.checkpoints).toEqual(["transcriptCreated", "agentResponseGenerated"]);
      await vi.waitFor(() => expect(harness.traces).toHaveLength(1));
      expect(harness.traces[0]).toMatchObject({ ids: { organizationId: "tenant-a", callSessionId: "call-a" },
        inputs: { source: "telephony" }, tts: { provider: "cartesia" } });
      expect(JSON.stringify(harness.traces)).not.toContain("Are you open?");
      expect(await harness.usage.listTenantRequests("tenant-a")).toEqual(expect.arrayContaining([
        expect.objectContaining({ provider: "openai", sessionId: "call-a", result: expect.objectContaining({ providerRequestId: "model-request-a" }) }),
      ]));
    } finally { await harness.cleanup(); }
  });

  it("combines three phone frames into a native 60 ms STT chunk and rejects another tenant", async () => {
    const harness = await createHarness();
    try {
      const started = harness.execution.start(harness.start);
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const socket = harness.connections[0]!.socket;
      socket.emit("open");
      socket.message({ type: "Begin", id: "provider-call-a" });
      await started;
      const frame = Buffer.alloc(160, 127).toString("base64");
      harness.execution.appendAudio({ ...harness.start, organizationId: "tenant-b", audioBase64: frame });
      harness.execution.appendAudio({ ...harness.start, audioBase64: frame });
      harness.execution.appendAudio({ ...harness.start, audioBase64: frame });
      expect(socket.sent).toEqual([]);
      harness.execution.appendAudio({ ...harness.start, audioBase64: frame });
      await vi.waitFor(() => expect(socket.sent).toEqual([Buffer.alloc(480, 127)]));
    } finally { await harness.cleanup(); }
  });

  it("rejects a dispatch that does not belong to the call before opening a provider", async () => {
    const harness = await createHarness();
    try {
      const result = harness.execution.start({ ...harness.start, dispatchId: "another-dispatch" });
      const outcome = result.then(() => "started", () => "rejected");
      expect(await Promise.race([outcome, new Promise(resolve => setTimeout(() => resolve("pending"), 100))])).toBe("rejected");
      expect(harness.connections).toEqual([]);
    } finally { await harness.cleanup(); }
  });

  it("stops once and saves native call usage before cleanup completes", async () => {
    const harness = await createHarness();
    try {
      const started = harness.execution.start(harness.start);
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const socket = harness.connections[0]!.socket;
      socket.emit("open");
      socket.message({ type: "Begin", id: "provider-call-a" });
      await started;
      let stopped = false;
      const stopping = harness.execution.stop(harness.start).then(() => { stopped = true; });
      const duplicate = harness.execution.stop(harness.start);
      await Promise.resolve();
      expect(stopped).toBe(false);
      expect(socket.sent).toEqual(['{"type":"Terminate"}']);
      socket.message({ type: "Termination", audio_duration_seconds: 12, session_duration_seconds: 15 });
      await Promise.all([stopping, duplicate]);
      expect(socket.closed).toBe(true);
      expect(await harness.usage.listTenantRequests("tenant-a")).toMatchObject([{
        callSessionId: "call-a", result: { totals: { audioDurationSeconds: 12, sessionDurationSeconds: 15 } },
      }]);
      expect(await harness.usage.listTenantConnections("tenant-a")).toMatchObject([{ result: { outcome: "closed" } }]);
    } finally { await harness.cleanup(); }
  });

  it("opens native phone STT for the trusted published call and waits for provider readiness", async () => {
    const harness = await createHarness();
    try {
      let ready = false;
      const started = harness.execution.start(harness.start).then(() => { ready = true; });
      void started.catch(() => {});
      await vi.waitFor(() => expect(harness.connections).toHaveLength(1));
      const { socket, url } = harness.connections[0]!;
      expect(new URL(url).searchParams.get("encoding")).toBe("pcm_mulaw");
      expect(new URL(url).searchParams.get("sample_rate")).toBe("8000");
      socket.emit("open");
      await Promise.resolve();
      expect(ready).toBe(false);
      socket.message({ type: "Begin", id: "provider-call-a" });
      await started;
      expect(await harness.usage.listTenantConnections("tenant-a")).toMatchObject([{
        sessionId: "call-a", callSessionId: "call-a", provider: "assemblyai", result: null,
      }]);
      expect(await harness.usage.listTenantConnections("tenant-b")).toEqual([]);
    } finally { await harness.cleanup(); }
  });
});

async function createHarness(options: { modelFetch?: typeof fetch; modelProvider?: "openai" | "google-gemini";
  invalidScope?: "premium" | "terminal" | "workspace" | "missing-workspace" | "missing-phone" | "missing-route" | "profile" | "blocked" | "blocked-session" | "failed-lifecycle"; toolbelt?: boolean; handoff?: boolean; intentRoute?: boolean;
  readGate?: Promise<void>; permissionRead?: () => void | Promise<void>; classifierFetch?: typeof fetch;
  voiceLookup?: () => Promise<string>; playbackAdmission?: PstnPremiumPlaybackAdmission;
  checkpointWrite?: () => Promise<void>; deferredTtsClose?: boolean } = {}) {
  const pool = usageRecordingTestPool();
  const usage = new ProviderUsageRecordingRepository(pool);
  const repository = new class extends InMemoryTelephonyIncrementalRepository {
    override async loadCallRuntimeContext(input: Parameters<InMemoryTelephonyIncrementalRepository["loadCallRuntimeContext"]>[0]) {
      await options.readGate;
      const result = await super.loadCallRuntimeContext(input);
      if (result.outcome === "found") {
        if (options.invalidScope === "missing-workspace") delete result.context.workspaceId;
        if (options.invalidScope === "missing-phone") delete result.context.phoneNumberId;
        if (options.invalidScope === "missing-route") delete result.context.routeMode;
        if (options.invalidScope === "profile") result.context.runtimeProfile = "premium-realtime";
        if (options.invalidScope === "blocked") result.context.disposition = "blocked";
        if (options.invalidScope === "blocked-session") result.context.status = "blocked";
        if (options.invalidScope === "failed-lifecycle") result.context.lifecycleState.stage = "failed";
      }
      return result;
    }
  }();
  const manifests = new InMemoryPublishedWorkflowManifestRepository();
  const agent = createAgentRoleNode({ id: "agent-a", label: "Reception", position: { x: 0, y: 0 },
    role: { name: "Jane", kind: "receptionist", businessName: "Example Shop", instructions: "Help the caller.",
      defaultModelTier: "cheap", ...(options.modelProvider === undefined ? {} : { modelProvider: options.modelProvider }),
      ...(options.voiceLookup === undefined ? {} : { voiceConfig: { provider: "cartesia" as const,
        voiceId: "voice-a", label: "Support", sourceType: "catalog" as const } }),
      ...(options.handoff ? { routePolicy: { type: "route_by_intent" as const, trigger: "on_caller_turn_end" as const,
        activation: "until_routed" as const, classifier: { mode: "standard" as const, modelAlias: "intent-classifier-fast" as const, confidenceThreshold: 0.75 },
        inputWindow: { latestCallerTurn: true, recentTranscriptTurns: 4, includeConversationSummary: true, includePreviousAgentContext: true, includeRecentToolResults: true },
        readiness: { mode: "auto_with_clarification" as const, maxClarificationTurns: 2 },
        announcement: { mode: "template" as const, text: "I will connect you with {targetAgentName}." },
        branches: [{ id: "billing", label: "Billing", intentKey: "billing", target: { type: "agent" as const, agentId: "agent-b" }, transferInstructions: "Keep the invoice context." }],
        fallback: { label: "Clarify", target: { type: "clarify_source_agent" as const } } } } : {}),
      ...(options.toolbelt ? { toolbeltAssignments: [{ id: "search", toolId: "zendesk.tickets.search", label: "Search tickets",
        description: "Find caller tickets", whenToUse: "Find existing tickets", connector: "zendesk", toolName: "Search tickets",
        integrationConnectionId: "zendesk-a", integrationLabel: "Support", connectionStatus: "connected" as const,
        risk: "low" as const, requiresAuthorization: true, requiresHumanApproval: false }] } : {}),
      languagePolicy: { defaultLanguage: "en", supportedLanguages: ["en"], allowMidCallSwitching: false } } });
  const graph = createWorkflowGraph({ id: "workflow-a", name: "Phone support", nodes: [
    { id: "entry", kind: "entry", label: "Phone call", position: { x: 0, y: 0 }, config: {} }, agent,
    ...(options.handoff || options.intentRoute ? [createAgentRoleNode({ id: "agent-b", label: "Billing", position: { x: 200, y: 100 },
      role: { name: "Billing", kind: "billing", businessName: "Example Shop", instructions: "Explain invoices.", defaultModelTier: "cheap",
        languagePolicy: { defaultLanguage: "en", supportedLanguages: ["en"], allowMidCallSwitching: false } } })] : []),
    ...(options.intentRoute ? [createConditionNode({ id: "intent", label: "Intent", position: { x: 100, y: 100 },
      condition: { branches: [{ id: "billing", label: "Billing", intentKey: "billing", description: "Charges and invoices",
        expression: 'intent == "billing"', targetNodeId: "agent-b" }], fallbackLabel: "End", fallbackTargetNodeId: "end" } })] : []),
    createEndNode({ id: "end", label: "End", position: { x: 400, y: 0 }, end: { outcome: "resolved", closingMessage: "Goodbye." } }),
  ], edges: [
    { id: "entry-agent", sourceNodeId: "entry", targetNodeId: "agent-a" },
    ...(options.intentRoute ? [
      { id: "agent-intent", sourceNodeId: "agent-a", targetNodeId: "intent" },
      { id: "intent-billing", sourceNodeId: "intent", targetNodeId: "agent-b" },
      { id: "intent-end", sourceNodeId: "intent", targetNodeId: "end" },
    ] : [{ id: "agent-end", sourceNodeId: "agent-a", targetNodeId: "end" }]),
  ] });
  const publishedVersion = publishWorkflowVersion({ workflowId: graph.id, tenantId: "tenant-a", environment: "production",
    createdBy: "operator-a", graph, existingVersions: [], runtime: "sandwich-pipeline", telephonyProvider: "twilio",
    workspaceId: "workspace-a", memory: { mode: "scoped", retrievalScopes: ["session"], approvalRequired: true },
    budget: { monthlyCapUsd: 100, currentSpendUsd: 0, projectedCostPerMinuteUsd: 0.1, blockOnLimit: true } });
  const manifest = compileRuntimeManifest({ publishedVersion, modelRouting: [
    { id: "default", priority: 1, when: { callPhase: "discovery" }, useTier: "cheap", reason: "Standard phone support" },
  ],
    telemetry: { captureAudio: false, captureTranscript: false, redactSensitiveData: true, sinks: ["live-monitor"] },
    telephonyConnectionId: "connection-a", telephonyOwnership: "bring-your-own", availableIntegrationConnectionIds: ["zendesk-a"] });
  await manifests.save(manifest);
  const at = new Date().toISOString();
  await repository.createCallExecution({
    dispatch: { id: "dispatch-a", tenantId: "tenant-a", callSessionId: "call-a", connectionId: "connection-a",
      direction: "inbound", disposition: "routed", reason: "Published route", source: "webhook",
      phoneNumberId: "phone-a", publishedVersionId: manifest.publishedVersionId,
      workspaceId: options.invalidScope === "workspace" ? "different-workspace" : "workspace-a",
      runtimeProfile: manifest.runtimeProfile, runtimePath: options.invalidScope === "premium" ? "pstn-premium-realtime" : "pstn-sandwich", routeMode: "live_route",
      recording: { enabled: false, consentMode: "disabled", consentMessage: "" },
      recordingConsent: { state: "recording_disabled", noticeRequired: false, consentMode: "disabled", message: "",
        recordedAt: at, reason: "Test recording disabled" },
      fromPhoneNumber: "+15550000001", toPhoneNumber: "+15550000002", createdAt: at },
    executionSession: { id: "execution-a", tenantId: "tenant-a", dispatchId: "dispatch-a", callSessionId: "call-a",
      connectionId: "connection-a", provider: "twilio", ownershipMode: "byo_provider_account", direction: "inbound",
      status: options.invalidScope === "terminal" ? "completed" : "active", fromPhoneNumber: "+15550000001", toPhoneNumber: "+15550000002", testCall: false,
      bridgeKind: "twilio-programmable-voice", bridgeTarget: "stream-a", mediaPath: "provider-native", diagnostics: [],
      lifecycleState: { stage: "media-connected", observedAt: at }, createdAt: at, updatedAt: at },
    executionCommands: [],
  });
  const connections: Array<{ socket: ProviderSocket; url: string }> = [];
  const ttsConnections: ProviderSocket[] = [];
  const output = { media: [] as PstnAudioFrame[], marks: [] as string[], clears: 0, closes: [] as string[], checkpoints: [] as string[] };
  const traces: LangSmithRuntimeTraceProjection[] = [];
  const observability = createRuntimeObservabilityRecorder({
    config: { enabled: true, serviceName: "zara-api", environment: "test", releaseVersion: "test", traceSampleRate: 1,
      sinks: ["langsmith"], otel: { enabled: false, metricsEnabled: false },
      langsmith: { enabled: true, project: "test", endpoint: "https://example.test", datasetPrefix: "zara" },
      redaction: { mode: "strict", includeTranscriptText: "never", includeToolOutput: "summary_only", includeAudio: false } },
    langsmithExporter: { async exportTrace(trace) { traces.push(trace); } },
  });
  const execution = new PstnSandwichCallExecution({ repository, manifests,
    promptPolicyService: { async selectPromptPolicyForSession() {
      return { revision: 1, hash: "test-policy-hash", policy: defaultRuntimePromptPolicy };
    } },
    playbackAdmission: options.playbackAdmission,
    observability,
    toolExecutor: new RuntimeAgentToolExecutorService(new DefaultLiveSandboxToolRegistry(),
      new ToolPermissionGrantsService({ listOrganizationIds: () => [], load: async () => { await options.permissionRead?.(); return null; }, save() {} })),
    createProviders: () => ({
      intentClassifier: new GeminiIntentClassifierProvider({ apiKey: "test-only-key", fetch: options.classifierFetch ?? (async () => Response.json({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ matchedBranchId: "billing", intentKey: "billing", confidence: 0.98,
          reason: "The caller asks about a duplicate charge.", usedFallback: false }) }] } }],
      })) }),
      stt: new AssemblyAiSttProvider({ apiKey: "test-only-key", usageRecorder: usage,
        websocketFactory: url => { const socket = new ProviderSocket(); connections.push({ socket, url }); return socket; } }),
      model: createLiveSandboxTextModelProvider(resolveLiveSandboxProviderConfig({ OPENAI_API_KEY: "test-only-key", GEMINI_API_KEY: "test-only-key" }), {
        usageRecorder: usage,
        fetch: options.modelFetch ?? (async () => Response.json({ id: "model-request-a", created: 1_783_000_000,
          choices: [{ message: { content: "Yes, we are open." } }],
          usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 } })),
      }),
      tts: new CartesiaTtsProvider({ apiKey: "test-only-key", apiVersion: "2026-03-01",
        resolveVoiceId: options.voiceLookup,
        websocketFactory: () => { const socket = new ProviderSocket(options.deferredTtsClose); ttsConnections.push(socket); return socket; } }),
    }),
  });
  const start = { organizationId: "tenant-a", dispatchId: "dispatch-a", callSessionId: "call-a", streamSid: "stream-a",
    output: { sendMedia: (frame: PstnAudioFrame) => { output.media.push(frame); },
      recordCheckpoint: async (checkpoint: string) => { await options.checkpointWrite?.(); output.checkpoints.push(checkpoint); },
      sendMark: (name: string) => { output.marks.push(name); }, clearAudio: () => { output.clears += 1; },
      close: (_code: number, reason: string) => { output.closes.push(reason); } } };
  return { execution, start, connections, ttsConnections, usage, repository, manifests, manifest, output, traces,
    async cleanup() {
      for (const { socket } of connections) socket.close();
      for (const socket of ttsConnections) socket.close();
      await new Promise(resolve => setTimeout(resolve, 20));
      await pool.end();
    } };
}

class ProviderSocket extends EventEmitter {
  constructor(private readonly deferredClose = false) { super(); }
  readonly sent: Array<string | Buffer> = [];
  closed = false;
  send(data: string | Buffer) { this.sent.push(data); }
  message(value: unknown) { this.emit("message", Buffer.from(JSON.stringify(value))); }
  close() { if (!this.closed) { this.closed = true; if (!this.deferredClose) this.emit("close", 1000, Buffer.from("test close")); } }
}
