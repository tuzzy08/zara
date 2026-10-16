CREATE TABLE "integration_tenant_states" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL,
	"revision" integer NOT NULL,
	CONSTRAINT "integration_tenant_states_revision_positive" CHECK ("integration_tenant_states"."revision" > 0)
);
