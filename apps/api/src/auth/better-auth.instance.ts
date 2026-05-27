import { betterAuth } from "better-auth";
import { memoryAdapter, type MemoryDB } from "better-auth/adapters/memory";
import { Pool } from "pg";

import { createZaraOrganizationPlugin } from "./organization-model";
import { createPostgresTenantMirror, type TenantMirror } from "./tenant-mirror";

const localTrustedOrigins = [
  "http://127.0.0.1:4173",
  "http://127.0.0.1:4174",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://localhost:4173",
  "http://localhost:4174",
  "http://localhost:5173",
  "http://localhost:5174",
] as const;

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

export const zaraAuth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:4010",
  database: authDatabase.database,
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    createZaraOrganizationPlugin(
      authDatabase.tenantMirror === undefined ? {} : { tenantMirror: authDatabase.tenantMirror },
    ),
  ],
  secret: process.env.BETTER_AUTH_SECRET ?? "zara-local-auth-secret-for-tests-only",
  trustedOrigins: [
    ...localTrustedOrigins,
    "https://app.zara.ai",
    "https://admin.zara.ai",
    "https://staging-app.zara.ai",
    "https://staging-admin.zara.ai",
  ],
});

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
