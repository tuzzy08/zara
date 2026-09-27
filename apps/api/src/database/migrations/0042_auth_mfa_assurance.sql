CREATE TABLE "twoFactor" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"secret" text NOT NULL,
	"backupCodes" text NOT NULL,
	"verified" boolean DEFAULT true,
	"lastVerifiedStep" bigint DEFAULT -1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "mfaVerifiedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "mfaFactorId" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "twoFactorEnabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "twoFactor" ADD CONSTRAINT "twoFactor_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_two_factor_user_idx" ON "twoFactor" USING btree ("userId");
