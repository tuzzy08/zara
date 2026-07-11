import type { CompiledRuntimeManifest } from "@zara/core";

export const PUBLISHED_WORKFLOW_MANIFEST_REPOSITORY = Symbol(
  "PUBLISHED_WORKFLOW_MANIFEST_REPOSITORY",
);

export interface PublishedWorkflowManifestRepository {
  save(manifest: CompiledRuntimeManifest): Promise<void>;
  load(input: {
    organizationId: string;
    publishedVersionId: string;
  }): Promise<CompiledRuntimeManifest | null>;
}

export class InMemoryPublishedWorkflowManifestRepository
implements PublishedWorkflowManifestRepository {
  private readonly manifests = new Map<string, CompiledRuntimeManifest>();

  async save(manifest: CompiledRuntimeManifest) {
    this.manifests.set(createManifestKey(manifest.tenantId, manifest.publishedVersionId), structuredClone(manifest));
  }

  async load(input: { organizationId: string; publishedVersionId: string }) {
    const manifest = this.manifests.get(createManifestKey(input.organizationId, input.publishedVersionId));
    return manifest === undefined ? null : structuredClone(manifest);
  }
}

function createManifestKey(organizationId: string, publishedVersionId: string) {
  return `${organizationId}:${publishedVersionId}`;
}
