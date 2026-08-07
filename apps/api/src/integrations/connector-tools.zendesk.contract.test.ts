import request from "supertest";import { afterEach, describe, expect, it, vi } from "vitest";import { configureZendeskApiTokenConnection, createTestingApp, jsonResponse } from "./connector-tools.contract.test-support";

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

  it("executes numeric Zendesk ticket searches through the exact Tickets API contract", async () => {
    const app = await createTestingApp();
    const connectionId = await configureZendeskApiTokenConnection(app);
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(200, {
        ticket: {
          id: 4,
          subject: "Charged card dispute",
          status: "pending",
          priority: "normal",
          requester: {
            email: "james@example.com",
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const searchResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/zendesk/tools/zendesk.tickets.search/execute")
      .send({
        connectionId,
        input: {
          query: "4",
        },
      });

    expect(searchResponse.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://tuzzy-support.zendesk.com/api/v2/tickets/4",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: `Basic ${Buffer.from("support@example.com/token:zendesk-api-token-123456").toString("base64")}`,
          "content-type": "application/json",
        }),
      }),
    );
    expect(searchResponse.body.result).toEqual({
      provider: "zendesk",
      toolId: "zendesk.tickets.search",
      tickets: [
        {
          id: "4",
          subject: "Charged card dispute",
          status: "pending",
          requesterEmail: "james@example.com",
          priority: "normal",
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
});
