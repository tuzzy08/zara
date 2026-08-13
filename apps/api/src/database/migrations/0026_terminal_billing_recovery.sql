CREATE TABLE "billing_subscription_overage_accounts" (
  "tenant_id" text NOT NULL,
  "cycle_id" text NOT NULL,
  "reserved_overage_minor" bigint DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "billing_subscription_overage_accounts_pk" PRIMARY KEY ("tenant_id", "cycle_id"),
  CONSTRAINT "billing_subscription_overage_accounts_cycle_fk"
    FOREIGN KEY ("tenant_id", "cycle_id")
    REFERENCES "billing_cycles"("tenant_id", "id")
    ON DELETE cascade ON UPDATE cascade,
  CONSTRAINT "billing_subscription_overage_accounts_values_check"
    CHECK ("reserved_overage_minor" >= 0)
);
--> statement-breakpoint
INSERT INTO "billing_subscription_overage_accounts" (
  "tenant_id", "cycle_id", "reserved_overage_minor", "updated_at"
)
SELECT
  "tenant_id",
  "cycle_id",
  SUM("reserved_overage_minor"),
  MAX("updated_at")
FROM "billing_subscription_call_reservations"
WHERE "status" = 'active'
GROUP BY "tenant_id", "cycle_id";
--> statement-breakpoint
CREATE TABLE "billing_terminal_recovery_jobs" (
  "tenant_id" text NOT NULL,
  "id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "call_session_id" text NOT NULL,
  "reservation_id" text NOT NULL,
  "commercial_mode" text NOT NULL,
  "usage_fact" jsonb NOT NULL,
  "settlement_fact" jsonb NOT NULL,
  "payg_applied_minor" bigint,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone NOT NULL,
  "lease_expires_at" timestamp with time zone,
  "lease_token" text,
  "last_error" text,
  "completed_at" timestamp with time zone,
  "dead_lettered_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "billing_terminal_recovery_jobs_pk" PRIMARY KEY ("tenant_id", "id"),
  CONSTRAINT "billing_terminal_recovery_jobs_tenant_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE cascade ON UPDATE cascade,
  CONSTRAINT "billing_terminal_recovery_jobs_tenant_idempotency_unique"
    UNIQUE ("tenant_id", "idempotency_key"),
  CONSTRAINT "billing_terminal_recovery_jobs_mode_check"
    CHECK ("commercial_mode" IN ('payg', 'subscription')),
  CONSTRAINT "billing_terminal_recovery_jobs_status_check"
    CHECK ("status" IN ('pending', 'processing', 'completed', 'dead_letter')),
  CONSTRAINT "billing_terminal_recovery_jobs_attempt_check"
    CHECK ("attempt_count" >= 0),
  CONSTRAINT "billing_terminal_recovery_jobs_payg_applied_check"
    CHECK ("payg_applied_minor" IS NULL OR "payg_applied_minor" >= 0),
  CONSTRAINT "billing_terminal_recovery_jobs_lifecycle_check"
    CHECK (
      ("status" = 'pending' AND "lease_expires_at" IS NULL AND "lease_token" IS NULL
        AND "completed_at" IS NULL AND "dead_lettered_at" IS NULL)
      OR ("status" = 'processing' AND "lease_expires_at" IS NOT NULL AND "lease_token" IS NOT NULL
        AND "completed_at" IS NULL AND "dead_lettered_at" IS NULL)
      OR ("status" = 'completed' AND "lease_expires_at" IS NULL AND "lease_token" IS NULL
        AND "completed_at" IS NOT NULL AND "dead_lettered_at" IS NULL)
      OR ("status" = 'dead_letter' AND "lease_expires_at" IS NULL AND "lease_token" IS NULL
        AND "completed_at" IS NULL AND "dead_lettered_at" IS NOT NULL)
    )
);
--> statement-breakpoint
CREATE INDEX "billing_terminal_recovery_jobs_due_idx"
  ON "billing_terminal_recovery_jobs" ("status", "next_attempt_at");
--> statement-breakpoint
CREATE INDEX "billing_terminal_recovery_jobs_reservation_idx"
  ON "billing_terminal_recovery_jobs" ("tenant_id", "commercial_mode", "reservation_id", "status");
