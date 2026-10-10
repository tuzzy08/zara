import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it("returns the second-factor challenge without treating it as a staff session", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ twoFactorRedirect: true })));
  vi.stubGlobal("fetch", fetch);
  const { platformAdminAuthClient } = await import("./index");
  expect(await platformAdminAuthClient.signInEmail({ email: "staff@example.com", password: "test-only" }))
    .toEqual({ ok: true, twoFactorRedirect: true });
  expect(platformAdminAuthClient.useSession().data).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("enrolls and verifies through cookie-authenticated native MFA endpoints", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
    totpURI: "otpauth://totp/Zara:test?secret=JBSWY3DPEHPK3PXP&issuer=Zara", backupCodes: ["test-backup-code"],
  }))).mockResolvedValueOnce(new Response(JSON.stringify({ message: "Invalid code" }), { status: 401 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ token: "must-not-return", user: {} })));
  vi.stubGlobal("fetch", fetch);
  const { enablePlatformMfa, verifyPlatformMfa } = await import("./index");
  expect(await enablePlatformMfa("test-only-password")).toMatchObject({ ok: true, backupCodes: ["test-backup-code"] });
  expect(fetch.mock.calls[0]).toEqual(["http://127.0.0.1:4010/api/auth/two-factor/enable", expect.objectContaining({
    method: "POST", credentials: "include", body: JSON.stringify({ password: "test-only-password" }),
  })]);
  expect(await verifyPlatformMfa("000000")).toMatchObject({ ok: false });
  expect(await verifyPlatformMfa("123456")).toEqual({ ok: true });
  expect(fetch.mock.calls[2]).toEqual(["http://127.0.0.1:4010/api/auth/two-factor/verify-totp", expect.objectContaining({
    method: "POST", credentials: "include", body: JSON.stringify({ code: "123456", trustDevice: false }),
  })]);
});
