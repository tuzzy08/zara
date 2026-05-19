CREATE TABLE "telephony_call_control_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"dispatch_id" text NOT NULL,
	"call_session_id" text NOT NULL,
	"event_type" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"summary" text NOT NULL,
	"fallback_target" text,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telephony_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"label" text NOT NULL,
	"ownership_mode" text NOT NULL,
	"provider" text NOT NULL,
	"region" text NOT NULL,
	"status" text NOT NULL,
	"health_status" text NOT NULL,
	"recording_policy" jsonb NOT NULL,
	"block_routing_on_health_failure" boolean NOT NULL,
	"credential_reference" jsonb,
	"external_reference" text,
	"sip" jsonb,
	"webhook_base_url" text,
	"webhook_status" text NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telephony_credential_envelopes" (
	"connection_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"envelope" jsonb
);
--> statement-breakpoint
CREATE TABLE "telephony_dispatches" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"direction" text NOT NULL,
	"disposition" text NOT NULL,
	"reason" text NOT NULL,
	"call_session_id" text,
	"phone_number_id" text,
	"fallback_phone_number_id" text,
	"connection_id" text,
	"published_version_id" text,
	"workspace_id" text,
	"workflow_label" text,
	"outage_mode" text,
	"recording" jsonb NOT NULL,
	"to_phone_number" text NOT NULL,
	"from_phone_number" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"policy_checks" jsonb
);
--> statement-breakpoint
CREATE TABLE "telephony_execution_commands" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"session_id" text NOT NULL,
	"dispatch_id" text NOT NULL,
	"call_session_id" text NOT NULL,
	"provider" text NOT NULL,
	"action" text NOT NULL,
	"status" text NOT NULL,
	"target" text NOT NULL,
	"payload" jsonb NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "telephony_execution_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"dispatch_id" text NOT NULL,
	"call_session_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"provider" text NOT NULL,
	"ownership_mode" text NOT NULL,
	"direction" text NOT NULL,
	"status" text NOT NULL,
	"to_phone_number" text NOT NULL,
	"from_phone_number" text NOT NULL,
	"workflow_label" text,
	"workspace_id" text,
	"test_call" boolean NOT NULL,
	"bridge_kind" text NOT NULL,
	"bridge_target" text NOT NULL,
	"media_path" text NOT NULL,
	"outage_mode" text,
	"fallback_target" text,
	"diagnostics" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telephony_health_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"status" text NOT NULL,
	"blocking" boolean NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"message" text NOT NULL,
	"scheduled" boolean,
	"latency_ms" integer,
	"diagnostics" jsonb
);
--> statement-breakpoint
CREATE TABLE "telephony_phone_numbers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"provider" text NOT NULL,
	"provision_source" text NOT NULL,
	"external_number_id" text NOT NULL,
	"phone_number" text NOT NULL,
	"friendly_name" text NOT NULL,
	"voice_capable" boolean NOT NULL,
	"caller_id_eligible" boolean NOT NULL,
	"status" text NOT NULL,
	"webhook_status" text NOT NULL,
	"published_version_id" text,
	"workflow_label" text,
	"workspace_id" text,
	"recording_policy" jsonb
);
--> statement-breakpoint
CREATE TABLE "telephony_processed_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"event_sid" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telephony_provider_heartbeats" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"provider" text NOT NULL,
	"ownership_mode" text NOT NULL,
	"status" text NOT NULL,
	"blocking" boolean NOT NULL,
	"scheduled" boolean NOT NULL,
	"latency_ms" integer NOT NULL,
	"routed_number_count" integer NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"message" text NOT NULL,
	"diagnostics" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telephony_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"account_sid" text NOT NULL,
	"call_sid" text NOT NULL,
	"event_sid" text NOT NULL,
	"event_type" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"duplicate" boolean NOT NULL
);
--> statement-breakpoint
ALTER TABLE "telephony_call_control_events" ADD CONSTRAINT "telephony_call_control_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "telephony_connections" ADD CONSTRAINT "telephony_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "telephony_credential_envelopes" ADD CONSTRAINT "telephony_credential_envelopes_connection_id_telephony_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."telephony_connections"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "telephony_credential_envelopes" ADD CONSTRAINT "telephony_credential_envelopes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "telephony_dispatches" ADD CONSTRAINT "telephony_dispatches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "telephony_execution_commands" ADD CONSTRAINT "telephony_execution_commands_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "telephony_execution_commands" ADD CONSTRAINT "telephony_execution_commands_session_id_telephony_execution_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."telephony_execution_sessions"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "telephony_execution_sessions" ADD CONSTRAINT "telephony_execution_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "telephony_execution_sessions" ADD CONSTRAINT "telephony_execution_sessions_dispatch_id_telephony_dispatches_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."telephony_dispatches"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "telephony_execution_sessions" ADD CONSTRAINT "telephony_execution_sessions_connection_id_telephony_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."telephony_connections"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "telephony_health_checks" ADD CONSTRAINT "telephony_health_checks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "telephony_health_checks" ADD CONSTRAINT "telephony_health_checks_connection_id_telephony_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."telephony_connections"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "telephony_phone_numbers" ADD CONSTRAINT "telephony_phone_numbers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "telephony_phone_numbers" ADD CONSTRAINT "telephony_phone_numbers_connection_id_telephony_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."telephony_connections"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "telephony_processed_webhook_events" ADD CONSTRAINT "telephony_processed_webhook_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "telephony_provider_heartbeats" ADD CONSTRAINT "telephony_provider_heartbeats_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "telephony_provider_heartbeats" ADD CONSTRAINT "telephony_provider_heartbeats_connection_id_telephony_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."telephony_connections"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "telephony_webhook_events" ADD CONSTRAINT "telephony_webhook_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "telephony_webhook_events" ADD CONSTRAINT "telephony_webhook_events_connection_id_telephony_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."telephony_connections"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "telephony_call_control_events_tenant_at_idx" ON "telephony_call_control_events" USING btree ("tenant_id","at");--> statement-breakpoint
CREATE INDEX "telephony_connections_tenant_idx" ON "telephony_connections" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "telephony_connections_provider_idx" ON "telephony_connections" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "telephony_credential_envelopes_tenant_idx" ON "telephony_credential_envelopes" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "telephony_dispatches_tenant_created_at_idx" ON "telephony_dispatches" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "telephony_dispatches_call_session_idx" ON "telephony_dispatches" USING btree ("call_session_id");--> statement-breakpoint
CREATE INDEX "telephony_execution_commands_session_requested_at_idx" ON "telephony_execution_commands" USING btree ("session_id","requested_at");--> statement-breakpoint
CREATE INDEX "telephony_execution_sessions_tenant_updated_at_idx" ON "telephony_execution_sessions" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telephony_execution_sessions_call_session_unique_idx" ON "telephony_execution_sessions" USING btree ("call_session_id");--> statement-breakpoint
CREATE INDEX "telephony_health_checks_tenant_checked_at_idx" ON "telephony_health_checks" USING btree ("tenant_id","checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telephony_phone_numbers_tenant_phone_unique_idx" ON "telephony_phone_numbers" USING btree ("tenant_id","phone_number");--> statement-breakpoint
CREATE INDEX "telephony_phone_numbers_connection_idx" ON "telephony_phone_numbers" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telephony_processed_webhook_events_tenant_event_sid_unique_idx" ON "telephony_processed_webhook_events" USING btree ("tenant_id","event_sid");--> statement-breakpoint
CREATE INDEX "telephony_provider_heartbeats_tenant_at_idx" ON "telephony_provider_heartbeats" USING btree ("tenant_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "telephony_webhook_events_tenant_event_sid_unique_idx" ON "telephony_webhook_events" USING btree ("tenant_id","event_sid");