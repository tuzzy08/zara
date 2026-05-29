import { describe, expect, it, vi } from "vitest";

import { createPostgresTenantMirror } from "./tenant-mirror";

describe("tenant mirror", () => {
  it("upserts Better Auth organizations into the product tenants table", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    const mirror = createPostgresTenantMirror({ query });

    await mirror.upsertTenant({
      id: "org-acme",
      name: "Acme Voice Ops",
      slug: "acme-voice-ops",
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO "tenants"'),
      [
        "org-acme",
        "acme-voice-ops",
        "Acme Voice Ops",
      ],
    );
    expect(query.mock.calls[0]?.[0]).toContain("ON CONFLICT");
    expect(query.mock.calls[0]?.[0]).toContain("DO UPDATE");
  });
});
