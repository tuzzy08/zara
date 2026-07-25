CREATE TABLE "telephony_premium_dispatch_snapshots" (
	"tenant_id" text NOT NULL,
	"call_session_id" text NOT NULL,
	"dispatch_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"published_version_id" text NOT NULL,
	"schema_version" integer NOT NULL,
	"checksum" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "telephony_premium_dispatch_snapshots_tenant_id_call_session_id_pk" PRIMARY KEY("tenant_id","call_session_id"),
	CONSTRAINT "telephony_premium_dispatch_snapshots_schema_version_check" CHECK ("telephony_premium_dispatch_snapshots"."schema_version" > 0),
	CONSTRAINT "telephony_premium_dispatch_snapshots_checksum_check" CHECK (char_length("telephony_premium_dispatch_snapshots"."checksum") = 64 and "telephony_premium_dispatch_snapshots"."checksum" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "telephony_premium_dispatch_snapshots_snapshot_object_check" CHECK (jsonb_typeof("telephony_premium_dispatch_snapshots"."snapshot") = 'object')
);
--> statement-breakpoint
ALTER TABLE "telephony_media_stream_tokens" ADD COLUMN "owner_worker_id" text;--> statement-breakpoint
ALTER TABLE "telephony_media_stream_tokens" ADD COLUMN "owner_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "telephony_premium_dispatch_snapshots" ADD CONSTRAINT "telephony_premium_dispatch_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "telephony_premium_dispatch_snapshots" ADD CONSTRAINT "telephony_premium_dispatch_snapshots_session_fk" FOREIGN KEY ("tenant_id","call_session_id") REFERENCES "public"."telephony_execution_sessions"("tenant_id","call_session_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "telephony_premium_dispatch_snapshots" ADD CONSTRAINT "telephony_premium_dispatch_snapshots_dispatch_fk" FOREIGN KEY ("tenant_id","dispatch_id") REFERENCES "public"."telephony_dispatches"("tenant_id","id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "telephony_media_stream_tokens" ADD CONSTRAINT "telephony_media_stream_tokens_owner_epoch_check" CHECK ("telephony_media_stream_tokens"."owner_epoch" >= 0);--> statement-breakpoint
ALTER TABLE "telephony_media_stream_tokens" ADD CONSTRAINT "telephony_media_stream_tokens_owner_pair_check" CHECK (("telephony_media_stream_tokens"."owner_worker_id" is null and "telephony_media_stream_tokens"."owner_epoch" = 0)
          or ("telephony_media_stream_tokens"."owner_worker_id" is not null and "telephony_media_stream_tokens"."owner_epoch" > 0));