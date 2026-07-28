import { describe, expect, it } from "vitest";

import {
  InMemoryPstnCapacityRejectionRepository,
} from "./pstn-capacity-rejection.repository";
import {
  PstnCapacityRejectionService,
} from "./pstn-capacity-rejection.service";

describe("PstnCapacityRejectionService", () => {
  it("stores idempotent tenant-scoped rejection history without topology", async () => {
    const repository = new InMemoryPstnCapacityRejectionRepository();
    const service = new PstnCapacityRejectionService(
      repository,
      () => new Date("2026-07-28T10:00:00.000Z"),
    );

    await service.record({
      tenantId: "tenant-a",
      callSessionId: "call-a",
      reasonCode: "worker_concurrency_limit",
    });
    await service.record({
      tenantId: "tenant-a",
      callSessionId: "call-a",
      reasonCode: "worker_concurrency_limit",
    });
    await service.record({
      tenantId: "tenant-b",
      callSessionId: "call-b",
      reasonCode: "tenant_concurrency_limit",
    });

    await expect(service.listForTenant("tenant-a", 10)).resolves.toEqual([
      {
        occurredAt: "2026-07-28T10:00:00.000Z",
        reasonCode: "worker_concurrency_limit",
      },
    ]);
    await expect(service.listRecent(10)).resolves.toEqual([
      {
        tenantId: "tenant-a",
        occurredAt: "2026-07-28T10:00:00.000Z",
        reasonCode: "worker_concurrency_limit",
      },
      {
        tenantId: "tenant-b",
        occurredAt: "2026-07-28T10:00:00.000Z",
        reasonCode: "tenant_concurrency_limit",
      },
    ]);
  });
});
