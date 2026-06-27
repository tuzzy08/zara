import { afterEach, describe, expect, it, vi } from "vitest";

import { requestJson, resolveApiBaseUrl } from "./apiClient";

describe("requestJson", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends Better Auth cookies with tenant API requests by default", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await requestJson<{ ok: boolean }>("/organizations/tenant-west-africa/workspaces/state");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4010/organizations/tenant-west-africa/workspaces/state",
      expect.objectContaining({
        credentials: "include",
      }),
    );
  });

  it("uses the auth base URL for API requests when only auth is configured", () => {
    expect(resolveApiBaseUrl({
      VITE_AUTH_BASE_URL: "http://localhost:4010",
      VITE_API_BASE_URL: undefined,
    })).toBe("http://localhost:4010");
  });
});
