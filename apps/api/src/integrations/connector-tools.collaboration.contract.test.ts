import request from "supertest";import { afterEach, describe, expect, it, vi } from "vitest";import { connectIntegration, createTestingApp, findToolSchema, jsonResponse } from "./connector-tools.contract.test-support";

describe("connector provider contracts", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("executes Notion search and page creation through server-owned Notion API contracts", async () => {
    const app = await createTestingApp();
    const connectionId = await connectIntegration(app, "notion", [
      "search:read",
      "pages:write",
      "tasks:write",
    ]);
    const accessToken = "notion:access:notion-oauth-code-contract";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          results: [
            {
              id: "notion-page-refund",
              url: "https://notion.so/notion-page-refund",
              properties: {
                title: {
                  title: [
                    {
                      plain_text: "Refund policy",
                    },
                  ],
                },
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          id: "notion-page-summary",
          url: "https://notion.so/notion-page-summary",
          properties: {
            title: {
              title: [
                {
                  plain_text: "Billing call summary",
                },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          id: "notion-task-ada",
          url: "https://notion.so/notion-task-ada",
          properties: {
            title: {
              title: [
                {
                  plain_text: "Follow up with Ada",
                },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(429, { object: "error", code: "rate_limited" }, { "retry-after": "36" }));
    vi.stubGlobal("fetch", fetchMock);

    const searchResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/notion/tools/notion.knowledge.search/execute")
      .send({
        connectionId,
        input: {
          query: "refund policy",
        },
      });

    expect(searchResponse.status).toBe(201);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.notion.com/v1/search",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          "Notion-Version": "2022-06-28",
        }),
        body: JSON.stringify({
          query: "refund policy",
          page_size: 5,
        }),
      }),
    );
    expect(searchResponse.body.result).toEqual({
      provider: "notion",
      toolId: "notion.knowledge.search",
      workspaceId: "notion:local-account",
      results: [
        {
          id: "notion-page-refund",
          title: "Refund policy",
          uri: "https://notion.so/notion-page-refund",
        },
      ],
    });
    expect(JSON.stringify(searchResponse.body)).not.toContain(accessToken);

    const pageResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/notion/tools/notion.pages.create/execute")
      .send({
        connectionId,
        input: {
          title: "Billing call summary",
          body: "Caller needs a refund policy follow-up.",
          parentPageId: "page-ops",
        },
      });

    expect(pageResponse.status).toBe(201);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.notion.com/v1/pages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          "Notion-Version": "2022-06-28",
        }),
        body: JSON.stringify({
          parent: {
            page_id: "page-ops",
          },
          properties: {
            title: {
              title: [
                {
                  type: "text",
                  text: {
                    content: "Billing call summary",
                  },
                },
              ],
            },
          },
          children: [
            {
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: [
                  {
                    type: "text",
                    text: {
                      content: "Caller needs a refund policy follow-up.",
                    },
                  },
                ],
              },
            },
          ],
        }),
      }),
    );
    expect(pageResponse.body.result).toEqual({
      provider: "notion",
      toolId: "notion.pages.create",
      page: {
        id: "notion-page-summary",
        workspaceId: "notion:local-account",
        title: "Billing call summary",
        body: "Caller needs a refund policy follow-up.",
        parentPageId: "page-ops",
        uri: "https://notion.so/notion-page-summary",
      },
    });
    expect(JSON.stringify(pageResponse.body)).not.toContain(accessToken);

    const taskResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/notion/tools/notion.tasks.create/execute")
      .send({
        connectionId,
        input: {
          title: "Follow up with Ada",
          assigneeEmail: "ops@example.com",
        },
      });

    expect(taskResponse.status).toBe(201);
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://api.notion.com/v1/pages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          "Notion-Version": "2022-06-28",
        }),
        body: JSON.stringify({
          parent: {
            page_id: "notion:local-account",
          },
          properties: {
            title: {
              title: [
                {
                  type: "text",
                  text: {
                    content: "Follow up with Ada",
                  },
                },
              ],
            },
          },
          children: [
            {
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: [
                  {
                    type: "text",
                    text: {
                      content: "Assignee: ops@example.com",
                    },
                  },
                ],
              },
            },
          ],
        }),
      }),
    );
    expect(taskResponse.body.result).toEqual({
      provider: "notion",
      toolId: "notion.tasks.create",
      task: {
        id: "notion-task-ada",
        workspaceId: "notion:local-account",
        title: "Follow up with Ada",
        assigneeEmail: "ops@example.com",
        status: "open",
        uri: "https://notion.so/notion-task-ada",
      },
    });
    expect(JSON.stringify(taskResponse.body)).not.toContain(accessToken);

    const invalidInputResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/notion/tools/notion.pages.create/execute")
      .send({
        connectionId,
        input: {
          title: "Billing call summary",
        },
      });

    expect(invalidInputResponse.status).toBe(400);
    expect(invalidInputResponse.body.message).toContain("body");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const rateLimitResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/notion/tools/notion.knowledge.search/execute")
      .send({
        connectionId,
        input: {
          query: "refund policy",
        },
      });

    expect(rateLimitResponse.status).toBe(429);
    expect(rateLimitResponse.body).toMatchObject({
      provider: "notion",
      toolId: "notion.knowledge.search",
      code: "tool_execution.rate_limited",
      recoverable: true,
      retryAfterSeconds: 36,
    });
    expect(JSON.stringify(rateLimitResponse.body)).not.toContain(accessToken);

    await app.close();
  }, 15_000);

  it("executes Slack bounded notification tools only to configured destinations", async () => {
    const app = await createTestingApp();
    const connectionId = await connectIntegration(app, "slack", [
      "chat:write",
      "channels:read",
      "groups:read",
      "team:read",
    ]);
    const accessToken = "slack:access:slack-oauth-code-contract";

    const destinationResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/slack/destinations")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        connectionId,
        destinations: [
          {
            id: "support-escalations",
            label: "Support escalations",
            channelId: "C123SUPPORT",
            channelName: "support-escalations",
            purpose: "escalation",
          },
          {
            id: "call-summaries",
            label: "Call summaries",
            channelId: "C456SUMMARY",
            channelName: "call-summaries",
            purpose: "post-call-summary",
          },
          {
            id: "support-alerts",
            label: "Support alerts",
            channelId: "C789ALERTS",
            channelName: "support-alerts",
            purpose: "alert",
          },
        ],
      });

    expect(destinationResponse.status).toBe(201);
    expect(destinationResponse.body.destinations).toEqual([
      expect.objectContaining({
        id: "support-escalations",
        label: "Support escalations",
        channelId: "C123SUPPORT",
        purpose: "escalation",
      }),
      expect.objectContaining({
        id: "call-summaries",
        label: "Call summaries",
        channelId: "C456SUMMARY",
        purpose: "post-call-summary",
      }),
      expect.objectContaining({
        id: "support-alerts",
        label: "Support alerts",
        channelId: "C789ALERTS",
        purpose: "alert",
      }),
    ]);
    expect(JSON.stringify(destinationResponse.body)).not.toContain(accessToken);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, channel: "C123SUPPORT", ts: "1717690000.000100" }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, channel: "C456SUMMARY", ts: "1717690001.000200" }))
      .mockResolvedValueOnce(jsonResponse(429, { ok: false, error: "ratelimited" }, { "retry-after": "24" }));
    vi.stubGlobal("fetch", fetchMock);

    const escalationResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/slack/tools/slack.escalations.post/execute")
      .send({
        connectionId,
        idempotencyKey: "call-1:turn-7:slack-escalation",
        input: {
          callerName: "Ada Lovelace",
          reason: "Billing specialist requested",
          urgency: "high",
          safeSummary: "Caller needs renewal pricing reviewed by billing.",
          message: "Post this arbitrary freeform text instead.",
        },
      });

    expect(escalationResponse.status, JSON.stringify(escalationResponse.body)).toBe(201);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://slack.com/api/chat.postMessage",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        }),
      }),
    );
    const escalationBody = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(escalationBody).toMatchObject({
      channel: "C123SUPPORT",
      text: "Escalation requested for Ada Lovelace",
      metadata: {
        event_type: "zara_slack_escalation",
        event_payload: {
          idempotency_key: "call-1:turn-7:slack-escalation",
          destination_id: "support-escalations",
        },
      },
    });
    expect(JSON.stringify(escalationBody)).toContain("Billing specialist requested");
    expect(JSON.stringify(escalationBody)).not.toContain("Post this arbitrary freeform text instead.");
    expect(escalationResponse.body.result).toEqual({
      provider: "slack",
      toolId: "slack.escalations.post",
      message: {
        destinationId: "support-escalations",
        channelId: "C123SUPPORT",
        ts: "1717690000.000100",
        template: "escalation",
        idempotencyKey: "call-1:turn-7:slack-escalation",
      },
    });

    const summaryResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/slack/tools/slack.call_summaries.post/execute")
      .send({
        connectionId,
        idempotencyKey: "call-1:summary-1:slack-summary",
        input: {
          summaryId: "summary-1",
          outcome: "resolved",
          safeSummary: "Billing question resolved with a follow-up email.",
          actionItems: "Send renewal terms by Monday.",
        },
      });

    expect(summaryResponse.status).toBe(201);
    const summaryBody = JSON.parse(String(fetchMock.mock.calls[1]![1]!.body));
    expect(summaryBody).toMatchObject({
      channel: "C456SUMMARY",
      text: "Call summary summary-1: resolved",
      metadata: {
        event_type: "zara_slack_call_summary",
        event_payload: {
          idempotency_key: "call-1:summary-1:slack-summary",
          destination_id: "call-summaries",
        },
      },
    });
    expect(summaryResponse.body.result).toEqual({
      provider: "slack",
      toolId: "slack.call_summaries.post",
      message: {
        destinationId: "call-summaries",
        channelId: "C456SUMMARY",
        ts: "1717690001.000200",
        template: "call_summary",
        idempotencyKey: "call-1:summary-1:slack-summary",
      },
    });

    const toolsResponse = await request(app.getHttpServer())
      .get("/organizations/tenant-west-africa/integrations/connectors/slack/tools");

    expect(toolsResponse.status).toBe(200);
    const toolIds = toolsResponse.body.tools.map((tool: { toolId: string }) => tool.toolId);
    expect(toolIds).toEqual([
      "slack.escalations.post",
      "slack.alerts.post",
      "slack.call_summaries.post",
    ]);
    expect(toolIds).not.toContain("slack.messages.post");
    expect(toolIds).not.toContain("slack.dms.post");
    expect(toolIds).not.toContain("slack.channels.history");
    const escalationSchema = findToolSchema(toolsResponse.body, "slack.escalations.post");
    const alertSchema = findToolSchema(toolsResponse.body, "slack.alerts.post");
    const summarySchema = findToolSchema(toolsResponse.body, "slack.call_summaries.post");
    expect(escalationSchema.inputSchema).toMatchObject({
      required: ["callerName", "reason", "safeSummary"],
      properties: expect.not.objectContaining({
        destinationId: expect.anything(),
      }),
    });
    expect(alertSchema.inputSchema).toMatchObject({
      required: ["alertType", "severity", "title", "safeSummary"],
      properties: expect.not.objectContaining({
        destinationId: expect.anything(),
      }),
    });
    expect(summarySchema.inputSchema).toMatchObject({
      required: ["summaryId", "outcome", "safeSummary"],
      properties: expect.not.objectContaining({
        destinationId: expect.anything(),
      }),
    });

    const missingDestinationResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/slack/tools/slack.alerts.post/execute")
      .send({
        connectionId: await connectIntegration(app, "slack", ["chat:write"]),
        input: {
          alertType: "provider_health",
          severity: "warning",
          title: "Slack destination missing",
          safeSummary: "This should not be posted.",
        },
      });

    expect(missingDestinationResponse.status).toBe(400);
    expect(missingDestinationResponse.body.message).toContain("Slack destination is not configured");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const rateLimitResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/slack/tools/slack.alerts.post/execute")
      .send({
        connectionId,
        input: {
          alertType: "failed_call",
          severity: "critical",
          title: "Failed call",
          safeSummary: "Inbound call failed after provider timeout.",
        },
      });

    expect(rateLimitResponse.status).toBe(429);
    expect(rateLimitResponse.body).toMatchObject({
      provider: "slack",
      toolId: "slack.alerts.post",
      code: "tool_execution.rate_limited",
      recoverable: true,
      retryAfterSeconds: 24,
    });
    expect(JSON.stringify(rateLimitResponse.body)).not.toContain(accessToken);
    expect(JSON.stringify(escalationResponse.body)).not.toContain(accessToken);
    expect(JSON.stringify(summaryResponse.body)).not.toContain(accessToken);

    await app.close();
  }, 15_000);

  it("executes Intercom lookup and internal note tools through curated REST contracts", async () => {
    const app = await createTestingApp();
    const connectionId = await connectIntegration(app, "intercom", [
      "read_users",
      "read_companies",
      "read_conversations",
      "write_conversations",
    ]);
    const schemasResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/connectors/intercom/tools",
    );
    const accessToken = "intercom:access:intercom-oauth-code-contract";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: [
            {
              id: "contact-123",
              email: "ada@example.com",
              phone: "+15551234567",
              name: "Ada Lovelace",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: [
            {
              id: "company-123",
              name: "Example Co",
              company_id: "example-co",
              website: "https://example.com",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: [
            {
              id: "conversation-123",
              state: "open",
              title: "Billing question",
              source: {
                author: {
                  id: "contact-123",
                  email: "ada@example.com",
                },
              },
              updated_at: 1_784_000_000,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          id: "note-123",
          body: "Caller needs a billing follow-up.",
          contact: {
            id: "contact-123",
          },
          created_at: 1_784_000_100,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          id: "summary-note-123",
          body: "Call outcome: follow-up required.",
          contact: {
            id: "contact-123",
          },
          created_at: 1_784_000_200,
        }),
      )
      .mockResolvedValueOnce(jsonResponse(429, { type: "rate_limit" }, { "retry-after": "28" }));
    vi.stubGlobal("fetch", fetchMock);

    expect(schemasResponse.status).toBe(200);
    expect(schemasResponse.body.tools.map((tool: { toolId: string }) => tool.toolId)).toEqual([
      "intercom.users.lookup",
      "intercom.companies.lookup",
      "intercom.conversations.lookup",
      "intercom.internal_notes.create",
      "intercom.call_summaries.create",
    ]);
    expect(JSON.stringify(schemasResponse.body)).not.toContain("intercom.articles.import");
    expect(JSON.stringify(schemasResponse.body)).not.toContain("intercom.articles.search");

    const userResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/intercom/tools/intercom.users.lookup/execute")
      .send({
        connectionId,
        input: {
          email: "ada@example.com",
        },
      });

    expect(userResponse.status).toBe(201);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.intercom.io/contacts/search",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          accept: "application/json",
          "Intercom-Version": "2.11",
        }),
        body: JSON.stringify({
          query: {
            field: "email",
            operator: "=",
            value: "ada@example.com",
          },
        }),
      }),
    );
    expect(userResponse.body.result).toEqual({
      provider: "intercom",
      toolId: "intercom.users.lookup",
      user: {
        id: "contact-123",
        email: "ada@example.com",
        phone: "+15551234567",
        name: "Ada Lovelace",
      },
    });

    const companyResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/intercom/tools/intercom.companies.lookup/execute")
      .send({
        connectionId,
        input: {
          companyName: "Example Co",
        },
      });

    expect(companyResponse.status).toBe(201);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.intercom.io/companies/search",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          query: {
            field: "name",
            operator: "=",
            value: "Example Co",
          },
        }),
      }),
    );
    expect(companyResponse.body.result).toEqual({
      provider: "intercom",
      toolId: "intercom.companies.lookup",
      company: {
        id: "company-123",
        name: "Example Co",
        companyId: "example-co",
        website: "https://example.com",
      },
    });

    const conversationResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/intercom/tools/intercom.conversations.lookup/execute")
      .send({
        connectionId,
        input: {
          contactId: "contact-123",
          state: "open",
        },
      });

    expect(conversationResponse.status).toBe(201);
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://api.intercom.io/conversations/search",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          query: {
            operator: "AND",
            value: [
              {
                field: "contact_ids",
                operator: "=",
                value: "contact-123",
              },
              {
                field: "state",
                operator: "=",
                value: "open",
              },
            ],
          },
          sort: {
            field: "updated_at",
            order: "descending",
          },
        }),
      }),
    );
    expect(conversationResponse.body.result).toEqual({
      provider: "intercom",
      toolId: "intercom.conversations.lookup",
      conversations: [
        {
          id: "conversation-123",
          state: "open",
          title: "Billing question",
          contactId: "contact-123",
          contactEmail: "ada@example.com",
          updatedAt: "2026-07-14T03:33:20.000Z",
        },
      ],
    });

    const noteResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/intercom/tools/intercom.internal_notes.create/execute")
      .send({
        connectionId,
        idempotencyKey: "call-1:turn-3:intercom-note",
        input: {
          contactId: "contact-123",
          body: "Caller needs a billing follow-up.",
        },
      });

    expect(noteResponse.status).toBe(201);
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "https://api.intercom.io/notes",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: `Bearer ${accessToken}`,
        }),
        body: JSON.stringify({
          contact_id: "contact-123",
          body: "Caller needs a billing follow-up.",
        }),
      }),
    );
    expect(noteResponse.body.result).toEqual({
      provider: "intercom",
      toolId: "intercom.internal_notes.create",
      note: {
        id: "note-123",
        contactId: "contact-123",
        body: "Caller needs a billing follow-up.",
        createdAt: "2026-07-14T03:35:00.000Z",
        idempotencyKey: "call-1:turn-3:intercom-note",
      },
    });

    const summaryResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/intercom/tools/intercom.call_summaries.create/execute")
      .send({
        connectionId,
        idempotencyKey: "call-1:summary-1:intercom-note",
        input: {
          contactId: "contact-123",
          summaryId: "summary-1",
          outcome: "follow-up required",
          safeSummary: "Call outcome: follow-up required.",
        },
      });

    expect(summaryResponse.status).toBe(201);
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      "https://api.intercom.io/notes",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          contact_id: "contact-123",
          body: "Call summary summary-1\nOutcome: follow-up required\n\nCall outcome: follow-up required.",
        }),
      }),
    );
    expect(summaryResponse.body.result.note).toMatchObject({
      id: "summary-note-123",
      contactId: "contact-123",
      idempotencyKey: "call-1:summary-1:intercom-note",
    });

    const rateLimitResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/intercom/tools/intercom.users.lookup/execute")
      .send({
        connectionId,
        input: {
          email: "ada@example.com",
        },
      });

    expect(rateLimitResponse.status).toBe(429);
    expect(rateLimitResponse.body).toMatchObject({
      provider: "intercom",
      toolId: "intercom.users.lookup",
      code: "tool_execution.rate_limited",
      recoverable: true,
      retryAfterSeconds: 28,
    });
    expect(JSON.stringify(rateLimitResponse.body)).not.toContain(accessToken);
    expect(JSON.stringify(userResponse.body)).not.toContain(accessToken);
    expect(JSON.stringify(noteResponse.body)).not.toContain(accessToken);

    await app.close();
  }, 15_000);
});
