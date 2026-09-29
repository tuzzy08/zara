import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { symmetricDecrypt } from "better-auth/crypto";
import { createOTP } from "@better-auth/utils/otp";

export const mfaAssurance = {
  id: "zara-mfa-assurance",
  init: () => ({ options: { databaseHooks: {
    session: { create: { before: async (session) => ({ data: { ...session, mfaVerifiedAt: null, mfaFactorId: null } }) } },
  } } }),
  schema: {
    session: { fields: {
      mfaVerifiedAt: { type: "date", required: false, input: false },
      mfaFactorId: { type: "string", required: false, input: false },
    } },
    twoFactor: { fields: { lastVerifiedStep: { type: "number", defaultValue: -1, input: false, returned: false } } },
  },
  hooks: { after: [{
    matcher: (ctx) => ctx.path === "/get-session",
    handler: createAuthMiddleware(async (ctx) => {
      const result = ctx.context.returned;
      if (!result || typeof result !== "object" || !("session" in result) || !result.session) return;
      const session = result.session as Record<string, unknown>;
      if (!session.mfaVerifiedAt) return;
      const factor = await ctx.context.adapter.findOne<{ id: string }>({
        model: "twoFactor", where: [{ field: "userId", value: session.userId as string }],
      });
      if (factor && factor.id === session.mfaFactorId) return;
      // A late proof write from a replaced factor cannot restore staff authority.
      return ctx.json({ ...result, session: { ...session, mfaVerifiedAt: null, mfaFactorId: null } });
    }),
  }, {
    matcher: (ctx) => ctx.path === "/two-factor/verify-totp",
    handler: createAuthMiddleware(async (ctx) => {
      const result = ctx.context.returned;
      if (!result || typeof result !== "object" || !("token" in result)) return;
      const session = ctx.context.newSession ?? ctx.context.session;
      if (!session) return;
      const factor = await ctx.context.adapter.findOne<{ id: string; secret: string }>({
        model: "twoFactor", where: [{ field: "userId", value: session.user.id }],
      });
      if (!factor) throw new APIError("UNAUTHORIZED", { message: "Authenticator verification is required." });
      const otp = createOTP(await symmetricDecrypt({ key: ctx.context.secretConfig, data: factor.secret }));
      const currentStep = Math.floor(Date.now() / 30_000);
      let verifiedStep = -1;
      for (const step of [currentStep - 1, currentStep, currentStep + 1]) {
        if (await otp.hotp(step) === ctx.body.code) verifiedStep = step;
      }
      const claimed = verifiedStep >= 0 && await ctx.context.adapter.update({
        model: "twoFactor",
        where: [{ field: "id", value: factor.id }, { field: "lastVerifiedStep", operator: "lt", value: verifiedStep }],
        update: { lastVerifiedStep: verifiedStep },
      });
      if (!claimed) throw new APIError("UNAUTHORIZED", { message: "Use a new authenticator code." });
      await ctx.context.internalAdapter.updateSession(session.session.token, {
        mfaVerifiedAt: new Date(), mfaFactorId: factor.id,
      });
    }),
  }] },
} satisfies BetterAuthPlugin;
