import { describe, expect, it, vi } from "vitest";

import type {
  CompiledRuntimeManifest,
  PremiumRealtimeSession,
  RealtimeToolDeclaration,
  TurnRuntimePacket,
} from "@zara/core";

import type { PremiumRealtimeToolLoopService } from "./premium-realtime-tool-loop.service";
import { RuntimeSessionsService } from "./runtime-sessions.service";

describe("RuntimeSessionsService", () => {
  const declaration: RealtimeToolDeclaration = {
    name: "zara_zendesk_search_tickets_1234abcd",
    toolAssignmentId: "tool-ticket-search",
    toolId: "zendesk.search_tickets",
    label: "Search tickets",
    description: "Search tickets\nRisk: low.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    },
  };

  it("routes OpenAI premium provider messages through the tool loop with session declarations", async () => {
    const loop = createLoop();
    const service = new RuntimeSessionsService(loop);

    const result = await service.processProviderMessage({
      ...baseProviderMessageInput(),
      session: createSession({
        runtime: "openai-realtime",
        toolDeclarations: [declaration],
      }),
      rawProviderMessage: JSON.stringify({
        type: "response.done",
        response: {
          id: "response-1",
          status: "completed",
          output: [
            {
              type: "function_call",
              call_id: "provider-call-1",
              name: declaration.name,
              arguments: "{\"query\":\"account activation\"}",
            },
          ],
        },
      }),
    });

    expect(loop.processOpenAiProviderMessage).toHaveBeenCalledWith(expect.objectContaining({
      declarations: [declaration],
      rawProviderMessage: expect.stringContaining("response.done"),
    }));
    expect(result.providerMessages).toEqual([
      {
        type: "response.create",
      },
    ]);
  });

  it("routes Gemini premium provider messages through the tool loop with session declarations", async () => {
    const loop = createLoop();
    const service = new RuntimeSessionsService(loop);

    const result = await service.processProviderMessage({
      ...baseProviderMessageInput(),
      session: createSession({
        runtime: "gemini-live",
        model: "gemini-live-low-latency-preview",
        toolDeclarations: [declaration],
      }),
      rawProviderMessage: JSON.stringify({
        tool_call: {
          function_calls: [
            {
              id: "provider-call-1",
              name: declaration.name,
              args: {
                query: "account activation",
              },
            },
          ],
        },
      }),
    });

    expect(loop.processGeminiProviderMessage).toHaveBeenCalledWith(expect.objectContaining({
      declarations: [declaration],
      rawProviderMessage: expect.stringContaining("tool_call"),
    }));
    expect(result.providerMessages).toEqual([
      {
        toolResponse: {
          functionResponses: [],
        },
      },
    ]);
  });
});

function baseProviderMessageInput() {
  return {
    organizationId: "tenant-1",
    sessionId: "session-1",
    workspaceId: "workspace-support",
    actorUserId: "user-1",
    manifest: {
      tenantId: "tenant-1",
      toolBindings: [],
    } as unknown as CompiledRuntimeManifest,
    activeRoleId: "agent-support",
    transcript: "Caller needs a ticket update.",
    packet: {
      toolCalls: [],
    } as unknown as TurnRuntimePacket,
    at: "2026-06-14T09:30:00.000Z",
  };
}

function createSession(overrides: Partial<PremiumRealtimeSession> = {}): PremiumRealtimeSession {
  return {
    sessionId: "session-1",
    manifestId: "manifest-1",
    publishedVersionId: "published-1",
    activeRoleId: "agent-support",
    runtime: "openai-realtime",
    policy: "premium-realtime",
    model: "gpt-realtime",
    voice: "expressive",
    transportUrl: "/runtime/realtime/sessions/manifest-1",
    expiresAt: "2026-06-14T10:00:00.000Z",
    toolDeclarations: [],
    observedEventTypes: [],
    ...overrides,
  };
}

function createLoop(): Pick<
  PremiumRealtimeToolLoopService,
  "processOpenAiProviderMessage" | "processGeminiProviderMessage"
> {
  return {
    processOpenAiProviderMessage: vi.fn(async (input) => ({
      packet: input.packet,
      providerMessages: [
        {
          type: "response.create",
        },
      ],
    })),
    processGeminiProviderMessage: vi.fn(async (input) => ({
      packet: input.packet,
      providerMessages: [
        {
          toolResponse: {
            functionResponses: [],
          },
        },
      ],
    })),
  };
}
