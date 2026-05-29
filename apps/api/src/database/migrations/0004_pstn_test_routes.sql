ALTER TABLE "telephony_phone_numbers" ADD COLUMN "live_route" jsonb;--> statement-breakpoint
ALTER TABLE "telephony_phone_numbers" ADD COLUMN "test_route" jsonb;--> statement-breakpoint
ALTER TABLE "telephony_phone_numbers" ADD COLUMN "phone_test_results" jsonb;--> statement-breakpoint
ALTER TABLE "telephony_dispatches" ADD COLUMN "route_mode" text;--> statement-breakpoint
ALTER TABLE "telephony_dispatches" ADD COLUMN "runtime_profile" text;--> statement-breakpoint
ALTER TABLE "telephony_dispatches" ADD COLUMN "test_route_session_id" text;--> statement-breakpoint
UPDATE "telephony_phone_numbers"
SET "live_route" = jsonb_build_object(
  'mode', 'live_route',
  'publishedVersionId', "published_version_id",
  'workflowLabel', "workflow_label",
  'workspaceId', "workspace_id",
  'runtimeProfile', 'cost-optimized',
  'createdAt', now()
)
WHERE "published_version_id" IS NOT NULL
  AND "workflow_label" IS NOT NULL
  AND "workspace_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "telephony_phone_numbers" DROP COLUMN "published_version_id";--> statement-breakpoint
ALTER TABLE "telephony_phone_numbers" DROP COLUMN "workflow_label";--> statement-breakpoint
ALTER TABLE "telephony_phone_numbers" DROP COLUMN "workspace_id";--> statement-breakpoint
