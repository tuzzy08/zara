import { vi } from "vitest";
import type { INestApplication } from "@nestjs/common";
import type { Server } from "node:http";
import WebSocket, { type RawData } from "ws";
import type { CompiledRuntimeManifest, PremiumRealtimeSession, TurnRuntimePacket } from "@zara/core";
import { type PremiumRealtimeProviderConnection, type PremiumRealtimeProviderTransport } from "./premium-realtime-provider-transport.js";

export function createRuntimeSessionsService(
  sessionOverrides: Partial<PremiumRealtimeSession> = {},
  options: {
    processProviderMessage?: ReturnType<typeof vi.fn> | undefined;
    consumeRealtimeSessionTransportToken?: ReturnType<typeof vi.fn> | undefined;
  } = {},
) {
  return {
    consumeRealtimeSessionTransportToken: options.consumeRealtimeSessionTransportToken ?? vi.fn(() =>
      createRegisteredSession(sessionOverrides),
    ),
    getRegisteredSession() {
      return createRegisteredSession(sessionOverrides);
    },
    processProviderMessage: options.processProviderMessage ?? vi.fn(async (input: { rawProviderMessage: string }) => ({
      packet: {
        toolCalls: [],
      },
      providerMessages: input.rawProviderMessage.includes("function_call")
        ? [
            {
              type: "response.create",
            },
          ]
        : [],
    })),
    updateRegisteredSession: vi.fn(),
  };
}

export function createRegisteredSession(sessionOverrides: Partial<PremiumRealtimeSession> = {}) {
  const runtime = sessionOverrides.runtime ?? "openai-realtime";
  const model = sessionOverrides.model ?? "gpt-realtime-2";
  return {
    organizationId: "tenant-1",
    workspaceId: "workspace-customer-success",
    actorUserId: "user-1",
    activeAgentId: sessionOverrides.activeAgentId ?? "agent-support",
    transcript: "",
    session: {
      sessionId: "session-1",
      manifestId: "manifest-1",
      publishedVersionId: "published-1",
      activeAgentId: "agent-support",
      runtime,
      policy: "premium-realtime",
      model,
      voice: "expressive",
      transportUrl: "/runtime/realtime/sessions/session-1/stream?token=token-1",
      expiresAt: "2026-06-14T10:00:00.000Z",
      toolDeclarations: [],
      observedEventTypes: [],
      ...sessionOverrides,
      providerConfig: sessionOverrides.providerConfig ?? websocketTestProviderConfig(runtime, model),
    } satisfies PremiumRealtimeSession,
    manifest: {
      tenantId: "tenant-1",
      workspaceId: "workspace-customer-success",
      manifestId: "manifest-1",
      graph: {
        nodes: [
          {
            id: "agent-front",
            kind: "agent",
            label: "Front desk",
            position: { x: 0, y: 0 },
            config: {},
          },
          {
            id: "agent-billing",
            kind: "agent",
            label: "Billing specialist",
            position: { x: 0, y: 0 },
            config: {},
          },
        ],
        edges: [],
      },
      routePolicies: [
        {
          sourceAgentId: "agent-front",
          sourceAgentName: "Front desk",
          type: "route_by_intent",
          trigger: "on_caller_turn_end",
          activation: "until_routed",
          branches: [],
          fallback: {
            label: "Clarify",
            target: {
              type: "clarify_source_agent",
            },
          },
        },
      ],
      toolBindings: [],
    } as unknown as CompiledRuntimeManifest,
    packet: {
      toolCalls: [],
    } as unknown as TurnRuntimePacket,
  };
}

export function websocketTestProviderConfig(runtime: PremiumRealtimeSession["runtime"], model: string) {
  return runtime === "gemini-live"
    ? {
        provider: "gemini-live" as const,
        model,
        mediaProfile: "browser" as const,
        conversationPolicyVersion: 1,
        media: {
          input: { mimeType: "audio/pcm;rate=16000" as const },
          output: { mimeType: "audio/pcm;rate=24000" as const },
        },
        activityHandling: { type: "provider_native" as const },
      }
    : {
        provider: "openai-realtime" as const,
        model,
        mediaProfile: "browser" as const,
        conversationPolicyVersion: 1,
        media: {
          input: { type: "audio/pcm" as const, rate: 24_000 as const },
          output: { type: "audio/pcm" as const, rate: 24_000 as const },
        },
        turnDetection: {
          type: "semantic_vad" as const,
          eagerness: "auto" as const,
          createResponse: true,
          interruptResponse: true,
        },
      };
}

