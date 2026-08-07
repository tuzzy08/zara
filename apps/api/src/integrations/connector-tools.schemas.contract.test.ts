import request from "supertest";import { afterEach, describe, expect, it, vi } from "vitest";import { createTestingApp, findToolSchema } from "./connector-tools.contract.test-support";

describe("connector provider contracts", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("exposes endpoint-aligned agent-facing connector schemas", async () => {
    const app = await createTestingApp();

    const zendeskSchemas = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/connectors/zendesk/tools",
    );
    const intercomSchemas = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/connectors/intercom/tools",
    );
    const shopifySchemas = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/connectors/shopify/tools",
    );
    const stripeSchemas = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/connectors/stripe/tools",
    );

    expect(zendeskSchemas.status).toBe(200);
    expect(intercomSchemas.status).toBe(200);
    expect(shopifySchemas.status).toBe(200);
    expect(stripeSchemas.status).toBe(200);

    const zendeskSearch = findToolSchema(zendeskSchemas.body, "zendesk.tickets.search");
    const zendeskCreate = findToolSchema(zendeskSchemas.body, "zendesk.tickets.create");
    const intercomUsers = findToolSchema(intercomSchemas.body, "intercom.users.lookup");
    const intercomCompanies = findToolSchema(intercomSchemas.body, "intercom.companies.lookup");
    const shopifyCustomers = findToolSchema(shopifySchemas.body, "shopify.customers.lookup");
    const stripeCustomers = findToolSchema(stripeSchemas.body, "stripe.customers.lookup");

    expect(zendeskSearch.inputSchema).toMatchObject({
      type: "object",
      required: [],
      additionalProperties: false,
      properties: {
        ticketId: expect.objectContaining({
          type: "string",
          description: expect.stringContaining("ticket number"),
        }),
        subject: expect.objectContaining({
          type: "string",
          description: expect.stringContaining("title"),
        }),
        requesterEmail: expect.objectContaining({
          type: "string",
          format: "email",
        }),
        status: expect.objectContaining({
          type: "string",
          enum: ["new", "open", "pending", "solved"],
        }),
        query: expect.objectContaining({
          type: "string",
          description: expect.stringContaining("free-text"),
        }),
      },
    });
    expect(zendeskSearch.inputSchema).not.toHaveProperty("anyOf");
    expect(zendeskSearch.requiredAlternatives).toEqual([
      ["ticketId"],
      ["subject"],
      ["requesterEmail"],
      ["status"],
      ["query"],
    ]);
    expect(zendeskSearch.description).toContain("Requires one of: ticketId, subject, requesterEmail, status, query.");
    expect(zendeskCreate.inputSchema).toMatchObject({
      type: "object",
      required: ["subject", "requesterEmail", "body"],
      additionalProperties: false,
      properties: {
        subject: expect.objectContaining({
          type: "string",
          description: expect.stringContaining("ticket title"),
        }),
        requesterEmail: expect.objectContaining({
          type: "string",
          format: "email",
        }),
        body: expect.objectContaining({
          type: "string",
          description: expect.stringContaining("Zendesk ticket comment"),
        }),
        priority: expect.objectContaining({
          type: "string",
          enum: ["low", "normal", "high", "urgent"],
          default: "normal",
        }),
      },
    });
    expect(intercomUsers.requiredAlternatives).toEqual([
      ["email"],
      ["phone"],
    ]);
    expect(intercomCompanies.requiredAlternatives).toEqual([
      ["companyName"],
      ["companyId"],
    ]);
    expect(shopifyCustomers.requiredAlternatives).toEqual([
      ["email"],
      ["phone"],
    ]);
    expect(stripeCustomers.requiredAlternatives).toEqual([
      ["customerId"],
      ["email"],
      ["phone"],
    ]);
    expect(intercomUsers.inputSchema).not.toHaveProperty("anyOf");
    expect(intercomCompanies.inputSchema).not.toHaveProperty("anyOf");
    expect(shopifyCustomers.inputSchema).not.toHaveProperty("anyOf");
    expect(stripeCustomers.inputSchema).not.toHaveProperty("anyOf");

    await app.close();
  }, 15_000);

  it("keeps required identifier alternatives outside connector JSON schemas", async () => {
    const app = await createTestingApp();
    const providers = [
      "zendesk",
      "hubspot",
      "google-workspace",
      "microsoft-365",
      "notion",
      "salesforce",
      "slack",
      "intercom",
      "shopify",
      "stripe",
      "confluence",
      "sharepoint",
      "freshdesk",
      "salesforce-knowledge",
    ];

    for (const provider of providers) {
      const response = await request(app.getHttpServer()).get(
        `/organizations/tenant-west-africa/integrations/connectors/${provider}/tools`,
      );

      expect(response.status).toBe(200);
      for (const tool of response.body.tools as Array<{
        toolId: string;
        requiredAlternatives?: string[][];
        inputSchema: Record<string, unknown>;
      }>) {
        expect(tool.inputSchema).not.toHaveProperty("anyOf");
        expect(tool.inputSchema).not.toHaveProperty("oneOf");
        expect(tool.inputSchema).not.toHaveProperty("allOf");
        const required = Array.isArray(tool.inputSchema.required) ? tool.inputSchema.required : [];
        if (required.length === 0) {
          expect(tool.requiredAlternatives?.length ?? 0, tool.toolId).toBeGreaterThan(0);
        }
      }
    }

    await app.close();
  }, 15_000);

  it("rejects identifier-alternative connector tools before provider execution when no identifier is supplied", async () => {
    const app = await createTestingApp();
    const cases = [
      {
        provider: "zendesk",
        toolId: "zendesk.tickets.search",
        expectedMessage: "one of ticketId, subject, requesterEmail, status, query",
      },
      {
        provider: "intercom",
        toolId: "intercom.users.lookup",
        expectedMessage: "one of email, phone",
      },
      {
        provider: "intercom",
        toolId: "intercom.companies.lookup",
        expectedMessage: "one of companyName, companyId",
      },
      {
        provider: "shopify",
        toolId: "shopify.customers.lookup",
        expectedMessage: "one of email, phone",
      },
      {
        provider: "stripe",
        toolId: "stripe.customers.lookup",
        expectedMessage: "one of customerId, email, phone",
      },
    ];

    for (const testCase of cases) {
      const response = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/integrations/connectors/${testCase.provider}/tools/${testCase.toolId}/execute`)
        .send({
          connectionId: "missing-connection",
          input: {},
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain(testCase.expectedMessage);
    }

    await app.close();
  }, 15_000);

  it("keeps every built-in connector tool schema agent-readable and closed for future tools", async () => {
    const app = await createTestingApp();
    const providers = [
      "zendesk",
      "hubspot",
      "google-workspace",
      "microsoft-365",
      "notion",
      "salesforce",
      "slack",
      "intercom",
      "shopify",
      "stripe",
      "confluence",
      "sharepoint",
      "freshdesk",
      "salesforce-knowledge",
    ];

    for (const provider of providers) {
      const response = await request(app.getHttpServer()).get(
        `/organizations/tenant-west-africa/integrations/connectors/${provider}/tools`,
      );

      expect(response.status).toBe(200);
      for (const tool of response.body.tools as Array<{
        toolId: string;
        requiredAlternatives?: string[][];
        inputSchema: Record<string, unknown>;
      }>) {
        expect(tool.inputSchema.additionalProperties, tool.toolId).toBe(false);
        const required = Array.isArray(tool.inputSchema.required) ? tool.inputSchema.required : [];
        if (required.length === 0) {
          expect(tool.requiredAlternatives?.length ?? 0, tool.toolId).toBeGreaterThan(0);
        }

        const properties = tool.inputSchema.properties;
        expect(properties && typeof properties === "object" && !Array.isArray(properties), tool.toolId).toBe(true);
        for (const [propertyName, propertySchema] of Object.entries(properties as Record<string, unknown>)) {
          expect(propertySchema && typeof propertySchema === "object" && !Array.isArray(propertySchema), `${tool.toolId}.${propertyName}`).toBe(true);
          const description = (propertySchema as { description?: unknown }).description;
          expect(typeof description, `${tool.toolId}.${propertyName}`).toBe("string");
          expect(String(description).trim().length, `${tool.toolId}.${propertyName}`).toBeGreaterThan(0);
        }
      }
    }

    await app.close();
  }, 15_000);
});
