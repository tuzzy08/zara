import request from "supertest";import { afterEach, describe, expect, it, vi } from "vitest";import { configureFreshdeskApiTokenConnection, connectIntegration, createTestingApp, jsonResponse, textResponse } from "./connector-tools.contract.test-support";

describe("connector provider contracts", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("executes SharePoint knowledge imports through documented Microsoft Graph drive item paths", async () => {
    const app = await createTestingApp();
    const connectionId = await connectIntegration(app, "sharepoint", ["Files.Read", "Sites.Read.All"]);
    const accessToken = "sharepoint:access:sharepoint-oauth-code-contract";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          value: [
            {
              id: "file-refunds",
              name: "Refund policy.txt",
              webUrl: "https://contoso.sharepoint.com/sites/support/Shared%20Documents/Refund%20policy.txt",
              file: {
                mimeType: "text/plain",
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(textResponse(200, "Refunds over 45 days need manager approval."));
    vi.stubGlobal("fetch", fetchMock);

    const schemaResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/connectors/sharepoint/tools",
    );
    expect(schemaResponse.status).toBe(200);
    expect(schemaResponse.body.tools).toEqual([
      expect.objectContaining({
        provider: "sharepoint",
        toolId: "sharepoint.items.import",
        requiredScopes: ["Files.Read", "Sites.Read.All"],
      }),
    ]);

    const response = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/sharepoint/tools/sharepoint.items.import/execute")
      .send({
        connectionId,
        input: {
          selectionId: "site:contoso-support:drive:documents:item:folder-support",
        },
      });

    expect(response.status).toBe(201);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://graph.microsoft.com/v1.0/sites/contoso-support/drives/documents/items/folder-support/children",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: `Bearer ${accessToken}`,
          accept: "application/json",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://graph.microsoft.com/v1.0/sites/contoso-support/drives/documents/items/file-refunds/content",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: `Bearer ${accessToken}`,
          accept: "application/json",
        }),
      }),
    );
    expect(response.body.result).toMatchObject({
      provider: "sharepoint",
      toolId: "sharepoint.items.import",
      articles: [
        {
          id: "file-refunds",
          title: "Refund policy.txt",
          text: "Refunds over 45 days need manager approval.",
          uri: "https://contoso.sharepoint.com/sites/support/Shared%20Documents/Refund%20policy.txt",
        },
      ],
    });
    expect(JSON.stringify(response.body)).not.toContain(accessToken);

    await app.close();
  }, 15_000);

  it("executes Freshdesk Solutions imports through documented tenant-domain API paths", async () => {
    const app = await createTestingApp();
    const connectionId = await configureFreshdeskApiTokenConnection(app, {
      apiUrl: "https://tenant-controlled.example.test",
    });
    const expectedAuthorization = `Basic ${Buffer.from("freshdesk-api-token-123456:X").toString("base64")}`;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, [
          {
            id: 101,
            title: "Refund policy",
            description: "<p>Refunds over 45 days need manager approval.</p>",
            description_text: "Refunds over 45 days need manager approval.",
            status: 2,
            folder_id: 42,
          },
          {
            id: 102,
            title: "Draft escalation",
            description_text: "Do not ingest drafts.",
            status: 1,
            folder_id: 42,
          },
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);

    const schemaResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/connectors/freshdesk/tools",
    );
    expect(schemaResponse.status).toBe(200);
    expect(schemaResponse.body.tools).toEqual([
      expect.objectContaining({
        provider: "freshdesk",
        toolId: "freshdesk.solutions.import",
        requiredScopes: ["solutions:read"],
      }),
    ]);

    const response = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/freshdesk/tools/freshdesk.solutions.import/execute")
      .send({
        connectionId,
        input: {
          selectionId: "folder:42",
        },
      });

    expect(response.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://tuzzy-support.freshdesk.com/api/v2/solutions/folders/42/articles?page=1&per_page=100",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: expectedAuthorization,
          accept: "application/json",
        }),
      }),
    );
    expect(response.body.result).toMatchObject({
      provider: "freshdesk",
      toolId: "freshdesk.solutions.import",
      articles: [
        {
          id: "101",
          title: "Refund policy",
          text: "Refunds over 45 days need manager approval.",
          uri: "https://tuzzy-support.freshdesk.com/a/solutions/articles/101",
        },
      ],
    });
    expect(JSON.stringify(response.body)).not.toContain("freshdesk-api-token-123456");
    expect(JSON.stringify(response.body)).not.toContain("tenant-controlled.example.test");

    await app.close();
  }, 15_000);

  it("executes Salesforce Knowledge imports through SOQL Knowledge article and category contracts", async () => {
    const app = await createTestingApp();
    const connectionId = await connectIntegration(app, "salesforce-knowledge", ["api", "refresh_token"]);
    const accessToken = "salesforce-knowledge:access:salesforce-knowledge-oauth-code-contract";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          records: [
            { ParentId: "ka0ReturnPolicy" },
            { ParentId: "ka0DraftArticle" },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          records: [
            {
              Id: "ka0ReturnPolicy",
              KnowledgeArticleId: "kA0ReturnPolicy",
              Title: "Returns policy",
              Summary: "Return requests after 45 days require a manager review.",
              UrlName: "returns-policy",
              ArticleNumber: "000001",
              PublishStatus: "Online",
              Language: "en_US",
              IsLatestVersion: true,
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const schemaResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/connectors/salesforce-knowledge/tools",
    );
    expect(schemaResponse.status).toBe(200);
    expect(schemaResponse.body.tools).toEqual([
      expect.objectContaining({
        provider: "salesforce-knowledge",
        toolId: "salesforce-knowledge.articles.import",
        requiredScopes: ["api", "refresh_token"],
      }),
    ]);

    const response = await request(app.getHttpServer())
      .post(
        "/organizations/tenant-west-africa/integrations/connectors/salesforce-knowledge/tools/salesforce-knowledge.articles.import/execute",
      )
      .send({
        connectionId,
        input: {
          selectionId: "category:Products:Returns",
        },
      });

    expect(response.status).toBe(201);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(
        /^https:\/\/salesforce-knowledge\.local-account\.my\.salesforce\.com\/services\/data\/v60\.0\/query\?q=/,
      ),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: `Bearer ${accessToken}`,
        }),
      }),
    );
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get("q")).toContain(
      "FROM DataCategorySelection WHERE DataCategoryGroupName = 'Products' AND DataCategoryName = 'Returns'",
    );
    expect(new URL(String(fetchMock.mock.calls[1]?.[0])).searchParams.get("q")).toContain(
      "FROM Knowledge__kav WHERE Id IN ('ka0ReturnPolicy','ka0DraftArticle') AND PublishStatus = 'Online' AND IsLatestVersion = true",
    );
    expect(response.body.result).toMatchObject({
      provider: "salesforce-knowledge",
      toolId: "salesforce-knowledge.articles.import",
      articles: [
        {
          id: "ka0ReturnPolicy",
          title: "Returns policy",
          text: "Return requests after 45 days require a manager review.",
          uri: "https://salesforce-knowledge.local-account.my.salesforce.com/lightning/r/Knowledge__kav/ka0ReturnPolicy/view",
        },
      ],
    });
    expect(JSON.stringify(response.body)).not.toContain(accessToken);

    await app.close();
  }, 15_000);
});
