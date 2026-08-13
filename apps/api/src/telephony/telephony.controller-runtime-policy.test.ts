import { Test } from "@nestjs/testing";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { TenantOrganizationGuard } from "../auth/tenant-auth";
import { TelephonyController } from "./telephony.controller";
import { TelephonyService } from "./telephony.service";

describe("TelephonyController runtime policy", () => {
  it("does not expose tenant-authoritative runtime policy", async () => {
    const applyCallRuntimePolicy = vi.fn();
    const moduleRef = await Test.createTestingModule({
      controllers: [TelephonyController],
      providers: [{
        provide: TelephonyService,
        useValue: { applyCallRuntimePolicy },
      }],
    })
      .overrideGuard(TenantOrganizationGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer())
      .post("/organizations/tenant-a/telephony/calls/call-a/runtime-policy")
      .send({
        now: "2026-08-11T10:00:00.000Z",
        subscriptionStatus: "active",
        tenantStatus: "suspended",
        budgetAction: "allow",
      });

    expect(response.status).toBe(404);
    expect(applyCallRuntimePolicy).not.toHaveBeenCalled();
    await app.close();
  });
});
