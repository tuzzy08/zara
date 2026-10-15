import type { CompiledRuntimeManifest, PublishedWorkflowVersion } from "@zara/core";

export const PUBLISHED_WORKFLOW_MANIFEST_REPOSITORY = Symbol(
  "PUBLISHED_WORKFLOW_MANIFEST_REPOSITORY",
);

export interface PublishedWorkflowManifestRepository {
  publish<TPublication extends WorkflowPublication>(input: PublishWorkflowManifestInput<TPublication>): Promise<TPublication>;
  save(manifest: CompiledRuntimeManifest): Promise<void>;
  load(input: {
    organizationId: string;
    publishedVersionId: string;
  }): Promise<CompiledRuntimeManifest | null>;
}

export interface WorkflowPublication {
  publishedVersion: PublishedWorkflowVersion;
  manifest: CompiledRuntimeManifest;
}

export interface PublishWorkflowManifestInput<TPublication extends WorkflowPublication = WorkflowPublication> {
  organizationId: string;
  workspaceId: string;
  workflowId: string;
  expectedVersion: number;
  createPublication: (versionNumber: number) => TPublication | Promise<TPublication>;
}

export class WorkflowPublicationConflictError extends Error {
  constructor(message: string, readonly currentVersion?: number) {
    super(message);
  }
}

export function nextPublicationVersion(
  input: PublishWorkflowManifestInput,
  manifests: CompiledRuntimeManifest[],
) {
  let currentVersion = 0;
  for (const manifest of manifests) {
    if (manifest.tenantId !== input.organizationId || manifest.workflowId !== input.workflowId) {
      throw new Error("Stored workflow manifest identity is invalid.");
    }
    if (manifest.workspaceId !== input.workspaceId) {
      throw new WorkflowPublicationConflictError("This workflow belongs to another workspace.");
    }
    const prefix = `${input.workflowId}-v`;
    const version = Number(manifest.publishedVersionId.slice(prefix.length));
    if (!Number.isSafeInteger(version) || version < 1 || manifest.publishedVersionId !== `${prefix}${version}`) {
      throw new Error("Stored workflow version identity is invalid.");
    }
    currentVersion = Math.max(currentVersion, version);
  }
  if (input.expectedVersion !== currentVersion) {
    throw new WorkflowPublicationConflictError(
      "This workflow has changed. Load the latest version before publishing.",
      currentVersion,
    );
  }
  return currentVersion + 1;
}

export class InMemoryPublishedWorkflowManifestRepository
implements PublishedWorkflowManifestRepository {
  private readonly manifests = new Map<string, CompiledRuntimeManifest>();
  private readonly pendingPublications = new Map<string, Promise<void>>();

  async publish<TPublication extends WorkflowPublication>(input: PublishWorkflowManifestInput<TPublication>) {
    const key = JSON.stringify([input.organizationId, input.workflowId]);
    const previous = this.pendingPublications.get(key);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    this.pendingPublications.set(key, pending);
    await previous;
    try {
      const manifests = [...this.manifests.values()].filter((manifest) =>
        manifest.tenantId === input.organizationId && manifest.workflowId === input.workflowId);
      const publication = await input.createPublication(nextPublicationVersion(input, manifests));
      await this.save(publication.manifest);
      return structuredClone(publication);
    } finally {
      release();
      if (this.pendingPublications.get(key) === pending) this.pendingPublications.delete(key);
    }
  }

  async save(manifest: CompiledRuntimeManifest) {
    const key = createManifestKey(manifest.tenantId, manifest.publishedVersionId);
    if (this.manifests.has(key)) {
      throw new WorkflowPublicationConflictError("This published workflow version already exists.");
    }
    this.manifests.set(key, structuredClone(manifest));
  }

  async load(input: { organizationId: string; publishedVersionId: string }) {
    const manifest = this.manifests.get(createManifestKey(input.organizationId, input.publishedVersionId));
    return manifest === undefined ? null : structuredClone(manifest);
  }
}

function createManifestKey(organizationId: string, publishedVersionId: string) {
  return `${organizationId}:${publishedVersionId}`;
}
