import { describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";

import { AppModule } from "./app.module";
import { PostgresTenantStatusRepository } from "./persistence/tenant-status.repository";
import { PostgresPlatformBillingReadRepository } from "./platform-admin/platform-billing-read.repository";

describe("AppModule", () => {
  it("boots in test mode and serves the health endpoint", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PostgresTenantStatusRepository)
      .useValue({ async getStatus() { return { outcome: "found", status: "active" }; } })
      .overrideProvider(PostgresPlatformBillingReadRepository)
      .useValue({
        async read() {
          return {
            currency: null,
            shadowEstimateMinor: null,
            premiumShadowEstimateMinor: null,
            deliveredChargeMinor: null,
            incompleteUsageCount: 0,
            blockedUsageCount: 0,
            tenantsOverBudget: 0,
            organizations: [],
          };
        },
      })
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer()).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      service: "zara-api",
    });

    await app.close();
  }, 15_000);

  it("mounts the guarded platform-admin API in the application module", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PostgresTenantStatusRepository)
      .useValue({ async getStatus() { return { outcome: "found", status: "active" }; } })
      .overrideProvider(PostgresPlatformBillingReadRepository)
      .useValue({
        async read() {
          return {
            currency: null,
            shadowEstimateMinor: null,
            premiumShadowEstimateMinor: null,
            deliveredChargeMinor: null,
            incompleteUsageCount: 0,
            blockedUsageCount: 0,
            tenantsOverBudget: 0,
            organizations: [],
          };
        },
      })
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer())
      .get("/platform-admin/dashboard")
      .set("x-zara-test-actor-user-id", "user-platform-admin")
      .set("x-zara-test-platform-role", "platform_admin")
      .set("x-zara-test-auth-assurance", "mfa")
      .set("x-zara-test-session-authenticated-at", new Date().toISOString());

    expect(response.status).toBe(200);
    expect(response.body.dashboard.systemHealth.status).toBe("operational");

    await app.close();
  }, 15_000);
});
