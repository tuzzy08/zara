import { afterEach, describe, expect, it, vi } from "vitest";

import { requestJson } from "./apiClient";

describe("requestJson", () => {
  afterEach(() => {
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
});
