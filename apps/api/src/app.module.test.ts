import { describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";

import { AppModule } from "./app.module";

describe("AppModule", () => {
  it("boots in test mode and serves the health endpoint", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer())
      .get("/platform-admin/dashboard")
      .set("x-zara-actor-user-id", "user-platform-admin")
      .set("x-zara-platform-role", "platform_admin");

    expect(response.status).toBe(200);
    expect(response.body.dashboard.systemHealth.status).toBe("operational");

    await app.close();
  }, 15_000);
});
