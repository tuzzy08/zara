export type WorkflowPublishMode = "create" | "overwrite";

export interface PublishableWorkflowVersion {
  graph: {
    name: string;
  };
  manifestPreview: {
    workflowId: string;
  };
  workspaceId?: string | undefined;
}

export interface WorkflowOverwriteOption {
  workflowId: string;
  label: string;
}

export function resolveWorkflowPublishTarget<TVersion extends PublishableWorkflowVersion>(input: {
  currentWorkflowId: string;
  publishedVersions: TVersion[];
  publishMode: WorkflowPublishMode;
  selectedOverwriteWorkflowId: string;
  selectedWorkspaceId: string;
  workflowTitle: string;
}) {
  const workspaceVersions = getWorkspaceVersions(input.publishedVersions, input.selectedWorkspaceId);

  if (input.publishMode === "overwrite") {
    const workflowId = resolveOverwriteWorkflowId({
      currentWorkflowId: input.currentWorkflowId,
      selectedOverwriteWorkflowId: input.selectedOverwriteWorkflowId,
      workspaceVersions,
      workflowTitle: input.workflowTitle,
    });

    return {
      workflowId,
      existingVersions: input.publishedVersions.filter((version) => version.manifestPreview.workflowId === workflowId),
      replaceWorkflowIds: workflowId.length === 0 ? [] : [workflowId],
    };
  }

  return {
    workflowId: buildUniqueWorkflowId(input.workflowTitle, input.publishedVersions),
    existingVersions: [] as TVersion[],
    replaceWorkflowIds: [] as string[],
  };
}

export function getOverwriteWorkflowOptions(
  publishedVersions: PublishableWorkflowVersion[],
  selectedWorkspaceId: string,
): WorkflowOverwriteOption[] {
  const latestByWorkflowId = new Map<string, WorkflowOverwriteOption>();

  for (const version of getWorkspaceVersions(publishedVersions, selectedWorkspaceId)) {
    latestByWorkflowId.set(version.manifestPreview.workflowId, {
      workflowId: version.manifestPreview.workflowId,
      label: version.graph.name,
    });
  }

  return [...latestByWorkflowId.values()].sort((left, right) => left.label.localeCompare(right.label));
}

export function normalizeWorkflowName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function resolveOverwriteWorkflowId(input: {
  currentWorkflowId: string;
  selectedOverwriteWorkflowId: string;
  workspaceVersions: PublishableWorkflowVersion[];
  workflowTitle: string;
}) {
  if (
    input.selectedOverwriteWorkflowId.length > 0 &&
    input.workspaceVersions.some((version) => version.manifestPreview.workflowId === input.selectedOverwriteWorkflowId)
  ) {
    return input.selectedOverwriteWorkflowId;
  }

  return (
    input.workspaceVersions.find(
      (version) => normalizeWorkflowName(version.graph.name) === normalizeWorkflowName(input.workflowTitle),
    )?.manifestPreview.workflowId
    ?? input.currentWorkflowId
  );
}

function buildUniqueWorkflowId(title: string, publishedVersions: PublishableWorkflowVersion[]) {
  const existingIds = new Set(publishedVersions.map((version) => version.manifestPreview.workflowId));
  const baseId = `workflow-${slugifyWorkflowName(title) || "untitled"}`;

  if (!existingIds.has(baseId)) {
    return baseId;
  }

  let suffix = 2;
  while (existingIds.has(`${baseId}-${suffix}`)) {
    suffix += 1;
  }

  return `${baseId}-${suffix}`;
}

function getWorkspaceVersions<TVersion extends PublishableWorkflowVersion>(
  publishedVersions: TVersion[],
  selectedWorkspaceId: string,
) {
  return publishedVersions.filter((version) => version.workspaceId === selectedWorkspaceId);
}

function slugifyWorkflowName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
