import type { Pool } from "pg";
import type { CompiledRuntimeManifest } from "@zara/core";

import {
  nextPublicationVersion,
  WorkflowPublicationConflictError,
  type PublishedWorkflowManifestRepository,
  type PublishWorkflowManifestInput,
  type WorkflowPublication,
} from "./published-workflow-manifest.repository";

type Queryable = Pick<Pool, "query">;

export class PostgresPublishedWorkflowManifestRepository
implements PublishedWorkflowManifestRepository {
  constructor(private readonly database: Pick<Pool, "query" | "connect">) {}

  async publish<TPublication extends WorkflowPublication>(input: PublishWorkflowManifestInput<TPublication>) {
    const client = await this.database.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
        JSON.stringify(["workflow-publication", input.organizationId, input.workflowId]),
      ]);
      const existing = await client.query<{
        published_version_id: string;
        workspace_id: string;
        manifest: CompiledRuntimeManifest;
      }>(
        `select published_version_id, workspace_id, manifest from published_workflow_manifests
         where tenant_id = $1 and workflow_id = $2`,
        [input.organizationId, input.workflowId],
      );
      const manifests = existing.rows.map((row) => {
        if (row.published_version_id !== row.manifest.publishedVersionId || row.workspace_id !== row.manifest.workspaceId) {
          throw new Error("Stored workflow manifest identity is invalid.");
        }
        return row.manifest;
      });
      const publication = await input.createPublication(nextPublicationVersion(input, manifests));
      const manifest = await insertManifest(client, publication.manifest);
      await client.query("commit");
      return { ...publication, manifest };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async save(manifest: CompiledRuntimeManifest) {
    await insertManifest(this.database, manifest);
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

async function insertManifest(database: Queryable, manifest: CompiledRuntimeManifest) {
  try {
    const result = await database.query<{ manifest: CompiledRuntimeManifest }>(
      `insert into published_workflow_manifests (
        published_version_id, tenant_id, workspace_id, workflow_id, manifest, created_at
      ) values ($1, $2, $3, $4, $5::jsonb, $6)
      returning manifest`,
      [
        manifest.publishedVersionId,
        manifest.tenantId,
        manifest.workspaceId ?? "",
        manifest.workflowId,
        JSON.stringify(manifest),
        new Date().toISOString(),
      ],
    );
    return result.rows[0]!.manifest;
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "23505") {
      throw new WorkflowPublicationConflictError("This published workflow version already exists.");
    }
    throw error;
  }
}
