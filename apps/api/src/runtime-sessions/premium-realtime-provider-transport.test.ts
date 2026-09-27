import { describe, expect, it, vi } from "vitest";
import type { CompiledRuntimeManifest, PremiumRealtimeSession } from "@zara/core";
import { ProviderUsageRecordingRepository } from "../billing/provider-usage-recording.repository";
import { defaultRuntimePromptPolicy } from "../runtime-prompt-policy/runtime-prompt-policy.models";
import { usageRecordingTestPool } from "../billing/provider-usage-recording.test-support";

import {
  WsPremiumRealtimeProviderTransport,
} from "./premium-realtime-provider-transport";

describe("WsPremiumRealtimeProviderTransport", () => {
  it("stops provider work while retrying one retained usage event after a database failure", async () => {
    const pool = usageRecordingTestPool();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let attempts = 0;
    try {
      const repository = new ProviderUsageRecordingRepository({ query: async (...args: unknown[]) => {
        if (String(args[0]).startsWith("insert into provider_usage_requests")) {
          attempts += 1;
          if (attempts === 1) throw Object.assign(new Error("database disconnected"), { code: "ECONNRESET" });
          await gate;
        }
        return pool.query(...args);
      } });
      const reader = new ProviderUsageRecordingRepository(pool);
      const socket = createSocketLike();
      const connection = await new WsPremiumRealtimeProviderTransport(() => socket,
        { OPENAI_API_KEY: "test-key" }, repository).connect({
        organizationId: "tuzzy-test", workspaceId: "workspace-1", actorUserId: "user-1",
        session: createSession({ runtime: "openai-realtime", model: "gpt-realtime-2.1" }), manifest: createManifest(),
      });
      socket.emitMessage(JSON.stringify({ type: "response.done", response: {
        id: "resp-retry", status: "completed", usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
      } }));
      await expect.poll(() => socket.close.mock.calls).toEqual([[1011, "Provider usage recording failed."]]);
      expect(() => connection.send({ type: "response.create" })).toThrow("Provider connection is closed.");
      socket.emitClose(1011, "closed");
      expect(await reader.listTenantRequests("tuzzy-test")).toEqual([]);
      release();
      await expect.poll(() => reader.listTenantRequests("tuzzy-test")).toMatchObject([
        { result: { providerRequestId: "resp-retry", totals: { inputTokens: 3, outputTokens: 2 } } },
      ]);
      expect(attempts).toBe(2);
      expect(await reader.listTenantConnections("tuzzy-test")).toMatchObject([{ result: null }]);
    } finally { release(); await pool.end(); }
  });

  it.each(["close", "error"])("finishes usage recording when the %s consumer throws", async (event) => {
    const pool = usageRecordingTestPool();
    try {
      const repository = new ProviderUsageRecordingRepository(pool);
      const socket = createSocketLike();
      const connection = await new WsPremiumRealtimeProviderTransport(() => socket,
        { OPENAI_API_KEY: "test-key" }, repository).connect({
        organizationId: "tuzzy-test", workspaceId: "workspace-1", actorUserId: "user-1",
        session: createSession({ runtime: "openai-realtime", model: "gpt-realtime-2.1" }), manifest: createManifest(),
      });
      connection.onClose(() => { throw new Error("consumer failed"); });
      if (event === "error") {
        expect(() => socket.emitError(new Error("provider failed"))).not.toThrow();
        expect(socket.close).toHaveBeenCalledTimes(1);
        socket.emitClose(1000, "closed");
      } else {
        expect(() => socket.emitClose(1000, "closed")).not.toThrow();
      }
      await expect.poll(() => repository.listTenantConnections("tuzzy-test"))
        .toMatchObject([{ result: { outcome: event === "error" ? "failed" : "closed" } }]);
    } finally { await pool.end(); }
  });

  it("stores final usage received after an error while blocking further provider work", async () => {
    const pool = usageRecordingTestPool();
    try {
      const repository = new ProviderUsageRecordingRepository(pool);
      const socket = createSocketLike();
      const connection = await new WsPremiumRealtimeProviderTransport(() => socket,
        { OPENAI_API_KEY: "test-key" }, repository).connect({
        organizationId: "tuzzy-test", workspaceId: "workspace-1", actorUserId: "user-1",
        session: createSession({ runtime: "openai-realtime", model: "gpt-realtime-2.1" }), manifest: createManifest(),
      });
      const consumer = vi.fn();
      const closed = vi.fn();
      connection.onMessage(consumer);
      connection.onClose(closed);
      socket.emitMessage(JSON.stringify({ type: "session.created", session: { id: "sess-late" } }));
      socket.emitError(new Error("provider connection failed"));
      expect(() => connection.send({ type: "response.create" })).toThrow("Provider connection is closed.");
      socket.emitMessage(JSON.stringify({ type: "response.done", response: {
        id: "resp-late", status: "completed", usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
      } }));
      await expect.poll(() => repository.listTenantRequests("tuzzy-test")).toMatchObject([
        { result: { providerRequestId: "resp-late", totals: { inputTokens: 3, outputTokens: 2 } } },
      ]);
      expect(await repository.listTenantConnections("tuzzy-test")).toMatchObject([{ result: null }]);
      expect(consumer).toHaveBeenCalledTimes(1);
      expect(socket.close).toHaveBeenCalledTimes(1);
      socket.emitClose(1000, "closed");
      await expect.poll(() => repository.listTenantConnections("tuzzy-test")).toMatchObject([
        { result: { outcome: "failed", providerSessionId: "sess-late" } },
      ]);
      expect(closed).toHaveBeenCalledTimes(1);
    } finally { await pool.end(); }
  });

  it("links responses and transcription to their connection and trusted call across reconnects", async () => {
    const pool = usageRecordingTestPool();
    try {
      const repository = new ProviderUsageRecordingRepository(pool);
      const sockets: ReturnType<typeof createSocketLike>[] = [];
      const transport = new WsPremiumRealtimeProviderTransport(() => {
        const socket = createSocketLike(); sockets.push(socket); return socket;
      }, { OPENAI_API_KEY: "test-key", OPENAI_PROJECT_ID: "proj-shared" }, repository);
      for (const suffix of ["first", "second"]) {
        await transport.connect({ organizationId: "tuzzy-test", workspaceId: "workspace-1", actorUserId: "pstn:untrusted-id",
          callSessionId: "trusted-call", session: createSession({ runtime: "openai-realtime", model: "gpt-realtime-2.1" }),
          manifest: createManifest() });
        const socket = sockets.at(-1)!;
        socket.emitMessage(JSON.stringify({ type: "session.created", session: { id: `sess-${suffix}` } }));
        const response = JSON.stringify({ type: "response.done", response: { id: `resp-${suffix}`, status: "completed",
          usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } } });
        socket.emitMessage(response); socket.emitMessage(response);
        socket.emitMessage(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed",
          item_id: "item-1", content_index: 0, usage: { type: "duration", seconds: 0.5 } }));
        socket.emitClose(1000, "done");
      }
      await expect.poll(() => repository.listTenantConnections("tuzzy-test"))
        .toMatchObject([{ result: { outcome: "closed" } }, { result: { outcome: "closed" } }]);
      const connections = await repository.listTenantConnections("tuzzy-test");
      const requests = await repository.listTenantRequests("tuzzy-test");
      expect(requests).toHaveLength(4);
      for (const connection of connections) {
        expect(requests.filter(row => row.connectionId === connection.id))
          .toMatchObject([{ callSessionId: "trusted-call", sessionId: "session-1" },
            { callSessionId: "trusted-call", sessionId: "session-1" }]);
      }
      expect(await repository.listTenantRequests("other")).toEqual([]);
    } finally { await pool.end(); }
  });
  it("closes a failed setup socket before waiting for a slow final database write", async () => {
    const pool = usageRecordingTestPool();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    try {
      const repository = new ProviderUsageRecordingRepository({ query: async (...args: unknown[]) => {
        if (String(args[0]).startsWith("update provider_usage_connections")) await gate;
        return pool.query(...args);
      } });
      const socket = createSocketLike();
      socket.send.mockImplementation(() => { throw new Error("setup failed"); });
      const attempt = new WsPremiumRealtimeProviderTransport(() => socket, { OPENAI_API_KEY: "test-key" }, repository).connect({
        organizationId: "tuzzy-test", workspaceId: "workspace-1", actorUserId: "user-1",
        session: createSession({ runtime: "openai-realtime", model: "gpt-realtime-2.1" }), manifest: createManifest() });
      const rejected = expect(attempt).rejects.toThrow("setup failed");
      await expect.poll(() => socket.close.mock.calls).toEqual([[1011, "Provider connection failed."]]);
      release();
      await rejected;
    } finally { release(); await pool.end(); }
  });
  it.each(["factory", "before-open", "session-send"])("records a failed connection after %s failure", async stage => {
    const pool = usageRecordingTestPool();
    try {
      const repository = new ProviderUsageRecordingRepository(pool);
      const socket = createSocketLike({ readyState: stage === "before-open" ? 0 : 1 });
      if (stage === "session-send") socket.send.mockImplementation(() => { throw new Error("private failure"); });
      const factory = vi.fn(() => {
        if (stage === "factory") throw new Error("private failure");
        return socket;
      });
      const attempt = new WsPremiumRealtimeProviderTransport(factory, { OPENAI_API_KEY: "test-key" }, repository).connect({
        organizationId: "tuzzy-test", workspaceId: "workspace-1", actorUserId: "user-1",
        session: createSession({ runtime: "openai-realtime", model: "gpt-realtime-2.1" }), manifest: createManifest() });
      const rejected = expect(attempt).rejects.toThrow();
      if (stage === "before-open") {
        await expect.poll(() => factory.mock.calls.length).toBe(1);
        socket.emitClose(1006, "private failure");
      }
      await rejected;
      await expect.poll(() => repository.listTenantConnections("tuzzy-test")).toMatchObject([{ result: {
        outcome: "failed", providerSessionId: null, endedAt: expect.any(String),
      } }]);
      expect(JSON.stringify(await repository.listTenantConnections("tuzzy-test"))).not.toContain("private");
    } finally { await pool.end(); }
  });
  it("finishes a closed connection only after queued usage is stored, without retaining the close reason", async () => {
    const pool = usageRecordingTestPool();
    try {
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      let delay = false;
      const repository = new ProviderUsageRecordingRepository({ query: async (...args: unknown[]) => {
        if (delay && String(args[0]).includes("provider_usage_requests")) await gate;
        return pool.query(...args);
      } });
      const socket = createSocketLike();
      await new WsPremiumRealtimeProviderTransport(() => socket, { OPENAI_API_KEY: "test-key" }, repository).connect({
        organizationId: "tuzzy-test", workspaceId: "workspace-1", actorUserId: "user-1",
        session: createSession({ runtime: "openai-realtime", model: "gpt-realtime-2.1" }), manifest: createManifest() });
      delay = true;
      socket.emitMessage(JSON.stringify({ type: "session.created", session: { id: "sess-closed" } }));
      socket.emitMessage(JSON.stringify({ type: "response.done", response: { id: "resp-close", status: "completed",
        usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } } }));
      socket.emitClose(1000, "private provider close reason");
      expect(await repository.listTenantConnections("tuzzy-test")).toMatchObject([{ result: null }]);
      delay = false;
      release();
      await expect.poll(() => repository.listTenantConnections("tuzzy-test")).toMatchObject([{
        result: { outcome: "closed", providerSessionId: "sess-closed", endedAt: expect.any(String) },
      }]);
      expect(await repository.listTenantRequests("tuzzy-test")).toMatchObject([{ result: { totals: { inputTokens: 1, outputTokens: 2 } } }]);
      expect(JSON.stringify(await repository.listTenantConnections("tuzzy-test"))).not.toContain("private");
    } finally { await pool.end(); }
  });
  it("saves a durable connection before opening the provider socket and blocks when storage fails", async () => {
    const pool = usageRecordingTestPool();
    try {
      const repository = new ProviderUsageRecordingRepository(pool);
      let savedAtOpen: ReturnType<typeof repository.listTenantConnections> | undefined;
      const factory = vi.fn(() => {
        savedAtOpen = repository.listTenantConnections("tuzzy-test");
        return createSocketLike();
      });
      const input = { organizationId: "tuzzy-test", workspaceId: "workspace-1", actorUserId: "user-1",
        session: createSession({ runtime: "openai-realtime", model: "gpt-realtime-2.1" }), manifest: createManifest() };
      await new WsPremiumRealtimeProviderTransport(factory, { OPENAI_API_KEY: "test-key", OPENAI_PROJECT_ID: "proj-shared" }, repository).connect(input);
      expect(await savedAtOpen).toMatchObject([{ sessionId: "session-1", provider: "openai", externalScopeId: "proj-shared", result: null }]);
      const blockedFactory = vi.fn(() => createSocketLike());
      await expect(new WsPremiumRealtimeProviderTransport(blockedFactory, { OPENAI_API_KEY: "test-key" },
        new ProviderUsageRecordingRepository({ query: async () => { throw new Error("private database secret"); } })).connect(input))
        .rejects.toThrow("Provider connection recording failed.");
      expect(blockedFactory).not.toHaveBeenCalled();
    } finally { await pool.end(); }
  });
  it("records live transcription with the model sent in session configuration", async () => {
    const pool = usageRecordingTestPool();
    try {
      const socket = createSocketLike();
      const repository = new ProviderUsageRecordingRepository(pool);
      const transport = new WsPremiumRealtimeProviderTransport(() => socket,
        { OPENAI_API_KEY: "test-key", OPENAI_PROJECT_ID: "proj-shared" }, repository);
      await transport.connect({ organizationId: "tuzzy-test", workspaceId: "workspace-1", actorUserId: "user-1",
        session: createSession({ runtime: "openai-realtime", model: "gpt-realtime-2.1" }), manifest: createManifest() });
      socket.emitMessage(JSON.stringify({ type: "session.created", session: { id: "sess-live" } }));
      socket.emitMessage(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed",
        item_id: "item-live", content_index: 0, transcript: "Private caller text",
        usage: { type: "duration", seconds: 2.75 } }));
      await expect.poll(() => repository.listTenantRequests("tuzzy-test")).toMatchObject([{
        model: "gpt-realtime-whisper", sessionId: "session-1", externalScopeId: "proj-shared",
        result: { sourceKind: "realtime_transcription", transcription: { providerSessionId: "sess-live",
          usage: { type: "duration", seconds: 2.75 } } },
      }]);
      expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"model":"gpt-realtime-whisper"'));
      expect(socket.close).not.toHaveBeenCalled();
    } finally { await pool.end(); }
  });
  it.each([false, true])("continues audio during a slow write and closes safely when storage fails (consumer throws: %s)", async (consumerThrows) => {
    const pool = usageRecordingTestPool();
    let rejectWrite!: (error: Error) => void;
    const gate = new Promise<never>((_resolve, reject) => { rejectWrite = reject; });
    let blockWrites = false;
    const repository = new ProviderUsageRecordingRepository({ query: (...args: unknown[]) => blockWrites ? gate : pool.query(...args) });
    const socket = createSocketLike();
    const transport = new WsPremiumRealtimeProviderTransport(() => socket, { OPENAI_API_KEY: "test-key" }, repository);
    const connection = await transport.connect({ organizationId: "tuzzy-test", workspaceId: "workspace-1",
      actorUserId: "user-1", session: createSession({ runtime: "openai-realtime", model: "gpt-realtime-2.1" }),
      manifest: createManifest() });
    const consumer = vi.fn();
    const closed = vi.fn(() => { if (consumerThrows) throw new Error("consumer failed"); });
    connection.onMessage(consumer);
    connection.onClose(closed);
    blockWrites = true;
    socket.emitMessage(JSON.stringify({ type: "response.created", response: { id: "resp-live" } }));
    socket.emitMessage(JSON.stringify({ type: "response.output_audio.delta", delta: "private-audio" }));
    expect(consumer).toHaveBeenCalledTimes(2);
    rejectWrite(new Error("private database connection secret"));
    await expect.poll(() => closed.mock.calls).toEqual([[{ code: 1011, reason: "Provider usage recording failed." }]]);
    await expect(connection.waitUntilReady()).rejects.toThrow("Provider usage recording failed.");
    expect(socket.close).toHaveBeenCalledWith(1011, "Provider usage recording failed.");
    const sentBeforeFailure = socket.sent.length;
    expect(() => connection.send({ type: "input_audio_buffer.append", audio: "AA==" }))
      .toThrow("Provider connection is closed.");
    expect(socket.sent).toHaveLength(sentBeforeFailure);
    await pool.end();
  });
  it("does not record simulator events as provider usage", async () => {
    const pool = usageRecordingTestPool();
    try {
      const socket = createSocketLike();
      const repository = new ProviderUsageRecordingRepository(pool);
      const transport = new WsPremiumRealtimeProviderTransport(() => socket, {
        NODE_ENV: "test", ZARA_PREMIUM_REALTIME_TRANSPORT: "simulator",
        ZARA_PREMIUM_REALTIME_SIMULATOR_URL: "ws://127.0.0.1:4319/realtime",
      }, repository);
      await transport.connect({ organizationId: "tuzzy-test", workspaceId: "workspace-1", actorUserId: "user-1",
        session: createSession({ runtime: "openai-realtime", model: "gpt-realtime-2.1" }), manifest: createManifest() });
      socket.emitMessage(JSON.stringify({ type: "response.done", response: { id: "resp-sim", status: "completed",
        usage: { input_tokens: 30, output_tokens: 7, total_tokens: 37 } } }));
      await new Promise(resolve => setImmediate(resolve));
      expect(await repository.listTenantRequests("tuzzy-test")).toEqual([]);
    } finally { await pool.end(); }
  });
  it("records live response usage before a consumer attaches and pins the shared project", async () => {
    const pool = usageRecordingTestPool();
    try {
      const socket = createSocketLike();
      const factory = vi.fn(() => socket);
      const repository = new ProviderUsageRecordingRepository(pool);
      const transport = new WsPremiumRealtimeProviderTransport(factory, {
        OPENAI_API_KEY: "test-key", OPENAI_PROJECT_ID: " proj-shared ",
      }, repository);
      const connection = await transport.connect({ organizationId: "tuzzy-test", workspaceId: "workspace-1",
        actorUserId: "user-1", session: createSession({ runtime: "openai-realtime", model: "gpt-realtime-2.1" }),
        manifest: createManifest() });
      socket.emitMessage(JSON.stringify({ type: "response.created", response: { id: "resp-live" } }));
      socket.emitMessage(JSON.stringify({ type: "response.done", response: {
        id: "resp-live", status: "cancelled", usage: { input_tokens: 30, output_tokens: 7, total_tokens: 37 },
      } }));
      const consumer = vi.fn();
      connection.onMessage(consumer);
      socket.emitMessage(JSON.stringify({ type: "response.output_audio.delta", delta: "private-audio" }));
      expect(consumer).toHaveBeenCalledOnce();
      connection.close();
      await expect.poll(() => repository.listTenantRequests("tuzzy-test")).toMatchObject([{
        sessionId: "session-1", externalScopeId: "proj-shared", result: {
          providerRequestId: "resp-live", responseStatus: "cancelled",
          totals: { inputTokens: 30, outputTokens: 7, requestCount: 1 },
        },
      }]);
      expect(factory).toHaveBeenCalledWith(expect.any(String),
        expect.objectContaining({ headers: expect.objectContaining({ "OpenAI-Project": "proj-shared" }) }));
      expect(await repository.listTenantRequests("zara-ai-test")).toEqual([]);
    } finally { await pool.end(); }
  });
  it("correlates simulator calls and active agents without sending provider credentials", async () => {
    const socket = createSocketLike();
    const websocketFactory = vi.fn(() => socket);
    const transport = new WsPremiumRealtimeProviderTransport(websocketFactory, {
      NODE_ENV: "test",
      ZARA_PREMIUM_REALTIME_TRANSPORT: "simulator",
      ZARA_PREMIUM_REALTIME_SIMULATOR_URL: "ws://127.0.0.1:4319/realtime",
    });

    await transport.connect({
      organizationId: "tenant-1",
      workspaceId: "workspace-customer-success",
      actorUserId: "pstn:call-session-1",
      session: createSession({ runtime: "openai-realtime", model: "gpt-realtime-2.1" }),
      manifest: createManifest(),
    });

    expect(websocketFactory).toHaveBeenCalledWith("ws://127.0.0.1:4319/realtime", {
      headers: {
        "X-Zara-Simulator-Agent-Id": "agent-support",
        "X-Zara-Simulator-Call-Id": "call-session-1",
        "X-Zara-Simulator-Model": "gpt-realtime-2.1",
      },
    });
  });

  it("rejects a session whose mutable provider fields drift from its frozen provider contract", async () => {
    const websocketFactory = vi.fn(() => createSocketLike());
    const transport = new WsPremiumRealtimeProviderTransport(websocketFactory);
    const session = createSession({
      runtime: "openai-realtime",
      model: "gpt-realtime",
    });
    session.model = "drifted-model";

    await expect(transport.connect({
      organizationId: "tenant-1",
      workspaceId: "workspace-customer-success",
      actorUserId: "user-1",
      session,
      manifest: createManifest(),
    })).rejects.toThrow("Premium realtime session provider contract does not match the session projection.");
    expect(websocketFactory).not.toHaveBeenCalled();
  });

  it("waits for OpenAI session.updated before reporting ready", async () => {
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const socket = createSocketLike();
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      const connection = await transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: createSession({
          runtime: "openai-realtime",
          model: "gpt-realtime",
        }),
        manifest: createManifest(),
      });
      const ready = vi.fn();
      void connection.waitUntilReady().then(ready);

      await Promise.resolve();
      expect(ready).not.toHaveBeenCalled();

      socket.emitMessage(JSON.stringify({ type: "session.updated" }));
      await expect(connection.waitUntilReady()).resolves.toBeUndefined();
      expect(ready).toHaveBeenCalledOnce();
    } finally {
      if (previousOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiApiKey;
      }
    }
  });

  it("waits for Gemini setupComplete before reporting ready", async () => {
    const previousGeminiApiKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "test-gemini-key";
    const socket = createSocketLike();
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      const connection = await transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: createSession({
          runtime: "gemini-live",
          model: "gemini-3.1-flash-live-preview",
        }),
        manifest: createManifest(),
      });
      const ready = vi.fn();
      void connection.waitUntilReady().then(ready);

      socket.emitMessage(JSON.stringify({ serverContent: {} }));
      await Promise.resolve();
      expect(ready).not.toHaveBeenCalled();

      socket.emitMessage(JSON.stringify({ setupComplete: {} }));
      await expect(connection.waitUntilReady()).resolves.toBeUndefined();
      expect(ready).toHaveBeenCalledOnce();
    } finally {
      if (previousGeminiApiKey === undefined) {
        delete process.env.GEMINI_API_KEY;
      } else {
        process.env.GEMINI_API_KEY = previousGeminiApiKey;
      }
    }
  });

  it("rejects readiness when the provider errors before acknowledgement", async () => {
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const socket = createSocketLike();
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      const connection = await transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: createSession({
          runtime: "openai-realtime",
          model: "gpt-realtime",
        }),
        manifest: createManifest(),
      });
      const readiness = connection.waitUntilReady();

      socket.emitError(new Error("provider setup failed"));

      await expect(readiness).rejects.toThrow("provider setup failed");
      await expect(connection.waitUntilReady()).rejects.toThrow("provider setup failed");
    } finally {
      if (previousOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiApiKey;
      }
    }
  });

  it("rejects readiness when the provider closes before acknowledgement", async () => {
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const socket = createSocketLike();
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      const connection = await transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: createSession({
          runtime: "openai-realtime",
          model: "gpt-realtime",
        }),
        manifest: createManifest(),
      });
      const readiness = connection.waitUntilReady();

      socket.emitClose(1006, "setup rejected");

      await expect(readiness).rejects.toThrow(
        "Provider connection closed before readiness (1006): setup rejected",
      );
    } finally {
      if (previousOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiApiKey;
      }
    }
  });

  it("rejects connection establishment when the provider closes before WebSocket open", async () => {
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const socket = createSocketLike({ readyState: 0 });
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      const connecting = transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: createSession({ runtime: "openai-realtime", model: "gpt-realtime" }),
        manifest: createManifest(),
      });
      socket.emitClose(1006, "closed before open");

      await expect(Promise.race([
        connecting,
        new Promise((_, reject) => setTimeout(() => reject(new Error("connection remained pending")), 50)),
      ])).rejects.toThrow("closed before open");
    } finally {
      if (previousOpenAiApiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousOpenAiApiKey;
    }
  });

  it("replays a terminal close to a handler registered after readiness", async () => {
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const socket = createSocketLike();
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      const connection = await transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: createSession({ runtime: "openai-realtime", model: "gpt-realtime" }),
        manifest: createManifest(),
      });
      socket.emitMessage(JSON.stringify({ type: "session.updated" }));
      await connection.waitUntilReady();
      socket.emitClose(1006, "provider disappeared");
      const closes: Array<{ code: number; reason: string }> = [];
      connection.onClose((event) => closes.push(event));

      expect(closes).toEqual([{ code: 1006, reason: "provider disappeared" }]);
    } finally {
      if (previousOpenAiApiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousOpenAiApiKey;
    }
  });

  it("reports a provider error after readiness as one terminal close", async () => {
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const socket = createSocketLike();
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      const connection = await transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: createSession({ runtime: "openai-realtime", model: "gpt-realtime" }),
        manifest: createManifest(),
      });
      socket.emitMessage(JSON.stringify({ type: "session.updated" }));
      await connection.waitUntilReady();
      const closes: Array<{ code: number; reason: string }> = [];
      connection.onClose((event) => closes.push(event));

      socket.emitError(new Error("provider transport failed"));
      socket.emitClose(1006, "socket closed");

      expect(closes).toEqual([{ code: 1011, reason: "provider transport failed" }]);
    } finally {
      if (previousOpenAiApiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousOpenAiApiKey;
    }
  });

  it("delivers a ready message to a handler registered just after it arrives", async () => {
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const socket = createSocketLike();
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      const connection = await transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: createSession({
          runtime: "openai-realtime",
          model: "gpt-realtime",
        }),
        manifest: createManifest(),
      });
      const readyMessage = JSON.stringify({ type: "session.updated" });
      const received: string[] = [];

      socket.emitMessage(readyMessage);
      connection.onMessage((message) => received.push(message));

      expect(received).toEqual([readyMessage]);
    } finally {
      if (previousOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiApiKey;
      }
    }
  });

  it("reports the provider socket buffered bytes after send", async () => {
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const socket = createSocketLike();
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      const connection = await transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: createSession({
          runtime: "openai-realtime",
          model: "gpt-realtime",
        }),
        manifest: createManifest(),
      });

      connection.send({ type: "input_audio_buffer.append", audio: "AA==" });
      socket.bufferedAmount = 2_048;

      expect(connection.getBufferedAmountBytes()).toBe(2_048);
    } finally {
      if (previousOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiApiKey;
      }
    }
  });

  it("configures OpenAI Realtime from provider-native voice settings, not Cartesia voice config", async () => {
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const socket = createSocketLike();
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      const connection = await transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: {
          sessionId: "session-1",
          manifestId: "manifest-1",
          publishedVersionId: "published-1",
          activeAgentId: "agent-support-node",
          runtime: "openai-realtime",
          policy: "premium-realtime",
          model: "gpt-realtime",
          promptPolicyRevision: 1,
          promptPolicyHash: "a".repeat(64),
          providerConfig: openAiProviderConfig("pstn"),
          voice: "expressive",
          transportUrl: "/runtime/realtime/sessions/session-1/stream",
          expiresAt: "2026-06-14T10:00:00.000Z",
          toolDeclarations: [],
          observedEventTypes: [],
        } satisfies PremiumRealtimeSession,
        manifest: {
          graph: {
            nodes: [
              agentNode("agent-support-node", {
                kind: "specialist",
                name: "Jane",
                instructions: "You are Jane.",
                realtimeVoiceConfig: {
                  provider: "openai-realtime",
                  voice: "cedar",
                  speed: 0.9,
                },
                voiceConfig: {
                  provider: "cartesia",
                  voiceId: "cartesia-catalog-female-1",
                  label: "Female 1",
                  sourceType: "catalog",
                  speed: 1.15,
                },
              }),
            ],
          },
        } as unknown as CompiledRuntimeManifest,
      });

      expect(connection).toBeTruthy();
      expect(JSON.parse(socket.sent[0] ?? "{}")).toMatchObject({
        type: "session.update",
        session: {
          type: "realtime",
          audio: {
            input: {
              format: {
                type: "audio/pcmu",
                },
                transcription: {
                  model: "gpt-realtime-whisper",
                  language: "en",
                },
              turn_detection: {
                type: "semantic_vad",
                eagerness: "low",
                create_response: true,
                interrupt_response: true,
              },
            },
            output: {
              format: {
                type: "audio/pcmu",
              },
              voice: "cedar",
              speed: 0.9,
            },
          },
        },
      });
      expect(String(socket.sent[0])).toContain("Use only English (en)");
      expect(String(socket.sent[0])).toContain('\\"name\\":\\"Jane\\"');
      expect(String(socket.sent[0])).toContain('\\"businessName\\":\\"Zara AI\\"');
      expect(String(socket.sent[0])).not.toContain("New Agent");
    } finally {
      if (previousOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiApiKey;
      }
    }
  });

  it("configures OpenAI Realtime from concrete active agent config", async () => {
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const socket = createSocketLike();
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      await transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: {
          sessionId: "session-1",
          manifestId: "manifest-1",
          publishedVersionId: "published-1",
          activeAgentId: "agent-support-node",
          runtime: "openai-realtime",
          policy: "premium-realtime",
          model: "gpt-realtime",
          promptPolicyRevision: 1,
          promptPolicyHash: "a".repeat(64),
          providerConfig: openAiProviderConfig("browser"),
          voice: "expressive",
          transportUrl: "/runtime/realtime/sessions/session-1/stream",
          expiresAt: "2026-06-14T10:00:00.000Z",
          toolDeclarations: [],
          observedEventTypes: [],
        } satisfies PremiumRealtimeSession,
        manifest: {
          graph: {
            nodes: [
              agentNode("agent-support-node", {
                kind: "support",
                name: "Jane",
                instructions: "Fresh concrete support instructions.",
                realtimeVoiceConfig: {
                  provider: "openai-realtime",
                  voice: "cedar",
                  speed: 0.9,
                },
              }),
            ],
          },
        } as unknown as CompiledRuntimeManifest,
      });

      const setup = JSON.parse(socket.sent[0] ?? "{}") as {
        session?: {
          instructions?: string;
          audio?: {
            output?: {
              voice?: string;
              speed?: number;
            };
          };
        };
      };

      expect(setup.session?.audio?.output?.voice).toBe("cedar");
      expect(setup.session?.audio?.output?.speed).toBe(0.9);
      expect(setup.session?.instructions).toContain('"name":"Jane"');
      expect(setup.session?.instructions).toContain("Fresh concrete support instructions.");
    } finally {
      if (previousOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiApiKey;
      }
    }
  });

  it("builds the premium realtime prompt from the configured role and active tools", async () => {
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const socket = createSocketLike();
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      await transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: createSession({
          runtime: "openai-realtime",
          model: "gpt-realtime-2",
        }),
        manifest: {
          agentToolAssignments: [
            {
              id: "assignment-1",
              agentId: "agent-support",
              toolId: "zendesk.search_tickets",
              label: "Search tickets",
              description: "Find support tickets by email, ticket number, or issue summary.",
              whenToUse: "Use after the caller provides enough account or ticket context.",
              inputSchema: {
                type: "object",
                properties: {
                  query: {
                    type: "string",
                  },
                },
              },
              requiredInputs: ["query"],
              risk: "low",
              requiresHumanApproval: false,
            },
          ],
          graph: {
            nodes: [
              agentNode("agent-support", {
                kind: "specialist",
                name: "Jane",
                instructions: "Handle inbound calls and determine the caller's support needs.",
                toolIds: ["zendesk.search_tickets"],
              }),
            ],
          },
        } as unknown as CompiledRuntimeManifest,
        promptPolicy: {
          ...defaultRuntimePromptPolicy,
          guardrails: ["UNIQUE PLATFORM REALTIME RULE"],
          agentClassTemplates: {
            ...defaultRuntimePromptPolicy.agentClassTemplates,
            custom: {
              ...defaultRuntimePromptPolicy.agentClassTemplates.custom!,
              basePrompt: "UNIQUE SPECIALIST REALTIME RULE",
            },
          },
        },
      });

      const setup = JSON.parse(socket.sent[0] ?? "{}") as {
        session?: {
          instructions?: string;
        };
      };

      expect(setup.session?.instructions).toContain('"name":"Jane"');
      expect(setup.session?.instructions).toContain('"agentClass":"specialist"');
      expect(setup.session?.instructions).toContain("UNIQUE PLATFORM REALTIME RULE");
      expect(setup.session?.instructions).toContain("UNIQUE SPECIALIST REALTIME RULE");
      expect(setup.session?.instructions).toContain(
        "Handle inbound calls and determine the caller's support needs.",
      );
      expect(setup.session?.instructions).toContain("Available Zara tools");
      expect(setup.session?.instructions).toContain("Search tickets");
      expect(setup.session?.instructions).toContain(
        "Use after the caller provides enough account or ticket context.",
      );
      expect(setup.session?.instructions).not.toContain("api.openai.com");
      expect(setup.session?.instructions).not.toContain("credentialRef");
    } finally {
      if (previousOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiApiKey;
      }
    }
  });

  it("keeps OpenAI auto-response enabled when the active agent has an attached route policy", async () => {
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const socket = createSocketLike();
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      await transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: createSession({
          activeAgentId: "agent-front-desk",
          runtime: "openai-realtime",
          model: "gpt-realtime-2",
        }),
        manifest: {
          graph: {
            nodes: [
              agentNode("agent-front-desk", {
                kind: "receptionist",
                name: "Front desk",
                instructions: "Understand the caller and route them when a specialist is needed.",
              }),
              agentNode("agent-billing", {
                kind: "billing",
                name: "Bill",
                instructions: "Handle invoice questions.",
              }),
            ],
          },
          routePolicies: [
            {
              sourceAgentId: "agent-front-desk",
              sourceAgentName: "Front desk",
              type: "route_by_intent",
              trigger: "on_caller_turn_end",
              activation: "until_routed",
              classifier: {
                modelAlias: "intent-classifier-fast",
                confidenceThreshold: 0.65,
              },
              inputWindow: {
                latestCallerTurnOnly: false,
                recentTranscriptTurns: 4,
              },
              readiness: {
                mode: "auto_with_clarification",
                maxClarificationTurns: 1,
              },
              announcement: {
                mode: "template",
                text: "I will route you to {targetAgentName}.",
              },
              branches: [
                {
                  id: "route-billing",
                  label: "Bill",
                  intentKey: "billing",
                  description: "Caller needs help from Bill.",
                  examples: ["I need help with an invoice."],
                  target: {
                    type: "agent",
                    agentId: "agent-billing",
                  },
                },
              ],
              fallback: {
                label: "Keep with front desk",
                target: {
                  type: "clarify_source_agent",
                },
              },
            },
          ],
        } as unknown as CompiledRuntimeManifest,
      });

      const setup = JSON.parse(socket.sent[0] ?? "{}") as {
        session?: {
          instructions?: string;
        };
      };

      expect(setup).toMatchObject({
        session: {
          audio: {
            input: {
              turn_detection: {
                create_response: true,
                interrupt_response: true,
              },
            },
          },
        },
      });
      expect(setup.session?.instructions).toContain("Configured handoff targets:");
      expect(setup.session?.instructions).toContain("agent-billing: Bill (billing).");
      expect(setup.session?.instructions).toContain("Handoff before doing specialist work yourself.");
      expect(setup.session?.instructions).toContain(
        "Do not ask for specialist-specific account, invoice, order, ticket, or payment details before handoff.",
      );
      expect(setup.session?.instructions).not.toContain("route-billing");
      expect(setup.session?.instructions).not.toContain("Caller needs help from Bill.");
    } finally {
      if (previousOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiApiKey;
      }
    }
  });

  it("omits handoff instructions when no route policy is attached to the active agent", async () => {
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const socket = createSocketLike();
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      await transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: createSession({
          activeAgentId: "agent-front-desk",
          runtime: "openai-realtime",
          model: "gpt-realtime-2",
        }),
        manifest: {
          graph: {
            nodes: [
              agentNode("agent-front-desk", {
                kind: "receptionist",
                name: "Front desk",
                instructions: "Understand the caller and route them when a specialist is needed.",
              }),
              agentNode("agent-billing", {
                kind: "billing",
                name: "Billing specialist",
                instructions: "Handle invoice questions.",
              }),
            ],
          },
          routePolicies: [],
        } as unknown as CompiledRuntimeManifest,
      });

      const setup = JSON.parse(socket.sent[0] ?? "{}") as {
        session?: {
          instructions?: string;
        };
      };

      expect(setup.session?.instructions).not.toContain("Configured handoff targets:");
      expect(setup.session?.instructions).not.toContain("Billing specialist");
      expect(setup.session?.instructions).not.toContain("zara_handoff_to_agent");
    } finally {
      if (previousOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiApiKey;
      }
    }
  });

  it("rejects premium realtime transport setup when the active agent is missing from the manifest", async () => {
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const socket = createSocketLike();
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      await expect(transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: createSession({
          runtime: "openai-realtime",
          model: "gpt-realtime-2",
        }),
        manifest: {
          manifestId: "manifest-1",
          graph: {
            nodes: [
              agentNode("agent-other", {
                kind: "support",
                name: "Other",
                instructions: "Handle calls.",
              }),
            ],
          },
        } as unknown as CompiledRuntimeManifest,
      })).rejects.toThrow(
        "Premium realtime active agent 'agent-support' was not found in runtime manifest 'manifest-1'.",
      );
      expect(socket.sent).toEqual([]);
    } finally {
      if (previousOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiApiKey;
      }
    }
  });

  it("defaults OpenAI Realtime to its provider default when only Cartesia TTS config exists", async () => {
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const socket = createSocketLike();
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      await transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: createSession({
          runtime: "openai-realtime",
          model: "gpt-realtime",
        }),
        manifest: {
          graph: {
            nodes: [
              agentNode("agent-support", {
                kind: "specialist",
                name: "Jane",
                instructions: "You are Jane.",
                voiceConfig: {
                  provider: "cartesia",
                  voiceId: "cartesia-catalog-female-1",
                  label: "Female 1",
                  sourceType: "catalog",
                  speed: 1.15,
                },
              }),
            ],
          },
        } as unknown as CompiledRuntimeManifest,
      });

      const setup = JSON.parse(socket.sent[0] ?? "{}") as {
        session?: {
          audio?: {
            output?: Record<string, unknown>;
          };
        };
      };
      expect(setup.session?.audio?.output).toMatchObject({
        voice: "marin",
      });
      expect(setup.session?.audio?.output).not.toHaveProperty("speed");
    } finally {
      if (previousOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiApiKey;
      }
    }
  });

  it("configures Gemini Live from provider-native voice settings", async () => {
    const previousGeminiApiKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "test-gemini-key";
    const socket = createSocketLike();
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      await transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: createSession({
          runtime: "gemini-live",
          model: "gemini-3.1-flash-live-preview",
        }),
        manifest: {
          graph: {
            nodes: [
              agentNode("agent-support", {
                kind: "specialist",
                name: "Jane",
                instructions: "You are Jane.",
                realtimeVoiceConfig: {
                  provider: "gemini-live",
                  voiceName: "Puck",
                },
                voiceConfig: {
                  provider: "cartesia",
                  voiceId: "cartesia-catalog-female-1",
                  label: "Female 1",
                  sourceType: "catalog",
                },
              }),
            ],
          },
        } as unknown as CompiledRuntimeManifest,
      });

      expect(JSON.parse(socket.sent[0] ?? "{}")).toMatchObject({
        setup: {
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Puck",
              },
            },
          },
        },
      });
    } finally {
      if (previousGeminiApiKey === undefined) {
        delete process.env.GEMINI_API_KEY;
      } else {
        process.env.GEMINI_API_KEY = previousGeminiApiKey;
      }
    }
  });
});

