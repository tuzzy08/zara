import { Test } from "@nestjs/testing";
import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlatformAdminGuard, getPlatformAdminContext } from "../platform-admin/platform-admin.guard";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { BetterAuthController } from "./better-auth.controller";
import { AuthContextController } from "./auth-context.controller";

@Controller("mfa-check")
@UseGuards(PlatformAdminGuard)
class MfaCheckController {
  @Get()
  read(@Req() req: Record<string | symbol, unknown>) {
    return getPlatformAdminContext(req).platformAuth;
  }
}

afterEach(() => vi.unstubAllEnvs());

describe("Platform owner TOTP assurance", () => {
  it.each(["enable", "disable"])("clears other sessions' proof after factor %s", async (operation) => {
    const module = await Test.createTestingModule({
      imports: [WorkspacesModule],
      controllers: [AuthContextController, MfaCheckController, BetterAuthController],
      providers: [PlatformAdminGuard],
    }).compile();
    const app = module.createNestApplication();
    await app.init();
    const first = request.agent(app.getHttpServer());
    const second = request.agent(app.getHttpServer());
    const email = `mfa-rotation-${crypto.randomUUID()}@example.com`;
    const password = "test-password-123";
    try {
      expect((await first.post("/api/auth/sign-up/email").send({ email, password, name: "Owner" })).status).toBe(200);
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ZARA_PLATFORM_STAFF_ROLES", `${email}=platform_owner`);
      const enrollment = await first.post("/api/auth/two-factor/enable").send({ password });
      const secret = new TextDecoder().decode(base32.decode(new URL(enrollment.body.totpURI).searchParams.get("secret")!));
      expect((await first.post("/api/auth/two-factor/verify-totp").send({ code: await createOTP(secret).totp() })).status).toBe(200);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(Date.now() + 60_000));
      expect((await second.post("/api/auth/sign-in/email").send({ email, password })).body.twoFactorRedirect).toBe(true);
      expect((await second.post("/api/auth/two-factor/verify-totp").send({ code: await createOTP(secret).totp() })).status).toBe(200);
      expect((await first.get("/mfa-check")).body.mutationAllowed).toBe(true);
      expect((await second.get("/mfa-check")).body.mutationAllowed).toBe(true);

      const changed = await second.post(`/api/auth/two-factor/${operation}`).send({ password });
      expect(changed.status).toBe(200);
      expect((await first.get("/api/auth/get-session")).body.session.mfaVerifiedAt).toBeNull();
      const replacement = operation === "enable" ? changed
        : await second.post("/api/auth/two-factor/enable").send({ password });
      const newSecret = new TextDecoder().decode(base32.decode(new URL(replacement.body.totpURI).searchParams.get("secret")!));
      expect((await second.post("/api/auth/two-factor/verify-totp").send({ code: await createOTP(newSecret).totp() })).status).toBe(200);
      expect((await second.get("/mfa-check")).body.mutationAllowed).toBe(true);
      expect((await first.get("/mfa-check")).body.mutationAllowed).toBe(false);
    } finally {
      vi.useRealTimers();
      await app.close();
    }
  }, 30_000);

  it("grants production authority only after a valid authenticator code", async () => {
    const module = await Test.createTestingModule({
      imports: [WorkspacesModule],
      controllers: [AuthContextController, MfaCheckController, BetterAuthController],
      providers: [PlatformAdminGuard],
    }).compile();
    const app = module.createNestApplication();
    await app.init();
    const client = request.agent(app.getHttpServer());
    const email = `mfa-${crypto.randomUUID()}@example.com`;
    const password = "test-password-123";
    try {
      expect((await client.post("/api/auth/sign-up/email").send({
        email, password, name: "Owner", mfaVerifiedAt: new Date().toISOString(), mfaFactorId: "forged", twoFactorEnabled: true,
      })).status).toBe(200);
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ZARA_PLATFORM_STAFF_ROLES", `${email}=platform_owner`);
      expect((await client.get("/api/auth/context")).body.platformAuth.mutationAllowed).toBe(false);

      const enrollment = await client.post("/api/auth/two-factor/enable").send({ password });
      expect(enrollment.status).toBe(200);
      const secret = new TextDecoder().decode(base32.decode(new URL(enrollment.body.totpURI).searchParams.get("secret")!));
      const code = await createOTP(secret).totp();
      expect((await client.post("/api/auth/two-factor/verify-totp").send({ code: "invalid" })).status).toBe(401);
      expect((await client.get("/api/auth/context")).body.platformAuth.mutationAllowed).toBe(false);
      expect((await client.post("/api/auth/two-factor/verify-totp").send({ code })).status).toBe(200);
      expect((await client.get("/api/auth/context")).body.platformAuth).toMatchObject({
        assuranceLevel: "mfa", mutationAllowed: true,
      });
      // This read passes through the real production PlatformAdminGuard.
      expect((await client.get("/mfa-check")).body).toMatchObject({ mutationAllowed: true });
      const verifiedAt = (await client.get("/api/auth/get-session")).body.session.mfaVerifiedAt;
      expect((await client.post("/api/auth/two-factor/verify-totp").send({ code })).status).toBe(401);
      expect((await client.get("/api/auth/get-session")).body.session.mfaVerifiedAt).toBe(verifiedAt);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(Date.now() + 16 * 60_000));
      expect((await client.get("/mfa-check")).body.mutationAllowed).toBe(false);
      const nextCode = await createOTP(secret).totp();
      expect((await client.post("/api/auth/two-factor/verify-totp").send({ code: nextCode })).status).toBe(200);
      expect((await client.get("/mfa-check")).body.mutationAllowed).toBe(true);
      expect((await client.post("/api/auth/sign-out").send({})).status).toBe(200);
      expect((await client.post("/api/auth/sign-in/email").send({ email, password })).body.twoFactorRedirect).toBe(true);
      expect((await client.post("/api/auth/two-factor/verify-backup-code").send({ code: enrollment.body.backupCodes[0] })).status).toBe(200);
      expect((await client.get("/mfa-check")).body.mutationAllowed).toBe(false);
      expect((await client.get("/api/auth/get-session")).body.session.mfaVerifiedAt).toBeNull();
      expect((await client.post("/api/auth/two-factor/disable").send({ password })).status).toBe(200);
      expect((await client.get("/api/auth/context")).body.platformAuth.mutationAllowed).toBe(false);
    } finally {
      vi.useRealTimers();
      await app.close();
    }
  }, 30_000);
});
