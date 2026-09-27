import { describe, expect, it } from "vitest";

import { AssemblyAiBillingEvidenceSource } from "./assemblyai-billing-evidence.source";

describe("AssemblyAiBillingEvidenceSource", () => {
  it("fails closed until duration coverage and supplier costs are qualified", async () => {
    const source = new AssemblyAiBillingEvidenceSource();

    await expect(source.collectCycle({
      organizationId: "tenant-a",
      catalogId: "catalog-1",
      cycleStartsAt: "2026-08-01T00:00:00.000Z",
      cycleEndsAt: "2026-09-01T00:00:00.000Z",
    })).rejects.toThrow(
      "AssemblyAI billing evidence is unavailable: production duration coverage and supplier costs are not qualified.",
    );
  });
});