function createSession(input: {
  runtime: PremiumRealtimeSession["runtime"];
  model: string;
  activeAgentId?: string | undefined;
}): PremiumRealtimeSession {
  return {
    sessionId: "session-1",
    manifestId: "manifest-1",
    publishedVersionId: "published-1",
    activeAgentId: input.activeAgentId ?? "agent-support",
    runtime: input.runtime,
    policy: "premium-realtime",
    model: input.model,
    promptPolicyRevision: 1,
    promptPolicyHash: "a".repeat(64),
    providerConfig: input.runtime === "gemini-live"
      ? {
          provider: "gemini-live",
          model: input.model,
          mediaProfile: "browser",
          conversationPolicyVersion: 1,
          media: {
            input: { mimeType: "audio/pcm;rate=16000" },
            output: { mimeType: "audio/pcm;rate=24000" },
          },
          activityHandling: { type: "provider_native" },
        }
      : openAiProviderConfig("browser", input.model),
    voice: "expressive",
    transportUrl: "/runtime/realtime/sessions/session-1/stream",
    expiresAt: "2026-06-14T10:00:00.000Z",
    toolDeclarations: [],
    observedEventTypes: [],
  };
}

function openAiProviderConfig(
  mediaProfile: "browser" | "pstn",
  model = "gpt-realtime",
): Extract<PremiumRealtimeSession["providerConfig"], { provider: "openai-realtime" }> {
  return {
    provider: "openai-realtime",
    model,
    mediaProfile,
    conversationPolicyVersion: 1,
    media: mediaProfile === "pstn"
      ? {
          input: { type: "audio/pcmu" },
          output: { type: "audio/pcmu" },
        }
      : {
          input: { type: "audio/pcm", rate: 24_000 },
          output: { type: "audio/pcm", rate: 24_000 },
        },
    turnDetection: {
      type: "semantic_vad",
      eagerness: mediaProfile === "pstn" ? "low" : "auto",
      createResponse: true,
      interruptResponse: true,
    },
  };
}

