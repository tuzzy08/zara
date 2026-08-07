import { afterEach, describe, expect, it, vi } from "vitest";import request from "supertest";import { connectIntegration, createTestingApp, mockJsonResponse } from "./integrations.controller.test-support";

describe("IntegrationsController", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("executes typed Zendesk ticket tools and returns retryable rate-limit errors", async () => {
    const app = await createTestingApp();
    const connection = await connectIntegration(app, "zendesk", [
      "tickets:read",
      "tickets:write",
    ]);

    const schemasResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/connectors/zendesk/tools",
    );

    expect(schemasResponse.status).toBe(200);
    expect(schemasResponse.body.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolId: "zendesk.tickets.search",
          requiredScopes: ["tickets:read"],
          inputSchema: expect.objectContaining({
            required: [],
          }),
          requiredAlternatives: [
            ["ticketId"],
            ["subject"],
            ["requesterEmail"],
            ["status"],
            ["query"],
          ],
        }),
        expect.objectContaining({
          toolId: "zendesk.tickets.create",
          requiredScopes: ["tickets:write"],
          inputSchema: expect.objectContaining({
            required: ["subject", "requesterEmail", "body"],
          }),
        }),
        expect.objectContaining({
          toolId: "zendesk.tickets.update",
          requiredScopes: ["tickets:write"],
        }),
      ]),
    );

    const searchResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/zendesk/tools/zendesk.tickets.search/execute")
      .send({
        connectionId: connection.id,
        input: {
          query: "status:open requester:ada@example.com",
        },
      });

    expect(searchResponse.status).toBe(201);
    expect(searchResponse.body.result).toMatchObject({
      provider: "zendesk",
      toolId: "zendesk.tickets.search",
      tickets: [
        expect.objectContaining({
          id: "zd-ticket-1001",
          subject: "Ticket matching status:open requester:ada@example.com",
        }),
      ],
    });

    const createResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/zendesk/tools/zendesk.tickets.create/execute")
      .send({
        connectionId: connection.id,
        input: {
          subject: "Refund request",
          requesterEmail: "ada@example.com",
          body: "Caller needs help with a duplicate invoice.",
          priority: "normal",
        },
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.result).toMatchObject({
      provider: "zendesk",
      ticket: {
        id: expect.stringMatching(/^zd-ticket-/),
        status: "new",
        subject: "Refund request",
      },
    });

    const updateResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/zendesk/tools/zendesk.tickets.update/execute")
      .send({
        connectionId: connection.id,
        input: {
          ticketId: createResponse.body.result.ticket.id,
          status: "pending",
          comment: "Waiting for invoice confirmation.",
        },
      });

    expect(updateResponse.status).toBe(201);
    expect(updateResponse.body.result).toMatchObject({
      ticket: {
        id: createResponse.body.result.ticket.id,
        status: "pending",
      },
    });

    const rateLimitResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/zendesk/tools/zendesk.tickets.search/execute")
      .send({
        connectionId: connection.id,
        input: {
          query: "rate-limit",
        },
      });

    expect(rateLimitResponse.status).toBe(429);
    expect(rateLimitResponse.body.message).toContain("Zendesk rate limit");
    expect(rateLimitResponse.body.retryAfterSeconds).toBe(30);
    expect(JSON.stringify(rateLimitResponse.body)).not.toContain("zendesk-access-token");

    await app.close();
  }, 15_000);

  it("executes typed HubSpot contact note and pipeline tools with recoverable provider errors", async () => {
    const app = await createTestingApp();
    const connection = await connectIntegration(app, "hubspot", [
      "crm.objects.contacts.read",
      "crm.objects.notes.write",
      "crm.objects.deals.write",
    ]);

    const schemasResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/connectors/hubspot/tools",
    );

    expect(schemasResponse.status).toBe(200);
    expect(schemasResponse.body.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolId: "hubspot.contacts.lookup",
          requiredScopes: ["crm.objects.contacts.read"],
        }),
        expect.objectContaining({
          toolId: "hubspot.notes.create",
          requiredScopes: ["crm.objects.notes.write"],
        }),
        expect.objectContaining({
          toolId: "hubspot.pipeline.update",
          requiredScopes: ["crm.objects.deals.write"],
        }),
      ]),
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse(200, {
          results: [
            {
              id: "hs-contact-ada-example-com",
              properties: {
                email: "ada@example.com",
                lifecyclestage: "customer",
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse(201, {
          id: "hs-note-1001",
          properties: {
            hs_note_body: "Caller asked for a billing follow-up.",
            hs_timestamp: "2026-06-06T10:15:00.000Z",
          },
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse(200, {
          id: "deal-42",
          properties: {
            dealstage: "retention-review",
          },
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse(200, {
          results: [
            {
              id: "hs-contact-1",
              properties: {
                email: "duplicate@example.com",
              },
            },
            {
              id: "hs-contact-2",
              properties: {
                email: "duplicate@example.com",
              },
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const lookupResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/hubspot/tools/hubspot.contacts.lookup/execute")
      .send({
        connectionId: connection.id,
        input: {
          email: "ada@example.com",
        },
      });

    expect(lookupResponse.status).toBe(201);
    expect(lookupResponse.body.result).toMatchObject({
      provider: "hubspot",
      contact: {
        id: "hs-contact-ada-example-com",
        email: "ada@example.com",
      },
    });

    const noteResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/hubspot/tools/hubspot.notes.create/execute")
      .send({
        connectionId: connection.id,
        input: {
          contactId: "hs-contact-ada-example-com",
          body: "Caller asked for a billing follow-up.",
        },
      });

    expect(noteResponse.status).toBe(201);
    expect(noteResponse.body.result).toMatchObject({
      note: {
        contactId: "hs-contact-ada-example-com",
        body: "Caller asked for a billing follow-up.",
      },
    });

    const pipelineResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/hubspot/tools/hubspot.pipeline.update/execute")
      .send({
        connectionId: connection.id,
        input: {
          dealId: "deal-42",
          stage: "retention-review",
        },
      });

    expect(pipelineResponse.status).toBe(201);
    expect(pipelineResponse.body.result).toMatchObject({
      deal: {
        id: "deal-42",
        stage: "retention-review",
      },
    });

    const duplicateResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/hubspot/tools/hubspot.contacts.lookup/execute")
      .send({
        connectionId: connection.id,
        input: {
          email: "duplicate@example.com",
        },
      });

    expect(duplicateResponse.status).toBe(409);
    expect(duplicateResponse.body).toMatchObject({
      provider: "hubspot",
      toolId: "hubspot.contacts.lookup",
      recoverable: true,
      code: "duplicate_contacts",
    });
    expect(JSON.stringify(duplicateResponse.body)).not.toContain("hubspot-access-token");

    await app.close();
  }, 15_000);

  it("executes Google Workspace calendar tools with minimal scopes and timezone-safe payloads", async () => {
    const app = await createTestingApp();
    const connection = await connectIntegration(app, "google-workspace", [
      "calendar.freebusy",
      "calendar.events",
    ]);

    const schemasResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/connectors/google-workspace/tools",
    );

    expect(schemasResponse.status).toBe(200);
    expect(schemasResponse.body.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolId: "google.calendar.availability.read",
          requiredScopes: ["calendar.freebusy"],
        }),
        expect.objectContaining({
          toolId: "google.calendar.events.create",
          requiredScopes: ["calendar.events"],
        }),
      ]),
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse(200, {
          calendars: {
            primary: {
              busy: [],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse(200, {
          id: "gcal-event-controller-1",
          summary: "Billing review",
          start: {
            dateTime: "2026-05-21T09:00:00+01:00",
            timeZone: "Africa/Lagos",
          },
          end: {
            dateTime: "2026-05-21T09:30:00+01:00",
            timeZone: "Africa/Lagos",
          },
          attendees: [
            {
              email: "ada@example.com",
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const availabilityResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/google-workspace/tools/google.calendar.availability.read/execute")
      .send({
        connectionId: connection.id,
        input: {
          calendarId: "primary",
          start: "2026-05-21T09:00:00+01:00",
          end: "2026-05-21T10:00:00+01:00",
          timezone: "Africa/Lagos",
        },
      });

    expect(availabilityResponse.status).toBe(201);
    expect(availabilityResponse.body.result).toMatchObject({
      provider: "google-workspace",
      calendarId: "primary",
      timezone: "Africa/Lagos",
      busy: [],
      available: true,
    });

    const eventResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/google-workspace/tools/google.calendar.events.create/execute")
      .send({
        connectionId: connection.id,
        input: {
          calendarId: "primary",
          title: "Billing review",
          start: "2026-05-21T09:00:00+01:00",
          end: "2026-05-21T09:30:00+01:00",
          timezone: "Africa/Lagos",
          attendeeEmail: "ada@example.com",
        },
      });

    expect(eventResponse.status).toBe(201);
    expect(eventResponse.body.result).toMatchObject({
      event: {
        id: "gcal-event-controller-1",
        title: "Billing review",
        timezone: "Africa/Lagos",
        start: "2026-05-21T09:00:00+01:00",
        end: "2026-05-21T09:30:00+01:00",
      },
    });

    const limitedConnection = await connectIntegration(app, "google-workspace", [
      "calendar.freebusy",
    ]);
    const missingScopeResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/google-workspace/tools/google.calendar.events.create/execute")
      .send({
        connectionId: limitedConnection.id,
        input: {
          calendarId: "primary",
          title: "Blocked event",
          start: "2026-05-21T11:00:00+01:00",
          end: "2026-05-21T11:30:00+01:00",
          timezone: "Africa/Lagos",
        },
      });

    expect(missingScopeResponse.status).toBe(403);
    expect(missingScopeResponse.body.message).toContain("calendar.events");

    await app.close();
  }, 15_000);

  it("executes Notion knowledge page and task tools with workspace selection and clear permission failures", async () => {
    const app = await createTestingApp();
    const connection = await connectIntegration(app, "notion", [
      "search:read",
      "pages:write",
      "tasks:write",
    ]);

    const schemasResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/connectors/notion/tools",
    );

    expect(schemasResponse.status).toBe(200);
    expect(schemasResponse.body.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolId: "notion.knowledge.search",
          requiredScopes: ["search:read"],
        }),
        expect.objectContaining({
          toolId: "notion.pages.create",
          requiredScopes: ["pages:write"],
        }),
        expect.objectContaining({
          toolId: "notion.tasks.create",
          requiredScopes: ["tasks:write"],
        }),
      ]),
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse(200, {
          results: [
            {
              id: "notion-result-refund",
              url: "https://notion.so/notion-result-refund",
              properties: {
                title: {
                  title: [
                    {
                      plain_text: "Knowledge result for refund policy",
                    },
                  ],
                },
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse(200, {
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
        mockJsonResponse(200, {
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
      );
    vi.stubGlobal("fetch", fetchMock);

    const searchResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/notion/tools/notion.knowledge.search/execute")
      .send({
        connectionId: connection.id,
        input: {
          query: "refund policy",
        },
      });

    expect(searchResponse.status).toBe(201);
    expect(searchResponse.body.result).toMatchObject({
      provider: "notion",
      workspaceId: "notion:local-account",
      results: [
        expect.objectContaining({
          title: "Knowledge result for refund policy",
        }),
      ],
    });

    const pageResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/notion/tools/notion.pages.create/execute")
      .send({
        connectionId: connection.id,
        input: {
          title: "Billing call summary",
          body: "Caller needs a refund policy follow-up.",
          parentPageId: "page-ops",
        },
      });

    expect(pageResponse.status).toBe(201);
    expect(pageResponse.body.result).toMatchObject({
      page: {
        id: "notion-page-summary",
        workspaceId: "notion:local-account",
        title: "Billing call summary",
      },
    });

    const taskResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/notion/tools/notion.tasks.create/execute")
      .send({
        connectionId: connection.id,
        input: {
          title: "Follow up with Ada",
          assigneeEmail: "ops@example.com",
        },
      });

    expect(taskResponse.status).toBe(201);
    expect(taskResponse.body.result).toMatchObject({
      task: {
        id: "notion-task-ada",
        title: "Follow up with Ada",
        workspaceId: "notion:local-account",
      },
    });

    const limitedConnection = await connectIntegration(app, "notion", ["search:read"]);
    const permissionFailureResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/notion/tools/notion.pages.create/execute")
      .send({
        connectionId: limitedConnection.id,
        input: {
          title: "Blocked page",
          body: "Missing permission.",
        },
      });

    expect(permissionFailureResponse.status).toBe(403);
    expect(permissionFailureResponse.body.message).toContain("pages:write");

    await app.close();
  }, 15_000);
});
