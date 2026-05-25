import { betterAuth } from "better-auth";
import { memoryAdapter, type MemoryDB } from "better-auth/adapters/memory";
import { Pool } from "pg";

import { zaraOrganizationPlugin } from "./organization-model";

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

export const zaraAuth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:4010",
  database: resolveAuthDatabase(),
  emailAndPassword: {
    enabled: true,
  },
  plugins: [zaraOrganizationPlugin],
  secret: process.env.BETTER_AUTH_SECRET ?? "zara-local-auth-secret-for-tests-only",
  trustedOrigins: [
    ...localTrustedOrigins,
    "https://app.zara.ai",
    "https://admin.zara.ai",
    "https://staging-app.zara.ai",
    "https://staging-admin.zara.ai",
  ],
});

function resolveAuthDatabase() {
  if (usesLocalMemoryAuth()) {
    return memoryAdapter(authMemoryDb);
  }

  return new Pool({
    connectionString: process.env.DATABASE_URL,
  });
}

function usesLocalMemoryAuth() {
  return process.env.NODE_ENV === "test"
    || process.env.ZARA_ENV === "local"
    || process.env.ZARA_AUTH_DATABASE === "memory";
}
