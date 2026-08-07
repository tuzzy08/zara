import request from "supertest";import { afterEach, describe, expect, it, vi } from "vitest";import { connectIntegration, createTestingApp, jsonResponse } from "./connector-tools.contract.test-support";

describe("connector provider contracts", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("executes Confluence knowledge imports through documented Cloud REST API paths", async () => {
    const app = await createTestingApp();
    const connectionId = await connectIntegration(app, "confluence", [
      "read:page:confluence",
      "read:space:confluence",
    ]);
    const accessToken = "confluence:access:confluence-oauth-code-contract";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          id: "page-refunds",
          title: "Refund policy",
          body: {
            storage: {
              value: "<p>Refunds over 45 days need manager approval.</p>",
            },
          },
          _links: {
            webui: "/wiki/spaces/SUP/pages/page-refunds/Refund+policy",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          results: [
            {
              id: "page-installation",
              title: "Installation procedure",
              body: {
                storage: {
                  value: "<p>Confirm site contact before installation.</p>",
                },
              },
              _links: {
                webui: "/wiki/spaces/SUP/pages/page-installation/Installation+procedure",
              },
            },
          ],
          _links: {
            next: "https://api.atlassian.com/ex/confluence/confluence%3Alocal-account/wiki/api/v2/pages?cursor=next&body-format=storage",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          results: [
            {
              id: "page-escalation",
              title: "Escalation policy",
              body: {
                storage: {
                  value: "<p>Escalate safety calls to the duty manager.</p>",
                },
              },
              _links: {
                webui: "/wiki/spaces/SUP/pages/page-escalation/Escalation+policy",
              },
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const schemaResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/connectors/confluence/tools",
    );
    expect(schemaResponse.status).toBe(200);
    expect(schemaResponse.body.tools).toEqual([
      expect.objectContaining({
        provider: "confluence",
        toolId: "confluence.pages.import",
        requiredScopes: ["read:page:confluence", "read:space:confluence"],
      }),
    ]);

    const response = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/confluence/tools/confluence.pages.import/execute")
      .send({
        connectionId,
        input: {
          selectionId: "page:page-refunds",
        },
      });

    expect(response.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.atlassian.com/ex/confluence/confluence%3Alocal-account/wiki/api/v2/pages/page-refunds?body-format=storage",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: `Bearer ${accessToken}`,
          accept: "application/json",
        }),
      }),
    );
    expect(response.body.result).toMatchObject({
      provider: "confluence",
      toolId: "confluence.pages.import",
      articles: [
        {
          id: "page-refunds",
          title: "Refund policy",
          text: "Refunds over 45 days need manager approval.",
          uri: "https://confluence.atlassian.com/wiki/spaces/SUP/pages/page-refunds/Refund+policy",
        },
      ],
    });
    expect(JSON.stringify(response.body)).not.toContain(accessToken);

    const spaceResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/confluence/tools/confluence.pages.import/execute")
      .send({
        connectionId,
        input: {
          selectionId: "space:space-support",
        },
      });

    expect(spaceResponse.status).toBe(201);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.atlassian.com/ex/confluence/confluence%3Alocal-account/wiki/api/v2/pages?space-id=space-support&body-format=storage&limit=25",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://api.atlassian.com/ex/confluence/confluence%3Alocal-account/wiki/api/v2/pages?cursor=next&body-format=storage",
      expect.objectContaining({ method: "GET" }),
    );
    expect(spaceResponse.body.result.articles).toEqual([
      expect.objectContaining({
        id: "page-installation",
        text: "Confirm site contact before installation.",
      }),
      expect.objectContaining({
        id: "page-escalation",
        text: "Escalate safety calls to the duty manager.",
      }),
    ]);

    await app.close();
  }, 15_000);
});
