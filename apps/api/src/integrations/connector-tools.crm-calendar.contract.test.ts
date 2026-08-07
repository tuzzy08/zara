import request from "supertest";import { afterEach, describe, expect, it, vi } from "vitest";import { connectIntegration, createTestingApp, jsonResponse } from "./connector-tools.contract.test-support";

describe("connector provider contracts", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

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

  it("executes Microsoft 365 calendar availability through the server-owned Graph getSchedule contract", async () => {
    const app = await createTestingApp();
    const connectionId = await connectIntegration(app, "microsoft-365", [
      "Calendars.ReadBasic",
    ]);
    const accessToken = "microsoft-365:access:microsoft-365-oauth-code-contract";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          value: [
            {
              scheduleId: "scheduler@example.com",
              availabilityView: "0011",
              scheduleItems: [
                {
                  status: "busy",
                  subject: "Private appointment",
                  start: {
                    dateTime: "2026-06-10T09:30:00",
                    timeZone: "America/New_York",
                  },
                  end: {
                    dateTime: "2026-06-10T09:45:00",
                    timeZone: "America/New_York",
                  },
                },
              ],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse(429, { error: { code: "TooManyRequests" } }, { "retry-after": "37" }));
    vi.stubGlobal("fetch", fetchMock);

    const availabilityResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/microsoft-365/tools/microsoft365.calendar.availability.read/execute")
      .send({
        connectionId,
        input: {
          calendarEmail: "scheduler@example.com",
          start: "2026-06-10T09:00:00",
          end: "2026-06-10T10:00:00",
          timezone: "America/New_York",
          availabilityViewIntervalMinutes: 15,
        },
      });

    expect(availabilityResponse.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://graph.microsoft.com/v1.0/me/calendar/getSchedule",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          schedules: ["scheduler@example.com"],
          startTime: {
            dateTime: "2026-06-10T09:00:00",
            timeZone: "America/New_York",
          },
          endTime: {
            dateTime: "2026-06-10T10:00:00",
            timeZone: "America/New_York",
          },
          availabilityViewInterval: 15,
        }),
      }),
    );
    expect(availabilityResponse.body.result).toEqual({
      provider: "microsoft-365",
      toolId: "microsoft365.calendar.availability.read",
      calendarEmail: "scheduler@example.com",
      start: "2026-06-10T09:00:00",
      end: "2026-06-10T10:00:00",
      timezone: "America/New_York",
      availabilityView: "0011",
      busy: [
        {
          start: "2026-06-10T09:30:00",
          end: "2026-06-10T09:45:00",
          status: "busy",
        },
      ],
      available: false,
    });
    expect(JSON.stringify(availabilityResponse.body)).not.toContain(accessToken);
    expect(JSON.stringify(availabilityResponse.body)).not.toContain("Private appointment");

    const invalidInputResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/microsoft-365/tools/microsoft365.calendar.availability.read/execute")
      .send({
        connectionId,
        input: {
          calendarEmail: "scheduler@example.com",
          start: "2026-06-10T09:00:00",
          end: "2026-06-10T10:00:00",
        },
      });

    expect(invalidInputResponse.status).toBe(400);
    expect(invalidInputResponse.body.message).toContain("timezone");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const crossTenantResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-east-africa/integrations/connectors/microsoft-365/tools/microsoft365.calendar.availability.read/execute")
      .send({
        connectionId,
        input: {
          calendarEmail: "scheduler@example.com",
          start: "2026-06-10T09:00:00",
          end: "2026-06-10T10:00:00",
          timezone: "America/New_York",
        },
      });

    expect(crossTenantResponse.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(crossTenantResponse.body)).not.toContain(accessToken);

    const rateLimitResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/microsoft-365/tools/microsoft365.calendar.availability.read/execute")
      .send({
        connectionId,
        input: {
          calendarEmail: "scheduler@example.com",
          start: "2026-06-10T09:00:00",
          end: "2026-06-10T10:00:00",
          timezone: "America/New_York",
        },
      });

    expect(rateLimitResponse.status).toBe(429);
    expect(rateLimitResponse.body).toMatchObject({
      provider: "microsoft-365",
      toolId: "microsoft365.calendar.availability.read",
      code: "tool_execution.rate_limited",
      recoverable: true,
      retryAfterSeconds: 37,
    });
    expect(JSON.stringify(rateLimitResponse.body)).not.toContain(accessToken);

    await app.close();
  }, 15_000);

  it("executes Microsoft 365 calendar event creation through the server-owned Graph events contract", async () => {
    const app = await createTestingApp();
    const connectionId = await connectIntegration(app, "microsoft-365", [
      "Calendars.ReadWrite",
    ]);
    const accessToken = "microsoft-365:access:microsoft-365-oauth-code-contract";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(201, {
          id: "m365-event-123",
          subject: "Billing review",
          webLink: "https://outlook.office.com/calendar/item/m365-event-123",
          transactionId: "call-77:event-create",
          start: {
            dateTime: "2026-06-10T11:00:00",
            timeZone: "America/New_York",
          },
          end: {
            dateTime: "2026-06-10T11:30:00",
            timeZone: "America/New_York",
          },
          attendees: [
            {
              emailAddress: {
                address: "ada@example.com",
              },
              type: "required",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse(429, { error: { code: "TooManyRequests" } }, { "retry-after": "41" }));
    vi.stubGlobal("fetch", fetchMock);

    const eventResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/microsoft-365/tools/microsoft365.calendar.events.create/execute")
      .send({
        connectionId,
        idempotencyKey: "call-77:event-create",
        input: {
          calendarId: "primary",
          title: "Billing review",
          start: "2026-06-10T11:00:00",
          end: "2026-06-10T11:30:00",
          timezone: "America/New_York",
          attendeeEmail: "ada@example.com",
          body: "Caller requested a billing review.",
        },
      });

    expect(eventResponse.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://graph.microsoft.com/v1.0/me/calendars/primary/events",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          subject: "Billing review",
          start: {
            dateTime: "2026-06-10T11:00:00",
            timeZone: "America/New_York",
          },
          end: {
            dateTime: "2026-06-10T11:30:00",
            timeZone: "America/New_York",
          },
          attendees: [
            {
              emailAddress: {
                address: "ada@example.com",
              },
              type: "required",
            },
          ],
          body: {
            contentType: "text",
            content: "Caller requested a billing review.",
          },
          transactionId: "call-77:event-create",
        }),
      }),
    );
    expect(eventResponse.body.result).toEqual({
      provider: "microsoft-365",
      toolId: "microsoft365.calendar.events.create",
      event: {
        id: "m365-event-123",
        calendarId: "primary",
        title: "Billing review",
        start: "2026-06-10T11:00:00",
        end: "2026-06-10T11:30:00",
        timezone: "America/New_York",
        attendeeEmail: "ada@example.com",
        webLink: "https://outlook.office.com/calendar/item/m365-event-123",
        idempotencyKey: "call-77:event-create",
      },
    });
    expect(JSON.stringify(eventResponse.body)).not.toContain(accessToken);

    const insufficientScopeConnectionId = await connectIntegration(app, "microsoft-365", [
      "Calendars.ReadBasic",
    ]);
    const missingScopeResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/microsoft-365/tools/microsoft365.calendar.events.create/execute")
      .send({
        connectionId: insufficientScopeConnectionId,
        input: {
          calendarId: "primary",
          title: "Billing review",
          start: "2026-06-10T11:00:00",
          end: "2026-06-10T11:30:00",
          timezone: "America/New_York",
        },
      });

    expect(missingScopeResponse.status).toBe(403);
    expect(missingScopeResponse.body.message).toContain("Calendars.ReadWrite");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const rateLimitResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/microsoft-365/tools/microsoft365.calendar.events.create/execute")
      .send({
        connectionId,
        input: {
          calendarId: "primary",
          title: "Billing review",
          start: "2026-06-10T11:00:00",
          end: "2026-06-10T11:30:00",
          timezone: "America/New_York",
        },
      });

    expect(rateLimitResponse.status).toBe(429);
    expect(rateLimitResponse.body).toMatchObject({
      provider: "microsoft-365",
      toolId: "microsoft365.calendar.events.create",
      code: "tool_execution.rate_limited",
      recoverable: true,
      retryAfterSeconds: 41,
    });
    expect(JSON.stringify(rateLimitResponse.body)).not.toContain(accessToken);

    await app.close();
  }, 15_000);
});
