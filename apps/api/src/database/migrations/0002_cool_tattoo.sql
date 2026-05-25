CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "memory_embeddings" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"record_kind" text NOT NULL,
	"record_id" text NOT NULL,
	"scope" text NOT NULL,
	"caller_kind" text,
	"caller_value" text,
	"account_id" text,
	"published_workflow_version_ids" jsonb,
	"confidence" real NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memory_embeddings" ADD CONSTRAINT "memory_embeddings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "memory_embeddings_tenant_scope_idx" ON "memory_embeddings" USING btree ("tenant_id","scope");--> statement-breakpoint
CREATE INDEX "memory_embeddings_caller_idx" ON "memory_embeddings" USING btree ("tenant_id","caller_kind","caller_value");--> statement-breakpoint
CREATE INDEX "memory_embeddings_account_idx" ON "memory_embeddings" USING btree ("tenant_id","account_id");--> statement-breakpoint
CREATE INDEX "memory_embeddings_embedding_ivfflat_idx" ON "memory_embeddings" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
