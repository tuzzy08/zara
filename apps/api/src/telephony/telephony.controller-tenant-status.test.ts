import { describe, expect, it, vi } from "vitest";

import { TelephonyController } from "./telephony.controller";
import type { TelephonyService } from "./telephony.service";

describe("TelephonyController tenant-status authority", () => {
  it.each(["activateLiveRoute", "resumeLiveRoute"] as const)(
    "does not pass client tenant status through %s",
    async (method) => {
      const operation = vi.fn(async (input: Record<string, unknown>) => input);
      const controller = new TelephonyController({
        [method]: operation,
      } as unknown as TelephonyService);

      await controller[method](
        "tenant-1",
        "number-1",
        { userId: "user-1" } as never,
        { actorUserId: "spoofed", tenantStatus: "active" } as never,
      );

      expect(operation).toHaveBeenCalledWith({
        organizationId: "tenant-1",
        numberId: "number-1",
        actorUserId: "user-1",
        now: undefined,
        override: undefined,
      });
    },
  );
});
