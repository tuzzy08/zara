import type { Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import type { CompiledRuntimeManifest } from "@zara/core";

import { PostgresPublishedWorkflowManifestRepository } from "./postgres-published-workflow-manifest.repository";

describe("PostgresPublishedWorkflowManifestRepository", () => {
  let pool: Pool | null = null;

  afterEach(async () => {
    await pool?.end();
    pool = null;
  });

  it("round-trips an immutable manifest with tenant-scoped lookup", async () => {
    const database = newDb();
    const adapter = database.adapters.createPg();
    pool = new adapter.Pool() as unknown as Pool;
    await pool.query(`
      create table published_workflow_manifests (
        published_version_id text not null,
        tenant_id text not null,
        workspace_id text not null,
        workflow_id text not null,
        manifest jsonb not null,
        created_at timestamptz not null,
        primary key (tenant_id, published_version_id)
      )
    `);
    const repository = new PostgresPublishedWorkflowManifestRepository(pool);
    const manifest = {
      schemaVersion: "zara.runtime-manifest.v2",
      manifestId: "workflow-premium-v1:manifest",
      publishedVersionId: "workflow-premium-v1",
      workflowId: "workflow-premium",
      tenantId: "tenant-west-africa",
      workspaceId: "workspace-support",
      environment: "production",
      runtime: "openai-realtime",
      runtimeProfile: "premium-realtime",
      telephonyProvider: "twilio",
      entryNodeId: "entry",
      entryAgentId: "agent-jane",
      graph: { id: "workflow-premium", name: "Premium", entryNodeId: "entry", nodes: [], edges: [] },
      routePolicies: [],
      exitNodes: [],
      toolBindings: [],
      agentToolAssignments: [],
      memory: { mode: "session-only", retrievalScopes: ["session"], approvalRequired: true },
      budget: { monthlyCapUsd: 100, currentSpendUsd: 0, projectedCostPerMinuteUsd: 0.1, blockOnLimit: true },
      modelRouting: [],
      telemetry: { captureAudio: false, captureTranscript: true, redactSensitiveData: true, sinks: ["live-monitor"] },
    } as unknown as CompiledRuntimeManifest;

    await repository.save(manifest);
    const otherTenantManifest = {
      ...manifest,
      tenantId: "tenant-other",
      workspaceId: "workspace-other",
      manifestId: "tenant-other:workflow-premium-v1:manifest",
    };
    await repository.save(otherTenantManifest);

    await expect(repository.load({
      organizationId: "tenant-west-africa",
      publishedVersionId: "workflow-premium-v1",
    })).resolves.toEqual(manifest);
    await expect(repository.load({
      organizationId: "tenant-other",
      publishedVersionId: "workflow-premium-v1",
    })).resolves.toEqual(otherTenantManifest);
  });
});