export function packetWithToolLifecycleEvents(): TurnRuntimePacket {
  return {
    schemaVersion: "turn-runtime-packet.v1",
    ids: {
      tenantId: "tenant-1",
      workspaceId: "workspace-customer-success",
      callSessionId: "session-1",
      turnId: "session-1:turn:1",
      manifestId: "manifest-1",
      manifestVersion: 1,
    },
    timing: {
      startedAt: "2026-06-14T09:00:00.000Z",
      sequence: 5,
    },
    callerInput: {
      latestCallerTurn: "Caller needs a ticket update.",
      source: "voice",
      recentTranscript: [],
    },
    graph: {
      entryNodeId: "agent-support",
      currentNodeId: "agent-support",
      visitedNodeIds: [],
      frontierNodeIds: ["agent-support"],
    },
    availableTools: [],
    availableActions: [],
    toolCalls: [],
    safety: {
      untrustedSources: ["caller_transcript", "tool_output"],
      redactionApplied: true,
      maxModelContextBytes: 24_000,
    },
    diagnostics: {
      warnings: [],
      events: [
        {
          type: "tool.requested",
          at: "2026-06-14T09:00:00.000Z",
          turnId: "session-1:turn:1",
          sequence: 1,
          nodeId: "agent-support",
          payload: {
            toolCallId: "provider-call-1",
            toolAssignmentId: "tool-ticket-search",
            reason: "Provider requested a realtime tool call.",
          },
        },
        {
          type: "tool.started",
          at: "2026-06-14T09:00:00.000Z",
          turnId: "session-1:turn:1",
          sequence: 2,
          nodeId: "agent-support",
          payload: {
            toolCallId: "provider-call-1",
            toolAssignmentId: "tool-ticket-search",
            toolId: "zendesk.search_tickets",
            toolName: "Search tickets",
          },
        },
        {
          type: "tool.completed",
          at: "2026-06-14T09:00:00.000Z",
          turnId: "session-1:turn:1",
          sequence: 3,
          nodeId: "agent-support",
          payload: {
            toolCallId: "provider-call-1",
            toolAssignmentId: "tool-ticket-search",
            toolId: "zendesk.search_tickets",
            toolName: "Search tickets",
            status: "completed",
            summary: "Found one open ticket.",
            durationMs: 25,
            idempotencyKey: "session-1:turn-1:tool-ticket-search:provider-call-1",
            safeOutput: {
              count: 1,
            },
          },
        },
        {
          type: "tool.failed",
          at: "2026-06-14T09:00:00.000Z",
          turnId: "session-1:turn:1",
          sequence: 4,
          nodeId: "agent-support",
          payload: {
            toolCallId: "provider-call-2",
            toolAssignmentId: "tool-ticket-search",
            toolId: "zendesk.search_tickets",
            toolName: "Search tickets",
            status: "failed",
            summary: "Zendesk was unavailable.",
            durationMs: 10,
            idempotencyKey: "session-1:turn-1:tool-ticket-search:provider-call-2",
            error: {
              code: "provider.unavailable",
              message: "Provider unavailable.",
              recoverable: true,
            },
          },
        },
        {
          type: "tool.approval_required",
          at: "2026-06-14T09:00:00.000Z",
          turnId: "session-1:turn:1",
          sequence: 5,
          nodeId: "agent-support",
          payload: {
            toolCallId: "provider-call-3",
            toolAssignmentId: "tool-ticket-search",
            toolId: "zendesk.search_tickets",
            toolName: "Search tickets",
            status: "approval_required",
            summary: "Tool requires human approval.",
            durationMs: 0,
            idempotencyKey: "session-1:turn-1:tool-ticket-search:provider-call-3",
            error: {
              code: "tool_approval.required",
              message: "Human approval is required before executing this tool.",
              recoverable: true,
            },
          },
        },
      ],
    },
  };
}

export class FakePremiumRealtimeProviderTransport implements PremiumRealtimeProviderTransport {
  readonly connections: Array<{
    input: Parameters<PremiumRealtimeProviderTransport["connect"]>[0];
    connection: FakePremiumRealtimeProviderConnection;
  }> = [];

  async connect(input: Parameters<PremiumRealtimeProviderTransport["connect"]>[0]) {
    const connection = new FakePremiumRealtimeProviderConnection();
    this.connections.push({ input, connection });
    return connection;
  }
}

export class FakePremiumRealtimeProviderConnection implements PremiumRealtimeProviderConnection {
  readonly sent: Array<Record<string, unknown>> = [];
  private messageHandler: ((message: string) => void) | null = null;
  private closeHandler: ((event: { code: number; reason: string }) => void) | null = null;

  send(message: Record<string, unknown>) {
    this.sent.push(message);
  }

  getBufferedAmountBytes() {
    return 0;
  }

  waitUntilReady() {
    return Promise.resolve();
  }

  close(code = 1000, reason = "closed") {
    this.closeHandler?.({ code, reason });
  }

  onMessage(handler: (message: string) => void) {
    this.messageHandler = handler;
  }

  onClose(handler: (event: { code: number; reason: string }) => void) {
    this.closeHandler = handler;
  }

  emitMessage(message: string) {
    this.messageHandler?.(message);
  }
}

export function getListeningPort(app: INestApplication) {
  const server = app.getHttpServer() as Server;
  const address = server.address();
  if (typeof address === "object" && address !== null) {
    return address.port;
  }
  throw new Error("Nest test app is not listening on a TCP port.");
}

export function nextOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

export function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.once("message", (message: RawData) => {
      try {
        resolve(JSON.parse(message.toString()) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
    socket.once("error", reject);
  });
}

export function nextClose(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    socket.once("close", () => resolve());
  });
}

export function nextCloseWithReason(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.once("close", (code, reason) => {
      resolve({
        code,
        reason: reason.toString("utf8"),
      });
    });
  });
}

export async function waitFor(predicate: () => boolean) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 1000) {
      throw new Error("Timed out waiting for predicate.");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), 1000);
    }),
  ]);
}

export function encodePcm16(samples: number[]) {
  const buffer = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => {
    const clipped = Math.max(-1, Math.min(1, sample));
    const value = clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff;
    buffer.writeInt16LE(value, index * 2);
  });
  return buffer.toString("base64");
}

export function decodePcm16SampleCount(audioBase64: string) {
  return Math.floor(Buffer.from(audioBase64, "base64").byteLength / 2);
}
