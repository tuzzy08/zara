import { describe, expect, it, vi } from "vitest";

import { OpenAiOrganizationBillingClient } from "./openai-organization-billing.client";

describe("OpenAI organization billing client", () => {
  it("treats optional token counters as zero", async () => {
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(await response({ object: "page", data: [{
        object: "bucket",
        start_time: 1785542400,
        end_time: 1785628800,
        results: [{ object: "organization.usage.completions.result", project_id: "proj-a", model: null, service_tier: null, input_tokens: 2, output_tokens: 1, num_model_requests: 1 }],
      }], has_more: false, next_page: null }))
      .mockResolvedValueOnce(await response({ object: "page", data: [], has_more: false, next_page: null }));
    const client = new OpenAiOrganizationBillingClient({ adminKey: "admin", fetchImplementation });

    const result = await client.getProjectCycleEvidence({
      projectId: "proj-a",
      cycleStartsAt: "2026-08-01T00:00:00.000Z",
      cycleEndsAt: "2026-08-02T00:00:00.000Z",
    });

    expect(result.usage[0]).toMatchObject({
      inputCachedTokens: 0,
      inputAudioTokens: 0,
      outputAudioTokens: 0,
    });
  });

  it("reads all project-scoped usage and cost pages for the exact cycle", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const request = new URL(url);
      expect(init).toMatchObject({
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: "Bearer admin-key",
        },
      });
      expect(request.searchParams.get("start_time")).toBe("1785542400");
      expect(request.searchParams.get("end_time")).toBe("1788220800");
      expect(request.searchParams.getAll("project_ids")).toEqual(["proj_tenant_a"]);

      if (request.pathname.endsWith("/usage/completions")) {
        expect(request.searchParams.getAll("group_by")).toEqual(["project_id", "model", "service_tier"]);
        if (request.searchParams.get("page") === null) {
          return response({
            object: "page",
            data: [{
              object: "bucket",
              start_time: 1785542400,
              end_time: 1785628800,
              results: [{
                object: "organization.usage.completions.result",
                input_tokens: 10,
                output_tokens: 4,
                input_cached_tokens: 2,
                input_audio_tokens: 8,
                output_audio_tokens: 6,
                num_model_requests: 1,
                project_id: "proj_tenant_a",
                model: "gpt-realtime",
                service_tier: "default",
              }],
            }],
            has_more: true,
            next_page: "usage-page-2",
          });
        }
        expect(request.searchParams.get("page")).toBe("usage-page-2");
        return response({ object: "page", data: [], has_more: false, next_page: null });
      }

      expect(request.pathname).toBe("/v1/organization/costs");
      expect(request.searchParams.getAll("group_by")).toEqual(["project_id", "line_item"]);
      return response({
        object: "page",
        data: [{
          object: "bucket",
          start_time: 1785542400,
          end_time: 1785628800,
          results: [{
            object: "organization.costs.result",
            amount: { value: 0.06, currency: "usd" },
            line_item: "Realtime models",
            project_id: "proj_tenant_a",
          }],
        }],
        has_more: false,
        next_page: null,
      });
    });

    const result = await new OpenAiOrganizationBillingClient({
      adminKey: "admin-key",
      fetchImplementation: fetchMock,
    }).getProjectCycleEvidence({
      projectId: "proj_tenant_a",
      cycleStartsAt: "2026-08-01T00:00:00.000Z",
      cycleEndsAt: "2026-09-01T00:00:00.000Z",
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.usage).toHaveLength(1);
    expect(result.costs).toEqual([expect.objectContaining({
      projectId: "proj_tenant_a",
      lineItem: "Realtime models",
      amount: 0.06,
      currency: "usd",
    })]);
  });

  it("fails closed when OpenAI returns unscoped project data", async () => {
    const client = new OpenAiOrganizationBillingClient({
      adminKey: "admin-key",
      fetchImplementation: vi.fn(async (url: string) => response({
        object: "page",
        data: [{
          object: "bucket",
          start_time: 1785542400,
          end_time: 1785628800,
          results: [url.includes("/costs") ? {
            object: "organization.costs.result",
            amount: { value: 1, currency: "usd" },
            line_item: "Realtime models",
            project_id: null,
          } : {
            object: "organization.usage.completions.result",
            input_tokens: 1,
            output_tokens: 1,
            input_cached_tokens: 0,
            input_audio_tokens: 0,
            output_audio_tokens: 0,
            num_model_requests: 1,
            project_id: null,
            model: "gpt-realtime",
            service_tier: "default",
          }],
        }],
        has_more: false,
        next_page: null,
      })),
    });

    await expect(client.getProjectCycleEvidence({
      projectId: "proj_tenant_a",
      cycleStartsAt: "2026-08-01T00:00:00.000Z",
      cycleEndsAt: "2026-09-01T00:00:00.000Z",
    })).rejects.toThrow("OpenAI billing evidence project scope is invalid.");
  });

  it("fails closed when OpenAI returns a bucket outside the exact cycle", async () => {
    const client = new OpenAiOrganizationBillingClient({
      adminKey: "admin-key",
      fetchImplementation: vi.fn(async () => response({
        object: "page",
        data: [{
          object: "bucket",
          start_time: 1785456000,
          end_time: 1785542400,
          results: [{
            object: "organization.usage.completions.result",
            input_tokens: 1,
            output_tokens: 1,
            input_cached_tokens: 0,
            input_audio_tokens: 0,
            output_audio_tokens: 0,
            num_model_requests: 1,
            project_id: "proj_tenant_a",
            model: "gpt-realtime",
            service_tier: "default",
          }],
        }],
        has_more: false,
        next_page: null,
      })),
    });

    await expect(client.getProjectCycleEvidence({
      projectId: "proj_tenant_a",
      cycleStartsAt: "2026-08-01T00:00:00.000Z",
      cycleEndsAt: "2026-09-01T00:00:00.000Z",
    })).rejects.toThrow("OpenAI billing evidence bucket is outside the requested cycle.");
  });
});

function response(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}
