import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { configureCors } from "../config/cors";
import { IntegrationSecretVault } from "./integrations-secret-vault";
import {
  FileIntegrationStateRepository,
  INTEGRATION_STATE_REPOSITORY,
} from "./integrations-state.repository";
import { IntegrationsModule } from "./integrations.module";

describe("connector provider contracts", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("executes Zendesk ticket create through the server-owned Tickets API contract", async () => {
    const app = await createTestingApp();
    const connectionId = await configureZendeskApiTokenConnection(app, {
      apiUrl: "https://tenant-controlled.example.test/api/v2/requests",
      endpointPath: "/api/v2/requests",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(201, {
          ticket: {
            id: 4815162342,
            subject: "Refund request",
            status: "new",
            priority: "normal",
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(429, { error: "RateLimit" }, { "retry-after": "55" }));
    vi.stubGlobal("fetch", fetchMock);

    const createResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/zendesk/tools/zendesk.tickets.create/execute")
      .send({
        connectionId,
        input: {
          subject: "Refund request",
          requesterEmail: "ada@example.com",
          body: "Caller needs help with a duplicate invoice.",
          priority: "normal",
        },
      });

    expect(createResponse.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://tuzzy-support.zendesk.com/api/v2/tickets",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: `Basic ${Buffer.from("support@example.com/token:zendesk-api-token-123456").toString("base64")}`,
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          ticket: {
            subject: "Refund request",
            requester: {
              email: "ada@example.com",
            },
            comment: {
              body: "Caller needs help with a duplicate invoice.",
            },
            priority: "normal",
          },
        }),
      }),
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("tenant-controlled.example.test");
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("/api/v2/requests");
    expect(createResponse.body.result).toEqual({
      provider: "zendesk",
      toolId: "zendesk.tickets.create",
      ticket: {
        id: "4815162342",
        subject: "Refund request",
        requesterEmail: "ada@example.com",
        priority: "normal",
        status: "new",
      },
    });
    expect(JSON.stringify(createResponse.body)).not.toContain("zendesk-api-token-123456");

    const invalidInputResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/zendesk/tools/zendesk.tickets.create/execute")
      .send({
        connectionId,
        input: {
          subject: "Refund request",
          requesterEmail: "ada@example.com",
        },
      });

    expect(invalidInputResponse.status).toBe(400);
    expect(invalidInputResponse.body.message).toContain("body");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const crossTenantResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-east-africa/integrations/connectors/zendesk/tools/zendesk.tickets.create/execute")
      .send({
        connectionId,
        input: {
          subject: "Cross tenant request",
          requesterEmail: "mallory@example.com",
          body: "Should not execute.",
        },
      });

    expect(crossTenantResponse.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(crossTenantResponse.body)).not.toContain("zendesk-api-token-123456");

    const rateLimitResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/zendesk/tools/zendesk.tickets.create/execute")
      .send({
        connectionId,
        input: {
          subject: "Refund request",
          requesterEmail: "ada@example.com",
          body: "Caller needs help with a duplicate invoice.",
        },
      });

    expect(rateLimitResponse.status).toBe(429);
    expect(rateLimitResponse.body).toMatchObject({
      provider: "zendesk",
      toolId: "zendesk.tickets.create",
      code: "tool_execution.rate_limited",
      recoverable: true,
      retryAfterSeconds: 55,
    });
    expect(JSON.stringify(rateLimitResponse.body)).not.toContain("zendesk-api-token-123456");

    const connectionsResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/connections",
    );

    expect(connectionsResponse.body.connections).toEqual([
      expect.objectContaining({
        id: connectionId,
        health: expect.objectContaining({
          status: "degraded",
          message: "Last Zendesk tool failure: rate limited. Retry after the provider reset window.",
        }),
      }),
    ]);
    expect(JSON.stringify(connectionsResponse.body)).not.toContain("zendesk-api-token-123456");

    await app.close();
  }, 15_000);

  it("executes Zendesk ticket search through the server-owned Search API contract", async () => {
    const app = await createTestingApp();
    const connectionId = await configureZendeskApiTokenConnection(app);
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(200, {
        results: [
          {
            id: 1001,
            subject: "Refund request",
            status: "open",
            priority: "high",
            requester: {
              email: "ada@example.com",
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const searchResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/zendesk/tools/zendesk.tickets.search/execute")
      .send({
        connectionId,
        input: {
          query: "status:open requester:ada@example.com",
        },
      });

    expect(searchResponse.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestedUrl, requestInit] = fetchMock.mock.calls[0]!;
    const url = new URL(requestedUrl as string);
    expect(`${url.origin}${url.pathname}`).toBe("https://tuzzy-support.zendesk.com/api/v2/search");
    expect(url.searchParams.get("query")).toBe("type:ticket status:open requester:ada@example.com");
    expect(requestInit).toMatchObject({
      method: "GET",
      headers: expect.objectContaining({
        authorization: `Basic ${Buffer.from("support@example.com/token:zendesk-api-token-123456").toString("base64")}`,
        "content-type": "application/json",
      }),
    });
    expect(searchResponse.body.result).toEqual({
      provider: "zendesk",
      toolId: "zendesk.tickets.search",
      tickets: [
        {
          id: "1001",
          subject: "Refund request",
          status: "open",
          requesterEmail: "ada@example.com",
          priority: "high",
        },
      ],
    });
    expect(JSON.stringify(searchResponse.body)).not.toContain("zendesk-api-token-123456");

    await app.close();
  }, 15_000);

  it("executes Zendesk ticket update through the server-owned Tickets API contract", async () => {
    const app = await createTestingApp();
    const connectionId = await configureZendeskApiTokenConnection(app, {
      apiUrl: "https://tenant-controlled.example.test/api/v2/tickets/999",
      endpointPath: "/api/v2/tickets/999",
    });
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(200, {
        ticket: {
          id: 1001,
          status: "pending",
          subject: "Refund request",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const updateResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/zendesk/tools/zendesk.tickets.update/execute")
      .send({
        connectionId,
        input: {
          ticketId: "1001",
          status: "pending",
          comment: "Customer confirmed the invoice number.",
        },
      });

    expect(updateResponse.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://tuzzy-support.zendesk.com/api/v2/tickets/1001",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          authorization: `Basic ${Buffer.from("support@example.com/token:zendesk-api-token-123456").toString("base64")}`,
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          ticket: {
            status: "pending",
            comment: {
              body: "Customer confirmed the invoice number.",
            },
          },
        }),
      }),
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("tenant-controlled.example.test");
    expect(updateResponse.body.result).toEqual({
      provider: "zendesk",
      toolId: "zendesk.tickets.update",
      ticket: {
        id: "1001",
        status: "pending",
        latestComment: "Customer confirmed the invoice number.",
      },
    });
    expect(JSON.stringify(updateResponse.body)).not.toContain("zendesk-api-token-123456");

    await app.close();
  }, 15_000);

  it("executes HubSpot contact lookup through the server-owned CRM search contract", async () => {
    const app = await createTestingApp();
    const connectionId = await connectIntegration(app, "hubspot", [
      "crm.objects.contacts.read",
    ]);
    const accessToken = "hubspot:access:hubspot-oauth-code-contract";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          total: 1,
          results: [
            {
              id: "101",
              properties: {
                email: "ada@example.com",
                firstname: "Ada",
                lastname: "Lovelace",
                lifecyclestage: "customer",
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse(429, { status: "error" }, { "retry-after": "42" }));
    vi.stubGlobal("fetch", fetchMock);

    const lookupResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/hubspot/tools/hubspot.contacts.lookup/execute")
      .send({
        connectionId,
        input: {
          email: "Ada@Example.com",
        },
      });

    expect(lookupResponse.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://api.hubapi.com/crm/v3/objects/contacts/search",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          filterGroups: [
            {
              filters: [
                {
                  propertyName: "email",
                  operator: "EQ",
                  value: "ada@example.com",
                },
              ],
            },
          ],
          properties: ["email", "firstname", "lastname", "lifecyclestage"],
          limit: 2,
        }),
      }),
    );
    expect(lookupResponse.body.result).toEqual({
      provider: "hubspot",
      toolId: "hubspot.contacts.lookup",
      contact: {
        id: "101",
        email: "ada@example.com",
        firstName: "Ada",
        lastName: "Lovelace",
        lifecycleStage: "customer",
      },
    });
    expect(JSON.stringify(lookupResponse.body)).not.toContain(accessToken);

    const invalidInputResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/hubspot/tools/hubspot.contacts.lookup/execute")
      .send({
        connectionId,
        input: {},
      });

    expect(invalidInputResponse.status).toBe(400);
    expect(invalidInputResponse.body.message).toContain("email");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const crossTenantResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-east-africa/integrations/connectors/hubspot/tools/hubspot.contacts.lookup/execute")
      .send({
        connectionId,
        input: {
          email: "ada@example.com",
        },
      });

    expect(crossTenantResponse.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(crossTenantResponse.body)).not.toContain(accessToken);

    const rateLimitResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/hubspot/tools/hubspot.contacts.lookup/execute")
      .send({
        connectionId,
        input: {
          email: "ada@example.com",
        },
      });

    expect(rateLimitResponse.status).toBe(429);
    expect(rateLimitResponse.body).toMatchObject({
      provider: "hubspot",
      toolId: "hubspot.contacts.lookup",
      code: "tool_execution.rate_limited",
      recoverable: true,
      retryAfterSeconds: 42,
    });
    expect(JSON.stringify(rateLimitResponse.body)).not.toContain(accessToken);

    await app.close();
  }, 15_000);

  it("executes HubSpot note create through the server-owned CRM notes contract", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-06T10:15:00.000Z"));
    const app = await createTestingApp();
    const connectionId = await connectIntegration(app, "hubspot", [
      "crm.objects.notes.write",
    ]);
    const accessToken = "hubspot:access:hubspot-oauth-code-contract";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(201, {
          id: "9001",
          properties: {
            hs_note_body: "Caller asked for a billing follow-up.",
            hs_timestamp: "2026-06-06T10:15:00.000Z",
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(429, { status: "error" }, { "retry-after": "37" }));
    vi.stubGlobal("fetch", fetchMock);

    const noteResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/hubspot/tools/hubspot.notes.create/execute")
      .send({
        connectionId,
        input: {
          contactId: "101",
          body: "Caller asked for a billing follow-up.",
        },
      });

    expect(noteResponse.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://api.hubapi.com/crm/v3/objects/notes",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          properties: {
            hs_note_body: "Caller asked for a billing follow-up.",
            hs_timestamp: "2026-06-06T10:15:00.000Z",
          },
          associations: [
            {
              to: {
                id: "101",
              },
              types: [
                {
                  associationCategory: "HUBSPOT_DEFINED",
                  associationTypeId: 202,
                },
              ],
            },
          ],
        }),
      }),
    );
    expect(noteResponse.body.result).toEqual({
      provider: "hubspot",
      toolId: "hubspot.notes.create",
      note: {
        id: "9001",
        contactId: "101",
        body: "Caller asked for a billing follow-up.",
        createdAt: "2026-06-06T10:15:00.000Z",
      },
    });
    expect(JSON.stringify(noteResponse.body)).not.toContain(accessToken);

    const invalidInputResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/hubspot/tools/hubspot.notes.create/execute")
      .send({
        connectionId,
        input: {
          contactId: "101",
        },
      });

    expect(invalidInputResponse.status).toBe(400);
    expect(invalidInputResponse.body.message).toContain("body");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const rateLimitResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/hubspot/tools/hubspot.notes.create/execute")
      .send({
        connectionId,
        input: {
          contactId: "101",
          body: "Caller asked for a billing follow-up.",
        },
      });

    expect(rateLimitResponse.status).toBe(429);
    expect(rateLimitResponse.body).toMatchObject({
      provider: "hubspot",
      toolId: "hubspot.notes.create",
      code: "tool_execution.rate_limited",
      recoverable: true,
      retryAfterSeconds: 37,
    });
    expect(JSON.stringify(rateLimitResponse.body)).not.toContain(accessToken);

    await app.close();
  }, 15_000);

  it("executes HubSpot deal stage update through the server-owned CRM deals contract", async () => {
    const app = await createTestingApp();
    const connectionId = await connectIntegration(app, "hubspot", [
      "crm.objects.deals.write",
    ]);
    const accessToken = "hubspot:access:hubspot-oauth-code-contract";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          id: "deal-42",
          properties: {
            dealstage: "appointmentscheduled",
            pipeline: "default",
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(429, { status: "error" }, { "retry-after": "29" }));
    vi.stubGlobal("fetch", fetchMock);

    const updateResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/hubspot/tools/hubspot.pipeline.update/execute")
      .send({
        connectionId,
        input: {
          dealId: "deal-42",
          stage: "appointmentscheduled",
        },
      });

    expect(updateResponse.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://api.hubapi.com/crm/v3/objects/deals/deal-42",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          properties: {
            dealstage: "appointmentscheduled",
          },
        }),
      }),
    );
    expect(updateResponse.body.result).toEqual({
      provider: "hubspot",
      toolId: "hubspot.pipeline.update",
      deal: {
        id: "deal-42",
        stage: "appointmentscheduled",
        pipeline: "default",
        updated: true,
      },
    });
    expect(JSON.stringify(updateResponse.body)).not.toContain(accessToken);

    const invalidInputResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/hubspot/tools/hubspot.pipeline.update/execute")
      .send({
        connectionId,
        input: {
          dealId: "deal-42",
        },
      });

    expect(invalidInputResponse.status).toBe(400);
    expect(invalidInputResponse.body.message).toContain("stage");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const rateLimitResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/hubspot/tools/hubspot.pipeline.update/execute")
      .send({
        connectionId,
        input: {
          dealId: "deal-42",
          stage: "appointmentscheduled",
        },
      });

    expect(rateLimitResponse.status).toBe(429);
    expect(rateLimitResponse.body).toMatchObject({
      provider: "hubspot",
      toolId: "hubspot.pipeline.update",
      code: "tool_execution.rate_limited",
      recoverable: true,
      retryAfterSeconds: 29,
    });
    expect(JSON.stringify(rateLimitResponse.body)).not.toContain(accessToken);

    await app.close();
  }, 15_000);

  it("executes Google Calendar availability through the server-owned FreeBusy contract", async () => {
    const app = await createTestingApp();
    const connectionId = await connectIntegration(app, "google-workspace", [
      "calendar.freebusy",
    ]);
    const accessToken = "google-workspace:access:google-workspace-oauth-code-contract";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          timeMin: "2026-06-10T09:00:00-04:00",
          timeMax: "2026-06-10T10:00:00-04:00",
          calendars: {
            primary: {
              busy: [
                {
                  start: "2026-06-10T09:30:00-04:00",
                  end: "2026-06-10T09:45:00-04:00",
                },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(429, { error: { status: "RESOURCE_EXHAUSTED" } }, { "retry-after": "61" }));
    vi.stubGlobal("fetch", fetchMock);

    const availabilityResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/google-workspace/tools/google.calendar.availability.read/execute")
      .send({
        connectionId,
        input: {
          calendarId: "primary",
          start: "2026-06-10T09:00:00-04:00",
          end: "2026-06-10T10:00:00-04:00",
          timezone: "America/New_York",
        },
      });

    expect(availabilityResponse.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://www.googleapis.com/calendar/v3/freeBusy",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          timeMin: "2026-06-10T09:00:00-04:00",
          timeMax: "2026-06-10T10:00:00-04:00",
          timeZone: "America/New_York",
          items: [
            {
              id: "primary",
            },
          ],
        }),
      }),
    );
    expect(availabilityResponse.body.result).toEqual({
      provider: "google-workspace",
      toolId: "google.calendar.availability.read",
      calendarId: "primary",
      start: "2026-06-10T09:00:00-04:00",
      end: "2026-06-10T10:00:00-04:00",
      timezone: "America/New_York",
      busy: [
        {
          start: "2026-06-10T09:30:00-04:00",
          end: "2026-06-10T09:45:00-04:00",
        },
      ],
      available: false,
    });
    expect(JSON.stringify(availabilityResponse.body)).not.toContain(accessToken);

    const invalidInputResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/google-workspace/tools/google.calendar.availability.read/execute")
      .send({
        connectionId,
        input: {
          calendarId: "primary",
          start: "2026-06-10T09:00:00-04:00",
          end: "2026-06-10T10:00:00-04:00",
        },
      });

    expect(invalidInputResponse.status).toBe(400);
    expect(invalidInputResponse.body.message).toContain("timezone");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const rateLimitResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/google-workspace/tools/google.calendar.availability.read/execute")
      .send({
        connectionId,
        input: {
          calendarId: "primary",
          start: "2026-06-10T09:00:00-04:00",
          end: "2026-06-10T10:00:00-04:00",
          timezone: "America/New_York",
        },
      });

    expect(rateLimitResponse.status).toBe(429);
    expect(rateLimitResponse.body).toMatchObject({
      provider: "google-workspace",
      toolId: "google.calendar.availability.read",
      code: "tool_execution.rate_limited",
      recoverable: true,
      retryAfterSeconds: 61,
    });
    expect(JSON.stringify(rateLimitResponse.body)).not.toContain(accessToken);

    await app.close();
  }, 15_000);

  it("executes Google Calendar event creation through the server-owned events contract", async () => {
    const app = await createTestingApp();
    const connectionId = await connectIntegration(app, "google-workspace", [
      "calendar.events",
    ]);
    const accessToken = "google-workspace:access:google-workspace-oauth-code-contract";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          id: "calendar-event-123",
          summary: "Billing review",
          start: {
            dateTime: "2026-06-10T11:00:00-04:00",
            timeZone: "America/New_York",
          },
          end: {
            dateTime: "2026-06-10T11:30:00-04:00",
            timeZone: "America/New_York",
          },
          attendees: [
            {
              email: "ada@example.com",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse(429, { error: { status: "RESOURCE_EXHAUSTED" } }, { "retry-after": "44" }));
    vi.stubGlobal("fetch", fetchMock);

    const eventResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/google-workspace/tools/google.calendar.events.create/execute")
      .send({
        connectionId,
        input: {
          calendarId: "primary",
          title: "Billing review",
          start: "2026-06-10T11:00:00-04:00",
          end: "2026-06-10T11:30:00-04:00",
          timezone: "America/New_York",
          attendeeEmail: "ada@example.com",
        },
      });

    expect(eventResponse.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          summary: "Billing review",
          start: {
            dateTime: "2026-06-10T11:00:00-04:00",
            timeZone: "America/New_York",
          },
          end: {
            dateTime: "2026-06-10T11:30:00-04:00",
            timeZone: "America/New_York",
          },
          attendees: [
            {
              email: "ada@example.com",
            },
          ],
        }),
      }),
    );
    expect(eventResponse.body.result).toEqual({
      provider: "google-workspace",
      toolId: "google.calendar.events.create",
      event: {
        id: "calendar-event-123",
        calendarId: "primary",
        title: "Billing review",
        start: "2026-06-10T11:00:00-04:00",
        end: "2026-06-10T11:30:00-04:00",
        timezone: "America/New_York",
        attendeeEmail: "ada@example.com",
      },
    });
    expect(JSON.stringify(eventResponse.body)).not.toContain(accessToken);

    const invalidInputResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/google-workspace/tools/google.calendar.events.create/execute")
      .send({
        connectionId,
        input: {
          calendarId: "primary",
          title: "Billing review",
          start: "2026-06-10T11:00:00-04:00",
          timezone: "America/New_York",
        },
      });

    expect(invalidInputResponse.status).toBe(400);
    expect(invalidInputResponse.body.message).toContain("end");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const rateLimitResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/google-workspace/tools/google.calendar.events.create/execute")
      .send({
        connectionId,
        input: {
          calendarId: "primary",
          title: "Billing review",
          start: "2026-06-10T11:00:00-04:00",
          end: "2026-06-10T11:30:00-04:00",
          timezone: "America/New_York",
        },
      });

    expect(rateLimitResponse.status).toBe(429);
    expect(rateLimitResponse.body).toMatchObject({
      provider: "google-workspace",
      toolId: "google.calendar.events.create",
      code: "tool_execution.rate_limited",
      recoverable: true,
      retryAfterSeconds: 44,
    });
    expect(JSON.stringify(rateLimitResponse.body)).not.toContain(accessToken);

    await app.close();
  }, 15_000);

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

  it("executes Salesforce support and sales tools through curated server-owned REST contracts", async () => {
    const app = await createTestingApp();
    const connectionId = await connectIntegration(app, "salesforce", [
      "api",
      "refresh_token",
    ]);
    const accessToken = "salesforce:access:salesforce-oauth-code-contract";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          records: [
            {
              Id: "001WEST",
              Name: "Tuzzy Labs",
              Website: "https://tuzzy.example",
              Phone: "+14155550199",
              Type: "Customer",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          records: [
            {
              Id: "003ADA",
              Email: "ada@example.com",
              FirstName: "Ada",
              LastName: "Lovelace",
              AccountId: "001WEST",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          records: [
            {
              Id: "500CASE",
              CaseNumber: "00001042",
              Subject: "Billing follow-up",
              Status: "New",
              Priority: "Medium",
              AccountId: "001WEST",
              ContactId: "003ADA",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse(201, { id: "00TTASK", success: true }))
      .mockResolvedValueOnce(jsonResponse(201, { id: "500NEWCASE", success: true }))
      .mockResolvedValueOnce(jsonResponse(201, { id: "00TNOTE", success: true }))
      .mockResolvedValueOnce(jsonResponse(429, [{ errorCode: "REQUEST_LIMIT_EXCEEDED" }], { "retry-after": "27" }));
    vi.stubGlobal("fetch", fetchMock);

    const accountResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/salesforce/tools/salesforce.accounts.lookup/execute")
      .send({
        connectionId,
        input: {
          accountName: "Tuzzy Labs",
        },
      });

    expect(accountResponse.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [accountUrl, accountInit] = fetchMock.mock.calls[0]!;
    const accountQueryUrl = new URL(accountUrl as string);
    expect(`${accountQueryUrl.origin}${accountQueryUrl.pathname}`).toBe(
      "https://salesforce.local-account.my.salesforce.com/services/data/v60.0/query",
    );
    expect(accountQueryUrl.searchParams.get("q")).toContain("FROM Account");
    expect(accountQueryUrl.searchParams.get("q")).toContain("Tuzzy Labs");
    expect(accountInit).toMatchObject({
      method: "GET",
      headers: expect.objectContaining({
        authorization: `Bearer ${accessToken}`,
      }),
    });
    expect(accountResponse.body.result).toEqual({
      provider: "salesforce",
      toolId: "salesforce.accounts.lookup",
      account: {
        id: "001WEST",
        name: "Tuzzy Labs",
        website: "https://tuzzy.example",
        phone: "+14155550199",
        type: "Customer",
      },
    });

    const contactResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/salesforce/tools/salesforce.contacts.lookup/execute")
      .send({
        connectionId,
        input: {
          email: "Ada@Example.com",
        },
      });

    expect(contactResponse.status).toBe(201);
    const [contactUrl] = fetchMock.mock.calls[1]!;
    const contactQueryUrl = new URL(contactUrl as string);
    expect(contactQueryUrl.searchParams.get("q")).toContain("FROM Contact");
    expect(contactQueryUrl.searchParams.get("q")).toContain("ada@example.com");
    expect(contactResponse.body.result).toEqual({
      provider: "salesforce",
      toolId: "salesforce.contacts.lookup",
      contact: {
        id: "003ADA",
        email: "ada@example.com",
        firstName: "Ada",
        lastName: "Lovelace",
        accountId: "001WEST",
      },
    });

    const caseLookupResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/salesforce/tools/salesforce.cases.lookup/execute")
      .send({
        connectionId,
        input: {
          caseNumber: "00001042",
        },
      });

    expect(caseLookupResponse.status).toBe(201);
    const [caseLookupUrl] = fetchMock.mock.calls[2]!;
    const caseQueryUrl = new URL(caseLookupUrl as string);
    expect(caseQueryUrl.searchParams.get("q")).toContain("FROM Case");
    expect(caseQueryUrl.searchParams.get("q")).toContain("00001042");
    expect(caseLookupResponse.body.result).toEqual({
      provider: "salesforce",
      toolId: "salesforce.cases.lookup",
      case: {
        id: "500CASE",
        caseNumber: "00001042",
        subject: "Billing follow-up",
        status: "New",
        priority: "Medium",
        accountId: "001WEST",
        contactId: "003ADA",
      },
    });

    const taskResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/salesforce/tools/salesforce.tasks.create/execute")
      .send({
        connectionId,
        idempotencyKey: "call-1:turn-1:salesforce-task",
        input: {
          subject: "Follow up with Ada",
          description: "Send renewal pricing details.",
          dueDate: "2026-06-08",
          contactId: "003ADA",
          accountId: "001WEST",
          priority: "Normal",
        },
      });

    expect(taskResponse.status).toBe(201);
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "https://salesforce.local-account.my.salesforce.com/services/data/v60.0/sobjects/Task",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          "Sforce-Call-Options": "client=call-1%3Aturn-1%3Asalesforce-task",
        }),
        body: JSON.stringify({
          Subject: "Follow up with Ada",
          Description: "Send renewal pricing details.",
          ActivityDate: "2026-06-08",
          WhoId: "003ADA",
          WhatId: "001WEST",
          Priority: "Normal",
          Status: "Not Started",
        }),
      }),
    );
    expect(taskResponse.body.result).toEqual({
      provider: "salesforce",
      toolId: "salesforce.tasks.create",
      task: {
        id: "00TTASK",
        subject: "Follow up with Ada",
        contactId: "003ADA",
        accountId: "001WEST",
        status: "Not Started",
        idempotencyKey: "call-1:turn-1:salesforce-task",
      },
    });

    const caseCreateResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/salesforce/tools/salesforce.cases.create/execute")
      .send({
        connectionId,
        idempotencyKey: "call-1:turn-1:salesforce-case",
        input: {
          subject: "Billing follow-up",
          description: "Caller needs a billing specialist to review renewal pricing.",
          suppliedEmail: "ada@example.com",
          priority: "Medium",
        },
      });

    expect(caseCreateResponse.status).toBe(201);
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      "https://salesforce.local-account.my.salesforce.com/services/data/v60.0/sobjects/Case",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          "Sforce-Call-Options": "client=call-1%3Aturn-1%3Asalesforce-case",
        }),
        body: JSON.stringify({
          Subject: "Billing follow-up",
          Description: "Caller needs a billing specialist to review renewal pricing.",
          SuppliedEmail: "ada@example.com",
          Priority: "Medium",
          Origin: "Phone",
        }),
      }),
    );
    expect(caseCreateResponse.body.result).toEqual({
      provider: "salesforce",
      toolId: "salesforce.cases.create",
      case: {
        id: "500NEWCASE",
        subject: "Billing follow-up",
        suppliedEmail: "ada@example.com",
        priority: "Medium",
        status: "New",
        idempotencyKey: "call-1:turn-1:salesforce-case",
      },
    });

    const noteResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/salesforce/tools/salesforce.call_notes.create/execute")
      .send({
        connectionId,
        idempotencyKey: "call-1:turn-1:salesforce-note",
        input: {
          subject: "Call note",
          body: "Ada asked for renewal pricing by email.",
          contactId: "003ADA",
          accountId: "001WEST",
        },
      });

    expect(noteResponse.status).toBe(201);
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      "https://salesforce.local-account.my.salesforce.com/services/data/v60.0/sobjects/Task",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          "Sforce-Call-Options": "client=call-1%3Aturn-1%3Asalesforce-note",
        }),
        body: JSON.stringify({
          Subject: "Call note",
          Description: "Ada asked for renewal pricing by email.",
          WhoId: "003ADA",
          WhatId: "001WEST",
          Priority: "Normal",
          Status: "Completed",
        }),
      }),
    );
    expect(noteResponse.body.result).toEqual({
      provider: "salesforce",
      toolId: "salesforce.call_notes.create",
      note: {
        id: "00TNOTE",
        subject: "Call note",
        contactId: "003ADA",
        accountId: "001WEST",
        status: "Completed",
        idempotencyKey: "call-1:turn-1:salesforce-note",
      },
    });

    const unsupportedToolsResponse = await request(app.getHttpServer())
      .get("/organizations/tenant-west-africa/integrations/connectors/salesforce/tools");

    expect(unsupportedToolsResponse.status).toBe(200);
    const toolIds = unsupportedToolsResponse.body.tools.map((tool: { toolId: string }) => tool.toolId);
    expect(toolIds).toEqual([
      "salesforce.accounts.lookup",
      "salesforce.contacts.lookup",
      "salesforce.cases.lookup",
      "salesforce.tasks.create",
      "salesforce.cases.create",
      "salesforce.call_notes.create",
    ]);
    expect(toolIds).not.toContain("salesforce.pipeline.update");
    expect(toolIds).not.toContain("salesforce.accounts.delete");
    expect(toolIds).not.toContain("salesforce.owner.update");

    const invalidInputResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/salesforce/tools/salesforce.tasks.create/execute")
      .send({
        connectionId,
        input: {
          description: "Missing subject should not execute.",
        },
      });

    expect(invalidInputResponse.status).toBe(400);
    expect(invalidInputResponse.body.message).toContain("subject");
    expect(fetchMock).toHaveBeenCalledTimes(6);

    const crossTenantResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-east-africa/integrations/connectors/salesforce/tools/salesforce.accounts.lookup/execute")
      .send({
        connectionId,
        input: {
          accountName: "Tuzzy Labs",
        },
      });

    expect(crossTenantResponse.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(JSON.stringify(crossTenantResponse.body)).not.toContain(accessToken);

    const rateLimitResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/salesforce/tools/salesforce.accounts.lookup/execute")
      .send({
        connectionId,
        input: {
          accountName: "Tuzzy Labs",
        },
      });

    expect(rateLimitResponse.status).toBe(429);
    expect(rateLimitResponse.body).toMatchObject({
      provider: "salesforce",
      toolId: "salesforce.accounts.lookup",
      code: "tool_execution.rate_limited",
      recoverable: true,
      retryAfterSeconds: 27,
    });
    expect(JSON.stringify(rateLimitResponse.body)).not.toContain(accessToken);
    expect(JSON.stringify(accountResponse.body)).not.toContain(accessToken);
    expect(JSON.stringify(taskResponse.body)).not.toContain(accessToken);

    await app.close();
  }, 15_000);
});