function agentNode(id: string, role: Record<string, unknown>) {
  return {
    id,
    kind: "agent",
    label: String(role.name ?? id),
    config: {
      role: {
        businessName: "Zara AI",
        defaultModelTier: "standard",
        toolIds: [],
        languagePolicy: {
          defaultLanguage: "en",
          supportedLanguages: ["en"],
          allowMidCallSwitching: false,
        },
        ...role,
      },
    },
  };
}

function createManifest() {
  return {
    manifestId: "manifest-1",
    graph: {
      nodes: [
        agentNode("agent-support", {
          kind: "support",
          name: "Support",
          instructions: "Handle support calls.",
        }),
      ],
    },
  } as unknown as CompiledRuntimeManifest;
}

function createSocketLike(options: { readyState?: number } = {}) {
  const handlers = new Map<string, (...args: never[]) => void>();
  const socket = {
    readyState: options.readyState ?? 1,
    bufferedAmount: 0,
    sent: [] as string[],
    send: vi.fn((message: string) => {
      socket.sent.push(message);
    }),
    close: vi.fn(),
    on: vi.fn((event: string, handler: (...args: never[]) => void) => {
      handlers.set(event, handler);
    }),
    emitMessage(message: string) {
      handlers.get("message")?.(message as never);
    },
    emitError(error: Error) {
      handlers.get("error")?.(error as never);
    },
    emitClose(code: number, reason: string) {
      handlers.get("close")?.(code as never, Buffer.from(reason) as never);
    },
  };

  return socket;
}
