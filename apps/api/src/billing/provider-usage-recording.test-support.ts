import { readFileSync } from "node:fs";
import { newDb } from "pg-mem";

export function usageRecordingTestPool() {
  const db = newDb();
  db.public.none(readFileSync("apps/api/src/database/migrations/0037_provider_usage_recording.sql", "utf8").split("--> statement-breakpoint")[0]!);
  db.public.none(readFileSync("apps/api/src/database/migrations/0038_provider_usage_connections.sql", "utf8").split("--> statement-breakpoint")[0]!);
  for (const statement of readFileSync("apps/api/src/database/migrations/0039_provider_usage_attribution.sql", "utf8").split("--> statement-breakpoint").slice(0, 2)) {
    db.public.none(statement);
  }
  return new (db.adapters.createPg().Pool)();
}
