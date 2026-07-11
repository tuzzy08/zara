import type { Pool } from "pg";
import type { CompiledRuntimeManifest } from "@zara/core";

import type { PublishedWorkflowManifestRepository } from "./published-workflow-manifest.repository";

type Queryable = Pick<Pool, "query">;

export class PostgresPublishedWorkflowManifestRepository
implements PublishedWorkflowManifestRepository {
  constructor(private readonly database: Queryable) {}

  async save(manifest: CompiledRuntimeManifest) {
    await this.database.query(
      `insert into published_workflow_manifests (
        published_version_id, tenant_id, workspace_id, workflow_id, manifest, created_at
      ) values ($1, $2, $3, $4, $5::jsonb, $6)
      on conflict (tenant_id, published_version_id) do nothing`,
      [
        manifest.publishedVersionId,
        manifest.tenantId,
        manifest.workspaceId ?? "",
        manifest.workflowId,
        JSON.stringify(manifest),
        new Date().toISOString(),
      ],
    );
  }

  async load(input: { organizationId: string; publishedVersionId: string }) {
    const result = await this.database.query<{ manifest: CompiledRuntimeManifest }>(
      `select manifest
       from published_workflow_manifests
       where tenant_id = $1 and published_version_id = $2`,
      [input.organizationId, input.publishedVersionId],
    );
    const manifest = result.rows[0]?.manifest;
    return manifest === undefined ? null : structuredClone(manifest);
  }
}
