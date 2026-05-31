import { betterAuth } from "better-auth";
import { memoryAdapter, type MemoryDB } from "better-auth/adapters/memory";
import { Pool } from "pg";

import { resolveTrustedOrigins } from "../config/trusted-origins";
import { resolveAuthEmailDeliveryConfig, sendAuthEmail } from "./auth-email-delivery";
import { createZaraOrganizationPlugin } from "./organization-model";
import { createPostgresTenantMirror, type TenantMirror } from "./tenant-mirror";

const authMemoryDb: MemoryDB = {
  user: [],
  session: [],
  account: [],
  verification: [],
  organization: [],
  member: [],
  invitation: [],
};

type AuthDatabaseMode = "memory" | "postgres";
type AuthDatabaseResolution = {
  database: ReturnType<typeof memoryAdapter> | Pool;
  tenantMirror?: TenantMirror;
};

const authDatabase = resolveAuthDatabase();
const authRuntimeSecurity = resolveAuthRuntimeSecurity(process.env);

export const zaraAuth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:4010",
  database: authDatabase.database,
  advanced: authRuntimeSecurity.advanced,
  emailAndPassword: {
    enabled: true,
    resetPasswordTokenExpiresIn: authRuntimeSecurity.emailAndPassword.resetPasswordTokenExpiresIn,
    revokeSessionsOnPasswordReset: authRuntimeSecurity.emailAndPassword.revokeSessionsOnPasswordReset,
    sendResetPassword: async ({ user, url, token }) => {
      await sendAuthEmail({
        kind: "password_reset",
        subject: "Reset your Zara password",
        to: user.email,
        token,
        url,
        userId: user.id,
      });
    },
  },
  emailVerification: {
    expiresIn: authRuntimeSecurity.emailVerification.expiresIn,
    sendOnSignIn: authRuntimeSecurity.emailVerification.sendOnSignIn,
    sendOnSignUp: authRuntimeSecurity.emailVerification.sendOnSignUp,
    sendVerificationEmail: async ({ user, url, token }) => {
      await sendAuthEmail({
        kind: "email_verification",
        subject: "Verify your Zara email",
        to: user.email,
        token,
        url,
        userId: user.id,
      });
    },
  },
  plugins: [
    createZaraOrganizationPlugin(
      authDatabase.tenantMirror === undefined ? {} : { tenantMirror: authDatabase.tenantMirror },
    ),
  ],
  rateLimit: authRuntimeSecurity.rateLimit,
  secret: authRuntimeSecurity.secret,
  trustedOrigins: resolveTrustedOrigins(),
});

type AuthRuntimeSecurity = {
  advanced: {
    ipAddress: {
      ipAddressHeaders: string[];
    };
    trustedProxyHeaders: boolean;
    useSecureCookies: boolean;
  };
  emailAndPassword: {
    resetPasswordTokenExpiresIn: number;
    revokeSessionsOnPasswordReset: boolean;
  };
  emailVerification: {
    expiresIn: number;
    sendOnSignIn: boolean;
    sendOnSignUp: boolean;
  };
  rateLimit: {
    enabled: boolean;
    max: number;
    storage: "database" | "memory";
    window: number;
  };
  secret: string;
};

function resolveAuthDatabase(): AuthDatabaseResolution {
  if (resolveAuthDatabaseMode(process.env) === "memory") {
    return {
      database: memoryAdapter(authMemoryDb),
    };
  }

  const connectionString = process.env.DATABASE_URL?.trim();

  if (!connectionString) {
    throw new Error("Better Auth requires DATABASE_URL outside tests. Configure Postgres for durable auth storage.");
  }

  const pool = new Pool({
    connectionString,
  });

  return {
    database: pool,
    tenantMirror: createPostgresTenantMirror(pool),
  };
}

export function resolveAuthDatabaseMode(env: Record<string, string | undefined>): AuthDatabaseMode {
  const explicitMode = env.ZARA_AUTH_DATABASE?.trim();

  if (env.NODE_ENV === "test") {
    return explicitMode === "postgres" ? "postgres" : "memory";
  }

  if (explicitMode === "memory") {
    throw new Error("ZARA_AUTH_DATABASE=memory is only allowed during tests. Configure Postgres for durable auth storage.");
  }

  if (explicitMode === "postgres") {
    return "postgres";
  }

  return "postgres";
}

export function resolveAuthRuntimeSecurity(env: Record<string, string | undefined>): AuthRuntimeSecurity {
  resolveAuthEmailDeliveryConfig(env);

  const isTest = env.NODE_ENV === "test";
  const isProduction = env.NODE_ENV === "production";
  const secret = env.BETTER_AUTH_SECRET?.trim()
    || (isTest ? "zara-local-auth-secret-for-tests-only" : "");

  if (secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be at least 32 characters outside tests.");
  }

  return {
    advanced: {
      ipAddress: {
        ipAddressHeaders: ["x-forwarded-for", "cf-connecting-ip"],
      },
      trustedProxyHeaders: isProduction,
      useSecureCookies: isProduction,
    },
    emailAndPassword: {
      resetPasswordTokenExpiresIn: readPositiveInteger(env.ZARA_AUTH_RESET_TOKEN_TTL_SECONDS, 3600),
      revokeSessionsOnPasswordReset: true,
    },
    emailVerification: {
      expiresIn: readPositiveInteger(env.ZARA_AUTH_VERIFICATION_TOKEN_TTL_SECONDS, 3600),
      sendOnSignIn: false,
      sendOnSignUp: false,
    },
    rateLimit: {
      enabled: !isTest,
      max: readPositiveInteger(env.ZARA_AUTH_RATE_LIMIT_MAX, 60),
      storage: isProduction ? "database" : "memory",
      window: readPositiveInteger(env.ZARA_AUTH_RATE_LIMIT_WINDOW_SECONDS, 60),
    },
    secret,
  };
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}
