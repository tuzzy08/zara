import { describe, expect, it } from "vitest";
import type { CompiledRuntimeManifest, RealtimeToolDeclaration } from "@zara/core";
import { RuntimeSessionsService } from "./runtime-sessions.service";
import { baseProviderMessageInput, createSession, basePacket, buildRoutePolicyManifest, buildRoutePolicyManifestWithCatalogZendeskSchema, buildStaleRoutePolicyManifest, buildGeminiRoutePolicyManifest, openAiResponseCreated, createLoop } from "./runtime-sessions.service.test-support";

describe("RuntimeSessionsService handoff-safety", () => {
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

  it("hydrates provider connector schemas after an OpenAI handoff", async () => {
      const service = new RuntimeSessionsService(createLoop());
      const manifest = buildRoutePolicyManifestWithCatalogZendeskSchema();
      const session = await service.createRealtimeSession({
        manifest,
        activeAgentId: "agent-front",
        budgetAllowed: true,
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        now: "2026-06-14T09:30:00.000Z",
      });

      await service.processProviderMessage({
        ...baseProviderMessageInput(),
        session,
        manifest,
        activeAgentId: "agent-front",
        transcript: "Francis needs support ticket help.",
        packet: basePacket(),
        rawProviderMessage: JSON.stringify({
          type: "response.done",
          response: {
            id: "response-1",
            status: "completed",
            output: [
              {
                type: "function_call",
                call_id: "provider-handoff-1",
                name: "zara_handoff_to_agent",
                arguments: JSON.stringify({
                  targetAgentId: "agent-billing",
                  reason: "Caller needs support ticket help.",
                  callerNeedSummary: "Francis wants help searching Zendesk tickets.",
                }),
              },
            ],
          },
        }),
      });

      await service.processProviderMessage({
        ...baseProviderMessageInput(),
        session,
        manifest,
        activeAgentId: "agent-front",
        transcript: "Francis needs support ticket help.",
        packet: basePacket(),
        rawProviderMessage: openAiResponseCreated("response-announcement"),
      });

      const handoffResult = await service.processProviderMessage({
        ...baseProviderMessageInput(),
        session,
        manifest,
        activeAgentId: "agent-front",
        transcript: "Francis needs support ticket help.",
        packet: basePacket(),
        rawProviderMessage: JSON.stringify({
          type: "response.done",
          response: {
            id: "response-announcement",
            status: "completed",
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: "I'll connect you with Billing specialist.",
                  },
                ],
              },
            ],
          },
        }),
      });

      const zendeskToolDeclaration = handoffResult.session?.toolDeclarations.find(
        (tool) => tool.toolId === "zendesk.tickets.search",
      );

      expect(zendeskToolDeclaration?.inputSchema).toEqual({
        type: "object",
        required: [],
        additionalProperties: false,
        properties: {
          ticketId: expect.objectContaining({ type: "string" }),
          subject: expect.objectContaining({ type: "string" }),
          requesterEmail: expect.objectContaining({ type: "string", format: "email" }),
          status: expect.objectContaining({ type: "string", enum: ["new", "open", "pending", "solved"] }),
          query: expect.objectContaining({ type: "string" }),
        },
      });
      expect(zendeskToolDeclaration?.inputSchema).not.toHaveProperty("anyOf");
      expect(zendeskToolDeclaration?.description).toContain(
        "Requires one of: ticketId, subject, requesterEmail, status, query.",
      );
      expect(zendeskToolDeclaration?.description).toContain(
        "If none is known, ask the caller for one of those values before using this tool.",
      );
      expect(handoffResult.packet.availableTools).toEqual([
        expect.objectContaining({
          id: "assignment-search-invoices",
          toolId: "zendesk.tickets.search",
          inputSchema: {
            type: "object",
            required: [],
            additionalProperties: false,
            properties: {
              ticketId: expect.objectContaining({ type: "string" }),
              subject: expect.objectContaining({ type: "string" }),
              requesterEmail: expect.objectContaining({ type: "string", format: "email" }),
              status: expect.objectContaining({ type: "string", enum: ["new", "open", "pending", "solved"] }),
              query: expect.objectContaining({ type: "string" }),
            },
          },
          requiredAlternatives: [
            ["ticketId"],
            ["subject"],
            ["requesterEmail"],
            ["status"],
            ["query"],
          ],
          requiredInputs: [],
        }),
      ]);
    });

  it("keeps the source agent active when an internal handoff target is unknown", async () => {
      const loop = createLoop();
      const service = new RuntimeSessionsService(loop);
      const manifest = buildRoutePolicyManifest();
      const session = await service.createRealtimeSession({
        manifest,
        activeAgentId: "agent-front",
        budgetAllowed: true,
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        now: "2026-06-14T09:30:00.000Z",
      });

      const result = await service.processProviderMessage({
        ...baseProviderMessageInput(),
        session,
        manifest,
        activeAgentId: "agent-front",
        transcript: "Caller has a billing question.",
        packet: basePacket(),
        rawProviderMessage: JSON.stringify({
          type: "response.done",
          response: {
            id: "response-1",
            status: "completed",
            output: [
              {
                type: "function_call",
                call_id: "provider-handoff-unknown",
                name: "zara_handoff_to_agent",
                arguments: JSON.stringify({
                  targetAgentId: "agent-not-configured",
                  reason: "The model invented a target.",
                  callerNeedSummary: "Caller has a billing question.",
                }),
              },
            ],
          },
        }),
      });

      expect(loop.processOpenAiProviderMessage).not.toHaveBeenCalled();
      expect(result.activeAgentId).toBe("agent-front");
      expect(result.session).toMatchObject({
        activeAgentId: "agent-front",
      });
      expect(result.routeEvents).toEqual([]);
      expect(result.packet.transfer).toBeUndefined();
      expect(result.packet.intent).toBeUndefined();
      expect(result.packet.diagnostics.warnings).toEqual([]);
      expect(result.providerMessages).toEqual([
        expect.objectContaining({
          type: "conversation.item.create",
          item: expect.objectContaining({
            type: "function_call_output",
            call_id: "provider-handoff-unknown",
          }),
        }),
        {
          type: "response.create",
        },
      ]);
      const handoffToolOutputMessage = result.providerMessages[0] as {
        item?: {
          output?: string;
        };
      };
      expect(JSON.parse(handoffToolOutputMessage.item?.output ?? "{}")).toMatchObject({
        status: "failed",
        targetAgentId: "agent-not-configured",
        activeAgentId: "agent-front",
        error: {
          code: "handoff_tool.invalid_target",
        },
      });
    });

  it("rejects unknown provider handoff targets instead of using an agent fallback", async () => {
      const loop = createLoop();
      const service = new RuntimeSessionsService(loop);
      const baseManifest = buildRoutePolicyManifest();
      const manifest = {
        ...baseManifest,
        routePolicies: [
          {
            ...baseManifest.routePolicies[0]!,
            fallback: {
              label: "Billing fallback",
              target: {
                type: "agent",
                agentId: "agent-billing",
              },
            },
          },
        ],
      } as CompiledRuntimeManifest;
      const session = await service.createRealtimeSession({
        manifest,
        activeAgentId: "agent-front",
        budgetAllowed: true,
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        now: "2026-06-14T09:30:00.000Z",
      });

      const result = await service.processProviderMessage({
        ...baseProviderMessageInput(),
        session,
        manifest,
        activeAgentId: "agent-front",
        transcript: "Caller has a billing question.",
        packet: basePacket(),
        rawProviderMessage: JSON.stringify({
          type: "response.done",
          response: {
            id: "response-1",
            status: "completed",
            output: [
              {
                type: "function_call",
                call_id: "provider-handoff-unknown-with-agent-fallback",
                name: "zara_handoff_to_agent",
                arguments: JSON.stringify({
                  targetAgentId: "agent-not-configured",
                  reason: "The model invented a target.",
                  callerNeedSummary: "Caller has a billing question.",
                }),
              },
            ],
          },
        }),
      });

      expect(loop.processOpenAiProviderMessage).not.toHaveBeenCalled();
      expect(result.activeAgentId).toBe("agent-front");
      expect(result.session).toMatchObject({
        activeAgentId: "agent-front",
      });
      expect(result.routeEvents).toEqual([]);
      expect(result.packet.transfer).toBeUndefined();
      expect(result.packet.intent).toBeUndefined();
      const handoffToolOutputMessage = result.providerMessages[0] as {
        item?: {
          output?: string;
        };
      };
      expect(JSON.parse(handoffToolOutputMessage.item?.output ?? "{}")).toMatchObject({
        status: "failed",
        targetAgentId: "agent-not-configured",
        activeAgentId: "agent-front",
        error: {
          code: "handoff_tool.invalid_target",
        },
      });
    });

  it("rejects stale graph handoff targets without falling back to node labels", async () => {
      const loop = createLoop();
      const service = new RuntimeSessionsService(loop);
      const manifest = buildStaleRoutePolicyManifest();
      const session = await service.createRealtimeSession({
        manifest,
        activeAgentId: "agent-front",
        budgetAllowed: true,
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        now: "2026-06-14T09:30:00.000Z",
      });

      const result = await service.processProviderMessage({
        ...baseProviderMessageInput(),
        session,
        manifest,
        activeAgentId: "agent-front",
        transcript: "Caller asked for the old specialist.",
        packet: basePacket(),
        rawProviderMessage: JSON.stringify({
          type: "response.done",
          response: {
            id: "response-1",
            status: "completed",
            output: [
              {
                type: "function_call",
                call_id: "provider-handoff-stale",
                name: "zara_handoff_to_agent",
                arguments: JSON.stringify({
                  targetAgentId: "agent-stale",
                  reason: "Caller asked for the old specialist.",
                  callerNeedSummary: "Caller wants the old specialist.",
                }),
              },
            ],
          },
        }),
      });

      expect(result.activeAgentId).toBe("agent-front");
      expect(result.session).toMatchObject({
        activeAgentId: "agent-front",
      });
      expect(result.routeEvents).toEqual([]);
      expect(result.packet.transfer).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain("New Agent");
      const handoffToolOutputMessage = result.providerMessages[0] as {
        item?: {
          output?: string;
        };
      };
      expect(JSON.parse(handoffToolOutputMessage.item?.output ?? "{}")).toMatchObject({
        status: "failed",
        targetAgentId: "agent-stale",
        activeAgentId: "agent-front",
        error: {
          code: "handoff_tool.invalid_target",
        },
      });
    });

  it("warns when a provider requests handoff from an agent without a handoff policy", async () => {
      const loop = createLoop();
      const service = new RuntimeSessionsService(loop);
      const manifest = {
        ...buildRoutePolicyManifest(),
        routePolicies: [],
      } as CompiledRuntimeManifest;
      const session = await service.createRealtimeSession({
        manifest,
        activeAgentId: "agent-front",
        budgetAllowed: true,
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        now: "2026-06-14T09:30:00.000Z",
      });

      const result = await service.processProviderMessage({
        ...baseProviderMessageInput(),
        session,
        manifest,
        activeAgentId: "agent-front",
        transcript: "Caller has a billing question.",
        packet: basePacket(),
        rawProviderMessage: JSON.stringify({
          type: "response.done",
          response: {
            id: "response-1",
            status: "completed",
            output: [
              {
                type: "function_call",
                call_id: "provider-handoff-no-policy",
                name: "zara_handoff_to_agent",
                arguments: JSON.stringify({
                  targetAgentId: "agent-billing",
                  reason: "Caller needs billing support.",
                  callerNeedSummary: "Caller has a billing question.",
                }),
              },
            ],
          },
        }),
      });

      expect(loop.processOpenAiProviderMessage).not.toHaveBeenCalled();
      expect(result.activeAgentId).toBe("agent-front");
      const handoffToolOutputMessage = result.providerMessages[0] as {
        item?: {
          output?: string;
        };
      };
      expect(JSON.parse(handoffToolOutputMessage.item?.output ?? "{}")).toMatchObject({
        status: "failed",
        activeAgentId: "agent-front",
        error: {
          code: "handoff_tool.policy_missing",
        },
      });
      expect(result.packet.diagnostics.warnings).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: "handoff_tool.policy_missing",
        }),
      ]));
    });

  it("keeps the source agent active when OpenAI internal handoff arguments are malformed", async () => {
      const loop = createLoop();
      const service = new RuntimeSessionsService(loop);
      const manifest = buildRoutePolicyManifest();
      const session = await service.createRealtimeSession({
        manifest,
        activeAgentId: "agent-front",
        budgetAllowed: true,
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        now: "2026-06-14T09:30:00.000Z",
      });

      const result = await service.processProviderMessage({
        ...baseProviderMessageInput(),
        session,
        manifest,
        activeAgentId: "agent-front",
        transcript: "Caller has a billing question.",
        packet: basePacket(),
        rawProviderMessage: JSON.stringify({
          type: "response.done",
          response: {
            id: "response-1",
            status: "completed",
            output: [
              {
                type: "function_call",
                call_id: "provider-handoff-malformed",
                name: "zara_handoff_to_agent",
                arguments: "{not-json",
              },
            ],
          },
        }),
      });

      expect(loop.processOpenAiProviderMessage).not.toHaveBeenCalled();
      expect(result.activeAgentId).toBe("agent-front");
      expect(result.routeEvents).toEqual([]);
      expect(result.packet.transfer).toBeUndefined();
      expect(result.providerMessages).toEqual([
        expect.objectContaining({
          type: "conversation.item.create",
          item: expect.objectContaining({
            type: "function_call_output",
            call_id: "provider-handoff-malformed",
          }),
        }),
        {
          type: "response.create",
        },
      ]);
      const handoffToolOutputMessage = result.providerMessages[0] as {
        item?: {
          output?: string;
        };
      };
      expect(JSON.parse(handoffToolOutputMessage.item?.output ?? "{}")).toMatchObject({
        status: "failed",
        targetAgentId: null,
        activeAgentId: "agent-front",
        error: {
          code: "handoff_tool.invalid_target",
        },
      });
    });

  it("handles Gemini internal handoff tool calls without executing connector grants", async () => {
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

  it("handles Gemini internal handoff tool calls without executing connector grants", async () => {
      const loop = createLoop();
      const service = new RuntimeSessionsService(loop);
      const manifest = buildGeminiRoutePolicyManifest();
      const session = await service.createRealtimeSession({
        manifest,
        activeAgentId: "agent-front",
        budgetAllowed: true,
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        now: "2026-06-14T09:30:00.000Z",
      });

      const result = await service.processProviderMessage({
        ...baseProviderMessageInput(),
        session,
        manifest,
        activeAgentId: "agent-front",
        transcript: "Francis needs invoice status help.",
        packet: basePacket(),
        rawProviderMessage: JSON.stringify({
          tool_call: {
            function_calls: [
              {
                id: "gemini-route-1",
                name: "zara_handoff_to_agent",
                args: {
                  targetAgentId: "agent-billing",
                  reason: "Caller needs invoice status support.",
                  callerNeedSummary: "Francis wants the status of a pending invoice.",
                },
              },
            ],
          },
        }),
      });

      expect(loop.processGeminiProviderMessage).not.toHaveBeenCalled();
      expect(result.activeAgentId).toBe("agent-billing");
      expect(result.session).toMatchObject({
        activeAgentId: "agent-billing",
        runtime: "gemini-live",
        toolDeclarations: [
          expect.objectContaining({
            label: "Search invoices",
          }),
        ],
      });
      expect(result.routeEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "agent.route.announcement",
        }),
        expect.objectContaining({
          type: "agent.handoff.requested",
          payload: expect.objectContaining({
            targetAgentId: "agent-billing",
          }),
        }),
      ]));
      expect(result.providerMessages).toEqual([
        {
          toolResponse: {
            functionResponses: [
              {
                id: "gemini-route-1",
                name: "zara_handoff_to_agent",
                response: expect.objectContaining({
                  status: "completed",
                  targetAgentId: "agent-billing",
                  activeAgentId: "agent-billing",
                }),
              },
            ],
          },
        },
      ]);
    });
});
