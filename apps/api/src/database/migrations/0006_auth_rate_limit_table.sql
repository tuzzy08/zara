CREATE TABLE IF NOT EXISTS "rateLimit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"lastRequest" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_rate_limit_key_unique_idx" ON "rateLimit" USING btree ("key");
