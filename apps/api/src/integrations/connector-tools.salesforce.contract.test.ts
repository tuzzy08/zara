import request from "supertest";import { afterEach, describe, expect, it, vi } from "vitest";import { connectIntegration, createTestingApp, jsonResponse } from "./connector-tools.contract.test-support";

describe("connector provider contracts", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

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
