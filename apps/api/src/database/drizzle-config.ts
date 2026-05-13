export const drizzleConfigValues = {
  dialect: "postgresql",
  schema: "./apps/api/src/database/schema.ts",
  out: "./apps/api/src/database/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/zara",
  },
  strict: true,
  verbose: true,
} as const;
