import { filterPublishedWorkflowVersionsForWorkspace, type PublishedWorkflowVersion } from "@zara/core";

const publishedWorkflowsKey = "zara.web.published-workflows.v1";
const selectedSandboxWorkflowKey = "zara.web.selected-sandbox-workflow.v1";

export function loadPublishedWorkflowVersions(): PublishedWorkflowVersion[] {
  const storage = getStorage();

  if (storage === null) {
    return [];
  }

  try {
    const raw = storage.getItem(publishedWorkflowsKey);
    const parsed = raw === null ? [] : JSON.parse(raw);

    return Array.isArray(parsed) ? parsed.filter(isPublishedWorkflowVersion) : [];
  } catch {
    return [];
  }
}

export function loadPublishedWorkflowVersionsForWorkspace(input: {
  tenantId: string;
  workspaceId: string;
}): PublishedWorkflowVersion[] {
  return filterPublishedWorkflowVersionsForWorkspace({
    versions: loadPublishedWorkflowVersions(),
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
  });
}

export function savePublishedWorkflowVersion(
  version: PublishedWorkflowVersion,
  options: { replaceWorkflowIds?: string[] } = {},
): PublishedWorkflowVersion[] {
  const versions = loadPublishedWorkflowVersions();
  const replaceWorkflowIds = new Set(options.replaceWorkflowIds ?? []);
  const nextVersions = [
    ...versions.filter(
      (currentVersion) =>
        currentVersion.id !== version.id &&
        !replaceWorkflowIds.has(currentVersion.manifestPreview.workflowId),
    ),
    version,
  ].sort(comparePublishedVersions);
  const storage = getStorage();

  if (storage !== null) {
    storage.setItem(publishedWorkflowsKey, JSON.stringify(nextVersions));
  }

  return nextVersions;
}

export function selectSandboxWorkflowVersion(versionId: string) {
  const storage = getStorage();

  if (storage !== null) {
    storage.setItem(selectedSandboxWorkflowKey, versionId);
  }
}

export function getSelectedSandboxWorkflowVersionId() {
  return getStorage()?.getItem(selectedSandboxWorkflowKey) ?? null;
}

export function getSandboxWorkflowVersionOptionId(version: PublishedWorkflowVersion) {
  return `${version.manifestPreview.workflowId}:v${version.version}`;
}

function comparePublishedVersions(a: PublishedWorkflowVersion, b: PublishedWorkflowVersion) {
  const workflowOrder = a.manifestPreview.workflowId.localeCompare(b.manifestPreview.workflowId);

  if (workflowOrder !== 0) {
    return workflowOrder;
  }

  return a.version - b.version;
}

function getStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

function isPublishedWorkflowVersion(value: unknown): value is PublishedWorkflowVersion {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<PublishedWorkflowVersion>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.tenantId === "string" &&
    typeof candidate.version === "number" &&
    typeof candidate.workspaceId === "string" &&
    candidate.graph !== undefined &&
    candidate.manifestPreview !== undefined &&
    typeof candidate.manifestPreview.workflowId === "string"
  );
}