async function configureZendeskApiTokenConnection(
  app: INestApplication,
  extraBody: Record<string, unknown> = {},
) {
  const configureResponse = await request(app.getHttpServer())
    .post("/organizations/tenant-west-africa/integrations/zendesk/configure")
    .send({
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      subdomain: "tuzzy-support",
      email: "support@example.com",
      apiToken: "zendesk-api-token-123456",
      ...extraBody,
    });

  expect(configureResponse.status).toBe(201);
  expect(JSON.stringify(configureResponse.body)).not.toContain("zendesk-api-token-123456");
  expect(JSON.stringify(configureResponse.body)).not.toContain("tenant-controlled.example.test");

  return configureResponse.body.connection.id as string;
}

async function connectIntegration(
  app: INestApplication,
  provider: "zendesk" | "hubspot" | "google-workspace" | "notion" | "salesforce",
  requestedScopes: string[],
) {
  const connectResponse = await request(app.getHttpServer())
    .post(`/organizations/tenant-west-africa/integrations/${provider}/connect`)
    .send({
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      redirectUri: `http://127.0.0.1:4173/integrations/${provider}/callback`,
      requestedScopes,
    });

  expect(connectResponse.status).toBe(201);
  const state = new URL(connectResponse.body.connect.authorizationUrl).searchParams.get("state");
  const callbackResponse = await request(app.getHttpServer())
    .get(`/integrations/oauth/${provider}/callback`)
    .query({
      code: `${provider}-oauth-code-contract`,
      state,
    });

  expect(callbackResponse.status).toBe(200);
  expect(JSON.stringify(callbackResponse.body)).not.toContain(`${provider}:access:`);

  return callbackResponse.body.connection.id as string;
}

async function createTestingApp() {
  const moduleRef = await Test.createTestingModule({
    imports: [IntegrationsModule],
  })
    .overrideProvider(INTEGRATION_STATE_REPOSITORY)
    .useValue(
      new FileIntegrationStateRepository(
        join(tmpdir(), "zara-connector-contract-tests", randomUUID()),
      ),
    )
    .overrideProvider(IntegrationSecretVault)
    .useValue(
      new IntegrationSecretVault({
        masterSecret: "integration-secret-123456789012345678",
        keyVersion: 1,
      }),
    )
    .compile();

  const app: INestApplication = moduleRef.createNestApplication();
  configureCors(app);
  await app.init();

  return app;
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return {
    status,
    headers: new Headers({
      "content-type": "application/json",
      ...headers,
    }),
    text: async () => JSON.stringify(body),
  };
}
