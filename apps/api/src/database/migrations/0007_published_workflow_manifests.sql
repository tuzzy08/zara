CREATE TABLE "published_workflow_manifests" (
	"published_version_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "published_workflow_manifests_tenant_id_published_version_id_pk" PRIMARY KEY("tenant_id","published_version_id")
);
--> statement-breakpoint
ALTER TABLE "published_workflow_manifests" ADD CONSTRAINT "published_workflow_manifests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;
--> statement-breakpoint
CREATE INDEX "published_workflow_manifests_tenant_workflow_idx" ON "published_workflow_manifests" USING btree ("tenant_id","workflow_id");
