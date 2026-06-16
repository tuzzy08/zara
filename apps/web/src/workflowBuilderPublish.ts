export interface PublishableWorkflowVersion {
  graph: {
    name: string;
  };
  manifestPreview: {
    workflowId: string;
  };
  workspaceId?: string | undefined;
}

export function resolveWorkflowPublishTarget<TVersion extends PublishableWorkflowVersion>(input: {
  currentWorkflowId: string;
  publishedVersions: TVersion[];
  selectedWorkspaceId: string;
  workflowTitle: string;
}) {
  const workspaceVersions = getWorkspaceVersions(input.publishedVersions, input.selectedWorkspaceId);
  const sameNameWorkflow = workspaceVersions.find(
    (version) => normalizeWorkflowName(version.graph.name) === normalizeWorkflowName(input.workflowTitle),
  );

  if (sameNameWorkflow !== undefined) {
    const workflowId = sameNameWorkflow.manifestPreview.workflowId;

    return {
      mode: "overwrite" as const,
      workflowId,
      existingVersions: input.publishedVersions.filter((version) => version.manifestPreview.workflowId === workflowId),
      replaceWorkflowIds: [workflowId],
    };
  }

  return {
    mode: "create" as const,
    workflowId: buildUniqueWorkflowId(input.workflowTitle, input.publishedVersions),
    existingVersions: [] as TVersion[],
    replaceWorkflowIds: [] as string[],
  };
}

export function normalizeWorkflowName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
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
