import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins/two-factor";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { mfaAssurance } from "./mfa-assurance";

describe.skipIf(!process.env.ZARA_TEST_POSTGRES_URL)("durable MFA assurance", () => {
  it("allows one verification per TOTP step across instances and preserves proof after restart", async () => {
    const schema = `mfa_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: process.env.ZARA_TEST_POSTGRES_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pools = [0, 1].map(() => new Pool({ connectionString: process.env.ZARA_TEST_POSTGRES_URL, options: `-c search_path=${schema}` }));
    const createAuth = (database: Pool) => betterAuth({
      database, baseURL: "http://localhost:4010", secret: "test-only-mfa-secret-at-least-32-characters",
      emailAndPassword: { enabled: true }, plugins: [twoFactor({ issuer: "Zara" }), mfaAssurance],
    });
    try {
      for (const file of ["0003_auth_organizations.sql", "0042_auth_mfa_assurance.sql", "0043_auth_mfa_attempt_limits.sql"]) {
        await pools[0]!.query(readFileSync(`apps/api/src/database/migrations/${file}`, "utf8").replaceAll('"public".', `"${schema}".`));
      }
      const first = createAuth(pools[0]!);
      const second = createAuth(pools[1]!);
      const cookies = new Map<string, string>();
      const call = async (auth: typeof first, path: string, body?: object) => {
        const response = await auth.handler(new Request(`http://localhost:4010/api/auth${path}`, {
          method: body ? "POST" : "GET",
          headers: { "content-type": "application/json", cookie: [...cookies.values()].join("; ") },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }));
        for (const value of response.headers.getSetCookie()) {
          const cookie = value.split(";")[0]!;
          cookies.set(cookie.split("=")[0]!, cookie);
        }
        return { status: response.status, body: await response.json() };
      };
      const password = "test-password-123";
      expect((await call(first, "/sign-up/email", { email: "owner@example.com", name: "Owner", password })).status).toBe(200);
      const enrollment = await call(first, "/two-factor/enable", { password });
      expect(enrollment.status).toBe(200);
      const secret = new TextDecoder().decode(base32.decode(new URL(enrollment.body.totpURI).searchParams.get("secret")!));
      const otp = createOTP(secret);
      expect((await call(first, "/two-factor/verify-totp", { code: await otp.totp() })).status).toBe(200);
      const nextCode = await otp.hotp(Math.floor(Date.now() / 30_000) + 1);
      const results = await Promise.all([first, second].map(auth => call(auth, "/two-factor/verify-totp", { code: nextCode })));
      expect(results.map(result => result.status).sort()).toEqual([200, 401]);
      const proof = (await call(second, "/get-session")).body.session.mfaVerifiedAt;
      expect(Number.isFinite(Date.parse(proof))).toBe(true);
      const restarted = createAuth(pools[1]!);
      expect((await call(restarted, "/get-session")).body.session.mfaVerifiedAt).toBe(proof);
      expect((await call(restarted, "/two-factor/verify-totp", { code: nextCode })).status).toBe(401);
      expect((await call(restarted, "/get-session")).body.session.mfaVerifiedAt).toBe(proof);
      const originalSession = (await call(first, "/get-session")).body.session;
      expect((await call(second, "/two-factor/enable", { password })).status).toBe(200);
      // Simulate a previously verified request completing its stored proof write after rotation.
      await pools[0]!.query('update "session" set "mfaVerifiedAt" = $1, "mfaFactorId" = $2 where id = $3',
        [proof, originalSession.mfaFactorId, originalSession.id]);
      expect((await call(first, "/get-session")).body.session.mfaVerifiedAt).toBeNull();
    } finally {
      await Promise.all(pools.map(pool => pool.end()));
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  }, 30_000);
});
