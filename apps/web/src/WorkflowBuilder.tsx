import { useCallback, useEffect, useMemo, useReducer, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { ReactNode } from "react";

import {
  addEdge,
  Background,
  ConnectionMode,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  reconnectEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  Headphones,
  KeyRound,
  PhoneCall,
  PhoneOff,
  Power,
  Plus,
  Play,
  RotateCcw,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { Button, Select } from "@zara/ui";

import {
  buildRuntimeManifestPreview,
  applySpecialistRoleTemplate,
  createAgentRoleNode,
  createEndNode,
  createHumanEscalationNode,
  createSpecialistRoleTemplate,
  createToolNode,
  createWorkflowGraph,
  deleteWorkflowNode,
  geminiLiveVoiceNames,
  openAiRealtimeVoices,
  resolveAgentRouteRoleProfile,
  updateSpecialistRoleTemplate,
  validateWorkflowGraph,
  type AgentRoleKind,
  type AgentRoutePolicyBranchConfig,
  type AgentRoutePolicyConfig,
  type AgentRoutePolicyTarget,
  type AgentVoiceConfig,
  type AgentRoleNodeConfig,
  type CompiledRuntimeManifest,
  type EndNodeConfig,
  type EscalationFallbackMode,
  type ImportedTelephonyPhoneNumber,
  type HumanEscalationNodeConfig,
  type GeminiLiveVoiceName,
  type ModelTier,
  type OpenAiRealtimeVoice,
  type PublishedWorkflowVersion,
  type RealtimeProviderId,
  type RealtimeVoiceConfig,
  type RuntimeProfileId,
  type RuntimeManifestPreview,
  type SpecialistRoleTemplate,
  type TelephonyConnection,
  type TelephonyProvider,
  type TenantRole,
  type TextModelProviderId,
  type ToolNodeConfig,
  type ToolRequestConfig,
  type VoiceRuntimeKind,
  type Workspace,
  type WorkflowEdgeKind,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNodeKind,
  type WorkflowRelationshipHandleRole,
} from "@zara/core";

import { compileDraftSandboxRuntimeManifest } from "./sandboxRuntimeManifest";
import { getNextBuilderNodeNumber } from "./workflowBuilderIds";
import { getBuilderNodeAccent } from "./workflowBuilderTheme";
import {
  applyBuilderEdgeHandleRoles,
  builderFlowSourceHandleId,
  builderFlowTargetHandleId,
  canCreateBuilderRelationshipFromKind,
  getBuilderConnectionDecision,
  getBuilderPolicyDecision,
  resolveWorkflowBuilderWorkbench,
  toWorkflowRelationshipSourceHandleRole,
  toWorkflowRelationshipTargetHandleRole,
} from "./workflowBuilderWorkbench";
import {
  selectDiagnosticLiveSandboxEvents,
  selectRecentLiveSandboxEvents,
  summarizeLiveSandboxEvent,
} from "./liveSandboxEventFormatting";
import type { LiveSandboxStreamEvent } from "./liveSandboxSessionApi";
import { useLiveSandboxSession, type LiveSandboxStatus } from "./useLiveSandboxSession";
import { decorateLiveWorkflowCanvas } from "./workflowLiveCanvas";
import {
  loadPublishedWorkflowVersionsForWorkspace,
  savePublishedWorkflowVersion,
} from "./workflowSandboxRegistry";
import {
  fetchTelephonyState,
  type TelephonyStateResponse,
} from "./telephonyApi";
import {
  fetchIntegrationCatalog,
  fetchIntegrationConnections,
  fetchToolGrants,
  type IntegrationConnection,
  type ToolGrant,
} from "./tenantIntegrationsApi";
import { tenantId } from "./workspaceState";
import { ApiError } from "./apiClient";
import { publishTenantWorkflow } from "./workflowPublishApi";
import {
  approveTenantVoiceClone,
  deleteTenantVoice,
  disableTenantVoice,
  fetchTenantVoices,
  previewTenantVoice,
  requestTenantVoiceClone,
  type TenantVoiceLibraryVoice,
  type TenantVoicePreviewDescriptor,
  uploadTenantVoiceSourceAudio,
} from "./tenantVoiceLibraryApi";
import {
  createWorkflowToolCatalog,
  createToolConfigFromCatalogItem,
  formatToolConnectorLabel,
  getDefaultToolCatalogItem,
  getIntegrationOptionsForConnector,
  getToolProviderOptions,
  cloneToolRequest,
  type ToolCatalogItem,
} from "./workflowBuilderToolCatalog";
import {
  normalizeWorkflowName,
  resolveWorkflowPublishTarget,
} from "./workflowBuilderPublish";

interface BuilderNodeData extends Record<string, unknown> {
  kind: WorkflowNodeKind;
  label: string;
  badge: string;
  subtitle: string;
  liveState?: "idle" | "active" | "visited" | "current";
  role?: AgentRoleNodeConfig;
  toolId?: string | undefined;
  tool?: ToolNodeConfig;
  escalation?: HumanEscalationNodeConfig;
  end?: EndNodeConfig;
  config?: Record<string, unknown>;
}

type BuilderNode = Node<BuilderNodeData, "builderNode">;

interface BuilderEdgeData extends Record<string, unknown> {
  kind?: WorkflowEdgeKind;
}

type BuilderEdge = Edge<BuilderEdgeData>;

interface QueueOption {
  queueId: string;
  queueName: string;
  fallbackMode: EscalationFallbackMode;
}

interface AgentRouteTargetOption {
  agentId: string;
  label: string;
  roleKind: AgentRoleKind;
  roleName: string;
}

interface AgentRouteFallbackOption {
  label: string;
  target: AgentRoutePolicyTarget;
  value: string;
}

interface DeletedCanvasSnapshot {
  nodes: BuilderNode[];
  edges: BuilderEdge[];
  selectedNodeId: string;
}

interface BuilderValidationIssue {
  key: string;
  title: string;
  detail: string;
}

interface SandboxTranscriptEntry {
  id?: string;
  speaker: "caller" | "agent" | "system";
  text: string;
  at?: string;
}

interface WorkflowSandboxTelephonyRoute {
  id: string;
  phoneNumberId: string;
  phoneNumber: string;
  friendlyName: string;
  workflowLabel: string;
  publishedVersionId: string;
  connectionId: string;
  connectionLabel: string;
  ownershipMode: string;
  provider: string;
  recordingSummary: string;
}

interface WorkflowSandboxRuntimeDisplay {
  label: string;
  runtimeProfile: RuntimeProfileId;
  isPremiumRealtime: boolean;
  voiceLabel: string;
  modelId?: string;
}

interface VoiceLibraryState {
  voices: TenantVoiceLibraryVoice[];
  loading: boolean;
  error: string | null;
}

type ToolInspectorPatch = Partial<ToolNodeConfig> & {
  toolId?: string;
  clearConnection?: boolean;
  request?: ToolRequestConfig | undefined;
};

const nodeTypes = {
  builderNode: BuilderNodeCard,
};

const queueOptions: QueueOption[] = [
  {
    queueId: "support-ops",
    queueName: "Support operations",
    fallbackMode: "callback",
  },
  {
    queueId: "billing-ops",
    queueName: "Billing managers",
    fallbackMode: "ticket",
  },
  {
    queueId: "after-hours",
    queueName: "After hours callback",
    fallbackMode: "voicemail",
  },
];

const defaultQueueOption = queueOptions[0]!;
const workflowId = "workflow-inbound-support-triage";
const environment = "production";
const draftSandboxTelephonyProvider: TelephonyProvider = "browser-webrtc";
const temporaryWorkflowBudgetPolicy: RuntimeManifestPreview["budget"] = {
  monthlyCapUsd: 80,
  currentSpendUsd: 0,
  projectedCostPerMinuteUsd: 0.18,
  blockOnLimit: true,
};

function comparePublishedWorkflowVersions(a: PublishedWorkflowVersion, b: PublishedWorkflowVersion) {
  const workflowOrder = a.manifestPreview.workflowId.localeCompare(b.manifestPreview.workflowId);

  if (workflowOrder !== 0) {
    return workflowOrder;
  }

  return a.version - b.version;
}

const specialistTemplatesStorageKey = "zara.web.specialist-templates.v1";
const runtimeProfileOptions: Array<{ value: RuntimeProfileId; label: string }> = [
  { value: "cost-optimized", label: "Cost optimized" },
  { value: "balanced", label: "Balanced" },
  { value: "premium-realtime", label: "Premium realtime" },
];
const textModelProviderOptions: Array<{ value: TextModelProviderId; label: string; badge: string }> = [
  { value: "openai", label: "OpenAI", badge: "OpenAI" },
  { value: "google-gemini", label: "Google Gemini", badge: "Gemini" },
];
const textModelPresets: Record<TextModelProviderId, string[]> = {
  openai: ["gpt-4.1-mini", "gpt-4.1"],
  "google-gemini": ["gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-3.1-pro-preview"],
};
const realtimeProviderOptions: Array<{ value: RealtimeProviderId; label: string }> = [
  { value: "openai-realtime", label: "OpenAI Realtime" },
  { value: "gemini-live", label: "Google Gemini Live" },
];
const realtimeModelPresets: Record<RealtimeProviderId, string[]> = {
  "openai-realtime": ["gpt-realtime"],
  "gemini-live": ["gemini-3.1-flash-live-preview"],
};
const geminiLiveVoiceDescriptions: Record<GeminiLiveVoiceName, string> = {
  Zephyr: "Bright",
  Puck: "Upbeat",
  Charon: "Informative",
  Kore: "Firm",
  Fenrir: "Excitable",
  Leda: "Youthful",
  Orus: "Firm",
  Aoede: "Breezy",
  Callirrhoe: "Easy-going",
  Autonoe: "Bright",
  Enceladus: "Breathy",
  Iapetus: "Clear",
  Umbriel: "Easy-going",
  Algieba: "Smooth",
  Despina: "Smooth",
  Erinome: "Clear",
  Algenib: "Gravelly",
  Rasalgethi: "Informative",
  Laomedeia: "Upbeat",
  Achernar: "Soft",
  Alnilam: "Firm",
  Schedar: "Even",
  Gacrux: "Mature",
  Pulcherrima: "Forward",
  Achird: "Friendly",
  Zubenelgenubi: "Casual",
  Vindemiatrix: "Gentle",
  Sadachbia: "Lively",
  Sadaltager: "Knowledgeable",
  Sulafat: "Warm",
};
const realtimeVoiceOptions: Record<RealtimeProviderId, Array<{ value: string; label: string }>> = {
  "openai-realtime": openAiRealtimeVoices.map((voice) => ({ value: voice, label: voice })),
  "gemini-live": geminiLiveVoiceNames.map((voiceName) => ({
    value: voiceName,
    label: `${voiceName} - ${geminiLiveVoiceDescriptions[voiceName]}`,
  })),
};
const languageOptions = [
  { value: "en", label: "English" },
  { value: "fr", label: "French" },
  { value: "es", label: "Spanish" },
  { value: "de", label: "German" },
  { value: "pt", label: "Portuguese" },
  { value: "ar", label: "Arabic" },
] as const;
const defaultSpecialistTemplateCreatedAt = "2026-05-20T00:00:00.000Z";

const initialNodes: BuilderNode[] = [createEntryBuilderNode()];
const initialEdges: BuilderEdge[] = [];

function createEntryBuilderNode(): BuilderNode {
  return {
    id: "entry",
    type: "builderNode",
    position: { x: 0, y: 220 },
    data: {
      kind: "entry",
      label: "Inbound call",
      badge: "Support line",
      subtitle: "Production tenant",
      config: { channel: "phone" },
    },
  };
}

interface WorkflowBuilderInitialState {
  currentWorkflowId: string;
  edges: BuilderEdge[];
  nodes: BuilderNode[];
  publishedVersions: PublishedWorkflowVersion[];
  selectedNodeId: string;
  selectedWorkflowVersionId: string;
  workflowRuntimeProfile: RuntimeProfileId;
  workflowTitle: string;
}

interface WorkflowBuilderTelephonyResourceState {
  error: string | null;
  key: string;
  loading: boolean;
  state: TelephonyStateResponse | null;
}

interface WorkflowBuilderScreenState {
  specialistTemplates: SpecialistRoleTemplate[];
  currentWorkflowId: string;
  selectedWorkflowVersionId: string;
  selectedNodeId: string;
  workflowTitle: string;
  selectedWorkspaceDraftId: string;
  workflowRuntimeProfile: RuntimeProfileId;
  publishDialogOpen: boolean;
  inspectorOpen: boolean;
  sandboxOpen: boolean;
  sandboxSource: "draft" | "phone-test";
  sandboxStarting: boolean;
  sandboxCallerTurn: string;
  sandboxTelephonyResource: WorkflowBuilderTelephonyResourceState;
  selectedSandboxRouteId: string;
  toastMessage: string | null;
  deletedCanvasSnapshot: DeletedCanvasSnapshot | null;
  publishedVersions: PublishedWorkflowVersion[];
}

type WorkflowBuilderStateSetter<T> = T | ((current: T) => T);

type WorkflowBuilderScreenAction =
  | { type: "set"; field: keyof WorkflowBuilderScreenState; value: unknown }
  | { type: "update"; field: keyof WorkflowBuilderScreenState; update: (current: unknown) => unknown };

function workflowBuilderScreenReducer(
  state: WorkflowBuilderScreenState,
  action: WorkflowBuilderScreenAction,
): WorkflowBuilderScreenState {
  if (action.type === "update") {
    return {
      ...state,
      [action.field]: action.update(state[action.field]),
    } as WorkflowBuilderScreenState;
  }

  return {
    ...state,
    [action.field]: action.value,
  } as WorkflowBuilderScreenState;
}

function createInitialWorkflowBuilderScreenState({
  activeWorkspaceId,
  initialBuilderState,
}: {
  activeWorkspaceId: string;
  initialBuilderState: WorkflowBuilderInitialState;
}): WorkflowBuilderScreenState {
  return {
    specialistTemplates: loadSpecialistRoleTemplatesForWorkspace(activeWorkspaceId),
    currentWorkflowId: initialBuilderState.currentWorkflowId,
    selectedWorkflowVersionId: initialBuilderState.selectedWorkflowVersionId,
    selectedNodeId: initialBuilderState.selectedNodeId,
    workflowTitle: initialBuilderState.workflowTitle,
    selectedWorkspaceDraftId: "",
    workflowRuntimeProfile: initialBuilderState.workflowRuntimeProfile,
    publishDialogOpen: false,
    inspectorOpen: true,
    sandboxOpen: false,
    sandboxSource: "draft",
    sandboxStarting: false,
    sandboxCallerTurn: "I need help with a billing charge on my account.",
    sandboxTelephonyResource: {
      error: null,
      key: "",
      loading: false,
      state: null,
    },
    selectedSandboxRouteId: "",
    toastMessage: null,
    deletedCanvasSnapshot: null,
    publishedVersions: initialBuilderState.publishedVersions,
  };
}

function createBlankWorkflowBuilderState(publishedVersions: PublishedWorkflowVersion[] = []): WorkflowBuilderInitialState {
  return {
    currentWorkflowId: workflowId,
    edges: initialEdges,
    nodes: initialNodes,
    publishedVersions,
    selectedNodeId: "entry",
    selectedWorkflowVersionId: "__draft__",
    workflowRuntimeProfile: "cost-optimized",
    workflowTitle: "",
  };
}

function createWorkflowBuilderInitialState(organizationId: string, activeWorkspaceId: string): WorkflowBuilderInitialState {
  const publishedVersions = loadPublishedWorkflowVersionsForWorkspace({ tenantId: organizationId, workspaceId: activeWorkspaceId });
  const mostRecentPublishedVersion = getMostRecentPublishedWorkflowVersion(publishedVersions);

  if (mostRecentPublishedVersion === undefined) {
    return createBlankWorkflowBuilderState(publishedVersions);
  }

  return createWorkflowBuilderStateFromPublishedVersion(mostRecentPublishedVersion, publishedVersions);
}

function createWorkflowBuilderStateFromPublishedVersion(
  version: PublishedWorkflowVersion,
  publishedVersions: PublishedWorkflowVersion[],
): WorkflowBuilderInitialState {
  const canvas = toBuilderCanvas(version.graph);

  return {
    currentWorkflowId: version.manifestPreview.workflowId,
    edges: canvas.edges,
    nodes: canvas.nodes,
    publishedVersions,
    selectedNodeId: canvas.selectedNodeId,
    selectedWorkflowVersionId: version.id,
    workflowRuntimeProfile: version.manifestPreview.runtimeProfile,
    workflowTitle: version.graph.name,
  };
}

function getMostRecentPublishedWorkflowVersion(versions: PublishedWorkflowVersion[]): PublishedWorkflowVersion | undefined {
  let mostRecentVersion: PublishedWorkflowVersion | undefined;

  for (const version of versions) {
    if (mostRecentVersion === undefined || isPublishedWorkflowVersionNewer(version, mostRecentVersion)) {
      mostRecentVersion = version;
    }
  }

  return mostRecentVersion;
}

function isPublishedWorkflowVersionNewer(left: PublishedWorkflowVersion, right: PublishedWorkflowVersion) {
  const createdAtOrder = left.createdAt.localeCompare(right.createdAt);

  if (createdAtOrder !== 0) {
    return createdAtOrder > 0;
  }

  if (left.version !== right.version) {
    return left.version > right.version;
  }

  return left.id.localeCompare(right.id) > 0;
}

function getBuilderValidationIssues(
  errors: RuntimeManifestPreview["validation"]["errors"],
  entryRoleId: string | undefined,
  nodes: BuilderNode[],
): BuilderValidationIssue[] {
  const nodeLabelById = new Map(nodes.map((node) => [node.id, node.data.label]));
  const unreachableNodeLabels: string[] = [];
  const issues: BuilderValidationIssue[] = [];

  for (const error of errors) {
    if (error.code !== "workflow.unreachable_node" || error.nodeId === undefined) {
      continue;
    }

    unreachableNodeLabels.push(nodeLabelById.get(error.nodeId) ?? error.nodeId);
  }

  if (unreachableNodeLabels.length > 0) {
    issues.push({
      key: "workflow.unreachable_node-group",
      title: "Reconnect or remove disconnected nodes",
      detail:
        unreachableNodeLabels.length === 1
          ? `${unreachableNodeLabels[0]} is no longer reachable from the entry path.`
          : `${unreachableNodeLabels.join(", ")} are no longer reachable from the entry path.`,
    });
  }

  for (const error of errors) {
    if (error.code === "workflow.unreachable_node") {
      continue;
    }

    issues.push({
        key: `${error.code}-${error.nodeId ?? error.edgeId ?? error.message}`,
        title: formatValidationTitle(error.code),
        detail:
          formatValidationDetail(error.code, error.suggestion, error.nodeId, error.edgeId, nodeLabelById) ??
          "Review this step before publishing or opening the sandbox.",
      });
  }

  if (entryRoleId === undefined && errors.every((error) => error.code !== "workflow.missing_entry")) {
    issues.unshift({
      key: "workflow.entry-agent-missing",
      title: "Connect the entry point to an agent",
      detail: "Calls need a first agent after the entry node before this workflow can run or publish.",
    });
  }

  return issues;
}

interface WorkflowBuilderScreenProps {
  activeWorkspaceId: string;
  actorUserId?: string;
  activeTenantRole?: TenantRole;
  organizationId?: string;
  sandboxWorkspaceAccessReady?: boolean;
  workspaces: Workspace[];
}

export function WorkflowBuilderScreen(props: WorkflowBuilderScreenProps) {
  const model = useWorkflowBuilderScreenModel(props);

  return <WorkflowBuilderScreenView model={model} />;
}

function useWorkflowBuilderScreenModel({
  activeWorkspaceId,
  activeTenantRole = "builder",
  actorUserId,
  organizationId,
  sandboxWorkspaceAccessReady = true,
  workspaces,
}: WorkflowBuilderScreenProps) {
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const resolvedOrganizationId = organizationId ?? activeWorkspace?.tenantId ?? tenantId;
  const resolvedActorUserId = actorUserId ?? activeWorkspace?.createdBy ?? "user-ops-lead";
  const initialBuilderState = useMemo(
    () => createWorkflowBuilderInitialState(resolvedOrganizationId, activeWorkspaceId),
    [activeWorkspaceId, resolvedOrganizationId],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<BuilderNode>(initialBuilderState.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<BuilderEdge>(initialBuilderState.edges);
  const [integrationConnections, setIntegrationConnections] = useState<IntegrationConnection[]>([]);
  const [toolGrants, setToolGrants] = useState<ToolGrant[]>([]);
  const [toolCatalogItems, setToolCatalogItems] = useState<ToolCatalogItem[]>([]);
  const [voiceLibraryState, setVoiceLibraryState] = useState<VoiceLibraryState>({
    voices: [],
    loading: true,
    error: null,
  });
  const [publishErrorMessage, setPublishErrorMessage] = useState<string | null>(null);
  const [publishSubmitting, setPublishSubmitting] = useState(false);
  const [screenState, dispatch] = useReducer(
    workflowBuilderScreenReducer,
    {
      activeWorkspaceId,
      initialBuilderState,
    },
    createInitialWorkflowBuilderScreenState,
  );
  const {
    specialistTemplates,
    currentWorkflowId,
    selectedWorkflowVersionId,
    selectedNodeId,
    workflowTitle,
    selectedWorkspaceDraftId,
    workflowRuntimeProfile,
    publishDialogOpen,
    inspectorOpen,
    sandboxOpen,
    sandboxSource,
    sandboxStarting,
    sandboxCallerTurn,
    sandboxTelephonyResource,
    selectedSandboxRouteId,
    toastMessage,
    deletedCanvasSnapshot,
    publishedVersions,
  } = screenState;
  const setWorkflowBuilderField = <Field extends keyof WorkflowBuilderScreenState>(
    field: Field,
    value: WorkflowBuilderStateSetter<WorkflowBuilderScreenState[Field]>,
  ) => {
    if (typeof value === "function") {
      dispatch({
        type: "update",
        field,
        update: (current) =>
          (value as (currentValue: WorkflowBuilderScreenState[Field]) => WorkflowBuilderScreenState[Field])(
            current as WorkflowBuilderScreenState[Field],
          ),
      });
      return;
    }

    dispatch({ type: "set", field, value });
  };
  const setSpecialistTemplates = (value: WorkflowBuilderStateSetter<SpecialistRoleTemplate[]>) => setWorkflowBuilderField("specialistTemplates", value);
  const setCurrentWorkflowId = (value: string) => setWorkflowBuilderField("currentWorkflowId", value);
  const setSelectedWorkflowVersionId = (value: string) => setWorkflowBuilderField("selectedWorkflowVersionId", value);
  const setSelectedNodeId = (value: WorkflowBuilderStateSetter<string>) => setWorkflowBuilderField("selectedNodeId", value);
  const setWorkflowTitle = (value: string) => setWorkflowBuilderField("workflowTitle", value);
  const setSelectedWorkspaceId = (value: string) => setWorkflowBuilderField("selectedWorkspaceDraftId", value);
  const setWorkflowRuntimeProfile = (value: RuntimeProfileId) => setWorkflowBuilderField("workflowRuntimeProfile", value);
  const setPublishDialogOpen = (value: boolean) => setWorkflowBuilderField("publishDialogOpen", value);
  const setInspectorOpen = (value: boolean) => setWorkflowBuilderField("inspectorOpen", value);
  const setSandboxOpen = (value: boolean) => setWorkflowBuilderField("sandboxOpen", value);
  const setSandboxSource = (value: "draft" | "phone-test") => setWorkflowBuilderField("sandboxSource", value);
  const setSandboxStarting = (value: boolean) => setWorkflowBuilderField("sandboxStarting", value);
  const setSandboxCallerTurn = (value: string) => setWorkflowBuilderField("sandboxCallerTurn", value);
  const setSandboxTelephonyResource = (value: WorkflowBuilderStateSetter<WorkflowBuilderTelephonyResourceState>) => setWorkflowBuilderField("sandboxTelephonyResource", value);
  const setSelectedSandboxRouteId = (value: string) => setWorkflowBuilderField("selectedSandboxRouteId", value);
  const setToastMessage = (value: string | null) => setWorkflowBuilderField("toastMessage", value);
  const setDeletedCanvasSnapshot = (value: DeletedCanvasSnapshot | null) => setWorkflowBuilderField("deletedCanvasSnapshot", value);
  const setPublishedVersions = (value: PublishedWorkflowVersion[]) => setWorkflowBuilderField("publishedVersions", value);
  const selectedWorkspaceId = workspaces.some((workspace) => workspace.id === selectedWorkspaceDraftId)
    ? selectedWorkspaceDraftId
    : activeWorkspaceId;
  const sandboxTelephonyRequestKey = sandboxOpen && publishedVersions.length > 0
    ? `${resolvedOrganizationId}:${activeWorkspaceId}:${publishedVersions.length}`
    : "";
  if (sandboxTelephonyResource.key !== sandboxTelephonyRequestKey) {
    setSandboxTelephonyResource({
      error: null,
      key: sandboxTelephonyRequestKey,
      loading: sandboxTelephonyRequestKey.length > 0,
      state: null,
    });
  }
  const sandboxTelephonyState =
    sandboxTelephonyResource.key === sandboxTelephonyRequestKey ? sandboxTelephonyResource.state : null;
  const sandboxTelephonyLoading =
    sandboxTelephonyResource.key === sandboxTelephonyRequestKey && sandboxTelephonyResource.loading;
  const sandboxTelephonyError =
    sandboxTelephonyResource.key === sandboxTelephonyRequestKey ? sandboxTelephonyResource.error : null;
  const liveSandbox = useLiveSandboxSession({
    organizationId: resolvedOrganizationId,
    actorUserId: resolvedActorUserId,
  });

  useEffect(() => {
    let cancelled = false;

    setVoiceLibraryState((current) => ({
      ...current,
      loading: true,
      error: null,
    }));

    void Promise.all([
      fetchIntegrationConnections(resolvedOrganizationId).catch(() => []),
      fetchToolGrants(resolvedOrganizationId, activeWorkspaceId).catch(() => []),
      fetchIntegrationCatalog(resolvedOrganizationId)
        .then(createWorkflowToolCatalog)
        .catch(() => []),
      fetchTenantVoices(resolvedOrganizationId)
        .then((voices) => ({ voices, error: null }))
        .catch((error: unknown) => ({
          voices: [] as TenantVoiceLibraryVoice[],
          error: error instanceof Error ? error.message : "Voice library could not be loaded.",
        })),
    ]).then(([connections, grants, catalogItems, voiceLibrary]) => {
      if (!cancelled) {
        setIntegrationConnections(connections);
        setToolGrants(grants);
        setToolCatalogItems(catalogItems);
        setVoiceLibraryState({
          voices: voiceLibrary.voices,
          loading: false,
          error: voiceLibrary.error,
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, resolvedOrganizationId]);

  const workflowGraph = useMemo(
    () => toWorkflowGraph(currentWorkflowId, nodes, edges, workflowTitle),
    [currentWorkflowId, edges, nodes, workflowTitle],
  );
  const liveCanvas = useMemo(
    () =>
      decorateLiveWorkflowCanvas({
        nodes,
        edges,
        liveEvents: liveSandbox.events,
        liveStatus: liveSandbox.status,
      }),
    [edges, liveSandbox.events, liveSandbox.status, nodes],
  );
  const workflowRuntime = useMemo(
    () => deriveRuntimeFromProfile(workflowRuntimeProfile),
    [workflowRuntimeProfile],
  );
  const validation = useMemo(() => validateWorkflowGraph(workflowGraph), [workflowGraph]);
  const runtimePreview = useMemo(
    () =>
      buildRuntimeManifestPreview({
        tenantId: resolvedOrganizationId,
        environment,
        workflowId: currentWorkflowId,
        graph: workflowGraph,
        runtime: workflowRuntime,
        runtimeProfile: workflowRuntimeProfile,
        telephonyProvider: draftSandboxTelephonyProvider,
        memory: {
          mode: "scoped",
          retrievalScopes: ["session", "caller", "account"],
          approvalRequired: true,
        },
        budget: temporaryWorkflowBudgetPolicy,
      }),
    [currentWorkflowId, resolvedOrganizationId, workflowGraph, workflowRuntime, workflowRuntimeProfile],
  );
  const canCompileDraftSandboxManifest = validation.ok && runtimePreview.entryRoleId !== undefined;
  const draftSandboxManifest = useMemo(
    () =>
      canCompileDraftSandboxManifest
        ? compileDraftSandboxRuntimeManifest({
            workflowId: currentWorkflowId,
            tenantId: resolvedOrganizationId,
            workspaceId: activeWorkspaceId,
            environment,
            createdBy: resolvedActorUserId,
            graph: workflowGraph,
            runtime: workflowRuntime,
            runtimeProfile: workflowRuntimeProfile,
            memory: runtimePreview.memory,
            budget: runtimePreview.budget,
          })
        : null,
    [
      activeWorkspaceId,
      canCompileDraftSandboxManifest,
      currentWorkflowId,
      resolvedActorUserId,
      resolvedOrganizationId,
      runtimePreview.budget,
      runtimePreview.memory,
      workflowGraph,
      workflowRuntime,
      workflowRuntimeProfile,
    ],
  );
  const sandboxRuntimeDisplay = useMemo(
    () =>
      resolveWorkflowSandboxRuntimeDisplay({
        manifest: draftSandboxManifest,
        runtimePreview,
      }),
    [draftSandboxManifest, runtimePreview],
  );
  const entryAgentName = useMemo(
    () => nodes.find((node) => node.data.kind === "agent" && node.data.role !== undefined)?.data.role?.name ?? "Draft agent",
    [nodes],
  );
  const workbench = useMemo(
    () =>
      resolveWorkflowBuilderWorkbench({
        nodes,
        edges,
        selectedNodeId,
      }),
    [edges, nodes, selectedNodeId],
  );
  const selectedNode = workbench.selectedNode;
  const agentRouteTargetOptions = useMemo(
    () =>
      selectedNode?.data.kind === "agent"
        ? buildAgentRouteTargetOptions(nodes, selectedNode.id)
        : [],
    [nodes, selectedNode],
  );
  const agentRouteFallbackOptions = useMemo(
    () =>
      selectedNode?.data.kind === "agent"
        ? buildAgentRouteFallbackOptions({
            nodes,
            sourceAgentId: selectedNode.id,
            sourceAgentName: selectedNode.data.role?.name ?? selectedNode.data.label,
          })
        : [],
    [nodes, selectedNode],
  );
  const routerAgentRouteTargetOptions = useMemo(
    () =>
      buildAgentRouteTargetOptions(
        nodes,
        selectedNode?.data.kind === "agent" ? selectedNode.id : "",
      ),
    [nodes, selectedNode],
  );
  const graphValidationIssues = useMemo(
    () => getBuilderValidationIssues(validation.errors, runtimePreview.entryRoleId, nodes),
    [nodes, runtimePreview.entryRoleId, validation.errors],
  );
  const workflowTitleValid = workflowTitle.trim().length > 0;
  const publishNameConflicts = useMemo(
    () =>
      workflowTitleValid
        ? publishedVersions.filter(
            (version) =>
              version.workspaceId === selectedWorkspaceId &&
              normalizeWorkflowName(version.graph.name) === normalizeWorkflowName(workflowTitle),
          )
        : [],
    [publishedVersions, selectedWorkspaceId, workflowTitle, workflowTitleValid],
  );
  const publishNameConflict = publishNameConflicts[0] ?? null;
  const validationIssues = useMemo<BuilderValidationIssue[]>(
    () =>
      workflowTitleValid
        ? graphValidationIssues
        : [
            {
              key: "workflow.name-required",
              title: "Name this workflow",
              detail: "Workflow publishing needs a saved name before the runtime manifest can be created.",
            },
            ...graphValidationIssues,
          ],
    [graphValidationIssues, workflowTitleValid],
  );
  const workflowGraphActionDisabled = graphValidationIssues.length > 0;
  const publishSubmitDisabled = validationIssues.length > 0 || publishSubmitting;
  const sandboxTelephonyRoutes = useMemo(
    () =>
      buildWorkflowSandboxTelephonyRoutes({
        state: sandboxTelephonyState,
        workspaceId: activeWorkspaceId,
        versions: publishedVersions,
      }),
    [activeWorkspaceId, publishedVersions, sandboxTelephonyState],
  );
  const effectiveSelectedSandboxRouteId = sandboxTelephonyRoutes.some((route) => route.id === selectedSandboxRouteId)
    ? selectedSandboxRouteId
    : sandboxTelephonyRoutes[0]?.id ?? "";
  const effectiveSandboxSource = sandboxSource;
  const specialistOptions = useMemo(
    () => {
      const options: Array<{ id: string; name: string }> = [];

      for (const node of nodes) {
        if (node.data.kind === "agent" && node.data.role !== undefined) {
          options.push({
            id: node.id,
            name: node.data.role.name,
          });
        }
      }

      return options;
    },
    [nodes],
  );
  const nodeIds = useMemo(() => nodes.map((node) => node.id), [nodes]);
  const selectedSourceKind = selectedNode?.data.kind ?? "entry";
  const selectedNodeAllowsAgent = workbench.actions.addAgent;
  const selectedNodeAllowsRouterAgent = selectedNodeAllowsAgent;
  const selectedNodeAllowsTool = workbench.actions.addTool;
  const selectedNodeAllowsEscalation = workbench.actions.addEscalation;
  const selectedNodeAllowsExit = workbench.actions.addExit;
  const selectedNodeAllowsDelete = workbench.actions.deleteSelected;
  const visibleToastMessage = toastMessage ?? liveSandbox.errorNotice?.message ?? null;
  const relationshipRepairAvailable = useMemo(
    () => canRepairBuilderRelationships(nodes, edges, validation.errors),
    [edges, nodes, validation.errors],
  );

  useEffect(() => {
    if (sandboxTelephonyRequestKey.length === 0) {
      return undefined;
    }

    let cancelled = false;

    void fetchTelephonyState(resolvedOrganizationId)
      .then((nextState) => {
        if (!cancelled) {
          setSandboxTelephonyResource((current) =>
            current.key === sandboxTelephonyRequestKey
              ? {
                  error: null,
                  key: sandboxTelephonyRequestKey,
                  loading: false,
                  state: nextState,
                }
              : current,
          );
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSandboxTelephonyResource((current) =>
            current.key === sandboxTelephonyRequestKey
              ? {
                  error: error instanceof Error ? error.message : "Telephony routes could not be loaded.",
                  key: sandboxTelephonyRequestKey,
                  loading: false,
                  state: null,
                }
              : current,
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [resolvedOrganizationId, sandboxTelephonyRequestKey]);

  useEffect(() => {
    if (toastMessage === null) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setToastMessage(null), 2600);

    return () => window.clearTimeout(timeoutId);
  }, [toastMessage]);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
  }, []);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (connection.source === null || connection.target === null) {
        return;
      }

      setDeletedCanvasSnapshot(null);
      setEdges((currentEdges) => {
        const decision = getBuilderConnectionDecision(nodes, currentEdges, connection);

        if (decision.kind === null) {
          showToast(decision.message);
          return currentEdges;
        }

        return addEdge(
          buildBuilderEdge({
            connection,
            id: buildEdgeId(connection.source!, connection.target!, currentEdges),
            kind: decision.kind,
            sourceHandleRole: decision.sourceHandleRole,
            targetHandleRole: decision.targetHandleRole,
            sourceNode: nodes.find((node) => node.id === connection.source),
          }),
          currentEdges,
        );
      });
    },
    [nodes, setEdges, showToast],
  );

  const onReconnect = useCallback(
    (previousEdge: BuilderEdge, connection: Connection) => {
      if (connection.source === null || connection.target === null) {
        return;
      }

      setDeletedCanvasSnapshot(null);
      setEdges((currentEdges) => {
        const comparableEdges = currentEdges.filter((edge) => edge.id !== previousEdge.id);
        const decision = getBuilderConnectionDecision(nodes, comparableEdges, connection);

        if (decision.kind === null) {
          showToast(decision.message);
          return currentEdges;
        }

        const updatedEdges = reconnectEdge(previousEdge, connection, currentEdges, { shouldReplaceId: false });

        return updatedEdges.map((edge) =>
          edge.id === previousEdge.id
            ? applyBuilderEdgeKind({
                edge: applyBuilderEdgeHandleRoles(edge, decision.sourceHandleRole, decision.targetHandleRole),
                kind: decision.kind,
                sourceNode: nodes.find((node) => node.id === connection.source),
                preserveLabel: previousEdge.data?.kind !== "return",
              })
            : edge,
        );
      });
    },
    [nodes, setEdges, showToast],
  );

  const appendLinkedNode = useCallback(
    (nextNode: BuilderNode, label?: string, afterLink?: (edges: BuilderEdge[]) => BuilderEdge[]) => {
      const sourceId =
        selectedNodeId !== undefined && nodes.some((node) => node.id === selectedNodeId)
          ? selectedNodeId
          : "entry";
      const nextNodes = [...nodes, nextNode];

      setDeletedCanvasSnapshot(null);
      setNodes((currentNodes) => [...currentNodes, nextNode]);
      setEdges((currentEdges) => {
        let nextEdges = currentEdges;

        if (
          sourceId !== nextNode.id &&
          !currentEdges.some((edge) => edge.source === sourceId && edge.target === nextNode.id)
        ) {
          const decision = getBuilderPolicyDecision({
            nodes: nextNodes,
            edges: currentEdges,
            sourceId,
            targetId: nextNode.id,
            requestedEdgeKind: "flow",
          });

          if (decision.kind === null) {
            showToast(decision.message);
          } else {
            nextEdges = [
              ...currentEdges,
              applyBuilderEdgeHandleRoles(
                {
                  id: buildEdgeId(sourceId, nextNode.id, currentEdges),
                  source: sourceId,
                  target: nextNode.id,
                  ...(label !== undefined ? { label } : {}),
                },
                decision.sourceHandleRole,
                decision.targetHandleRole,
              ),
            ];
          }
        }

        return afterLink !== undefined ? afterLink(nextEdges) : nextEdges;
      });
      setSelectedNodeId(nextNode.id);
      setInspectorOpen(true);
    },
    [nodes, selectedNodeId, setEdges, setNodes, showToast],
  );

  const addAgent = useCallback(() => {
    if (!canCreateBuilderRelationshipFromKind(selectedSourceKind, "agent")) {
      showToast("Select a node that can hand off to another agent.");
      return;
    }

    const agentNumber = getNextBuilderNodeNumber(nodeIds, "agent-specialist-");
    const id = `agent-specialist-${agentNumber}`;

    appendLinkedNode(
      createBuilderAgentNode({
        id,
        label: "New agent",
        position: { x: 300 + agentNumber * 96, y: 520 },
        role: {
          kind: "custom",
          name: "",
          businessName: "",
          instructions: "",
          defaultModelTier: "cheap",
          languagePolicy: {
            defaultLanguage: "en",
            supportedLanguages: ["en"],
            allowMidCallSwitching: false,
          },
          reusableSpecialist: false,
        },
      }),
    );
  }, [appendLinkedNode, nodeIds, selectedSourceKind, showToast]);

  const addRouterAgent = useCallback(() => {
    if (!canCreateBuilderRelationshipFromKind(selectedSourceKind, "agent")) {
      showToast("Select a node that can hand off to another agent.");
      return;
    }

    const agentNumber = getNextBuilderNodeNumber(nodeIds, "agent-router-");
    const id = `agent-router-${agentNumber}`;

    appendLinkedNode(
      createBuilderAgentNode({
        id,
        label: "Router agent",
        position: { x: 300 + agentNumber * 96, y: 520 },
        role: {
          kind: "custom",
          name: "",
          businessName: "",
          instructions: "",
          defaultModelTier: "cheap",
          languagePolicy: {
            defaultLanguage: "en",
            supportedLanguages: ["en"],
            allowMidCallSwitching: false,
          },
          reusableSpecialist: false,
          routePolicy: createDefaultAgentRoutePolicy(routerAgentRouteTargetOptions),
        },
      }),
    );
  }, [appendLinkedNode, nodeIds, routerAgentRouteTargetOptions, selectedSourceKind, showToast]);

  const addTool = useCallback(() => {
    if (
      selectedNode === undefined ||
      !canCreateBuilderRelationshipFromKind(selectedNode.data.kind, "tool")
    ) {
      showToast("Select an agent before adding a tool.");
      return;
    }

    const toolNumber = getNextBuilderNodeNumber(nodeIds, "tool-node-");
    const catalogItem = toolCatalogItems[(toolNumber - 1) % toolCatalogItems.length] ?? getDefaultToolCatalogItem(toolCatalogItems);

    if (catalogItem === undefined) {
      showToast("Tool catalog is still loading.");
      return;
    }

    const toolNode = createBuilderToolNode({
      id: `tool-node-${toolNumber}`,
      label: catalogItem.toolName,
      position: {
        x: selectedNode.position.x,
        y: Math.max(40, selectedNode.position.y - 160 - (toolNumber - 1) * 34),
      },
      toolId: catalogItem.toolId,
      tool: createToolConfigFromCatalogItem(catalogItem, integrationConnections),
    });

    setDeletedCanvasSnapshot(null);
    setNodes((currentNodes) => [...currentNodes, toolNode]);
    setEdges((currentEdges) => {
      let nextEdges = currentEdges;
      const callDecision = getBuilderPolicyDecision({
        nodes: [...nodes, toolNode],
        edges: currentEdges,
        sourceId: selectedNode.id,
        targetId: toolNode.id,
        requestedEdgeKind: "flow",
        strictHandleRoles: false,
      });

      if (callDecision.kind === null) {
        showToast(callDecision.message);
        return currentEdges;
      }

      const callEdgeExists = nextEdges.some(
        (edge) =>
          edge.source === selectedNode.id &&
          edge.target === toolNode.id &&
          edge.data?.kind !== "return",
      );
      const resultEdgeExists = nextEdges.some(
        (edge) =>
          edge.source === toolNode.id &&
          edge.target === selectedNode.id &&
          edge.data?.kind === "return",
      );

      if (!callEdgeExists) {
        nextEdges = [
          ...nextEdges,
          applyBuilderEdgeHandleRoles(
            {
              id: buildEdgeId(selectedNode.id, toolNode.id, nextEdges),
              source: selectedNode.id,
              target: toolNode.id,
              label: "tool",
            },
            callDecision.sourceHandleRole,
            callDecision.targetHandleRole,
          ),
        ];
      }

      const companionEdge = callDecision.autoCreateCompanionEdges[0];

      if (!resultEdgeExists && companionEdge !== undefined) {
        const companionSourceNode = companionEdge.source === "target" ? toolNode : selectedNode;
        const companionTargetNode = companionEdge.target === "target" ? toolNode : selectedNode;

        nextEdges = [
          ...nextEdges,
          applyBuilderEdgeKind({
            edge: applyBuilderEdgeHandleRoles(
              {
                id: buildEdgeId(companionSourceNode.id, companionTargetNode.id, nextEdges),
                source: companionSourceNode.id,
                target: companionTargetNode.id,
                ...(companionEdge.condition !== undefined ? { label: companionEdge.condition } : {}),
              },
              companionEdge.sourceHandleRole,
              companionEdge.targetHandleRole,
            ),
            kind: companionEdge.edgeKind,
            sourceNode: companionSourceNode,
            preserveLabel: false,
          }),
        ];
      }

      return nextEdges;
    });
    setSelectedNodeId(toolNode.id);
    setInspectorOpen(true);
  }, [integrationConnections, nodeIds, nodes, selectedNode, setEdges, setNodes, showToast, toolCatalogItems]);

  const addEscalation = useCallback(() => {
    if (!canCreateBuilderRelationshipFromKind(selectedSourceKind, "human-escalation")) {
      showToast("Select an agent before adding escalation.");
      return;
    }

    const escalationNumber = getNextBuilderNodeNumber(nodeIds, "human-escalation-");
    const queue = queueOptions[(escalationNumber - 1) % queueOptions.length] ?? defaultQueueOption;

    appendLinkedNode(
      createBuilderEscalationNode({
        id: `human-escalation-${escalationNumber}`,
        label: "Human escalation",
        position: { x: 1180, y: 420 + escalationNumber * 88 },
        escalation: {
          queueId: queue.queueId,
          queueName: queue.queueName,
          fallbackMode: queue.fallbackMode,
          fallbackMessage: "Offer a callback if no operator accepts inside the live queue window.",
        },
      }),
      "human",
    );
  }, [appendLinkedNode, nodeIds, selectedSourceKind, showToast]);

  const addExit = useCallback(() => {
    if (!canCreateBuilderRelationshipFromKind(selectedSourceKind, "end")) {
      showToast("Select an agent before adding an exit.");
      return;
    }

    const exitNumber = getNextBuilderNodeNumber(nodeIds, "end-node-");

    appendLinkedNode(
      createBuilderEndNode({
        id: `end-node-${exitNumber}`,
        label: `Exit ${exitNumber}`,
        position: { x: 940, y: 440 + exitNumber * 84 },
        end: {
          outcome: "resolved",
          closingMessage: "Close the workflow and end the call after this branch completes.",
        },
      }),
      "exit",
    );
  }, [appendLinkedNode, nodeIds, selectedSourceKind, showToast]);

  const deleteSelected = useCallback(() => {
    if (selectedNode === undefined || selectedNode.data.kind === "entry") {
      return;
    }

    setDeletedCanvasSnapshot({
      nodes,
      edges,
      selectedNodeId,
    });
    const graphAfterDelete = deleteWorkflowNode(workflowGraph, selectedNode.id);
    const remainingNodeIds = new Set(graphAfterDelete.nodes.map((node) => node.id));

    setNodes((currentNodes) => currentNodes.filter((node) => remainingNodeIds.has(node.id)));
    setEdges((currentEdges) =>
      currentEdges.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id),
    );
    setSelectedNodeId("entry");
    showToast(`${selectedNode.data.label} deleted. Undo is available.`);
  }, [edges, nodes, selectedNode, selectedNodeId, setEdges, setNodes, showToast, workflowGraph]);

  const undoDelete = useCallback(() => {
    if (deletedCanvasSnapshot === null) {
      return;
    }

    setNodes(deletedCanvasSnapshot.nodes);
    setEdges(deletedCanvasSnapshot.edges);
    setSelectedNodeId(deletedCanvasSnapshot.selectedNodeId);
    setInspectorOpen(true);
    setDeletedCanvasSnapshot(null);
    showToast("Deleted node restored.");
  }, [deletedCanvasSnapshot, setEdges, setNodes, showToast]);

  const clearCanvas = useCallback(() => {
    setNodes([createEntryBuilderNode()]);
    setEdges([]);
    setSelectedNodeId("entry");
    setDeletedCanvasSnapshot(null);
    setSandboxOpen(false);
    setSandboxSource("draft");
    setSandboxStarting(false);
    void liveSandbox.resetSession();
    showToast("Canvas reset to the entry point.");
  }, [liveSandbox, setEdges, setNodes, showToast]);

  const repairRelationships = useCallback(() => {
    const repairResult = repairBuilderRelationships(nodes, edges);

    if (repairResult.repairCount === 0) {
      showToast("No relationship repairs are available.");
      return;
    }

    setDeletedCanvasSnapshot(null);
    setNodes(repairResult.nodes);
    setEdges(repairResult.edges);
    setSelectedNodeId((currentNodeId) =>
      repairResult.nodes.some((node) => node.id === currentNodeId) ? currentNodeId : "entry",
    );
    setInspectorOpen(true);
    showToast(
      repairResult.repairCount === 1
        ? "One relationship repair applied."
        : `${repairResult.repairCount} relationship repairs applied.`,
    );
  }, [edges, nodes, setEdges, setNodes, showToast]);

  const loadPublishedWorkflow = useCallback((versionId: string) => {
    setSelectedWorkflowVersionId(versionId);

    if (versionId === "__draft__") {
      const blankState = createBlankWorkflowBuilderState(publishedVersions);

      setCurrentWorkflowId(blankState.currentWorkflowId);
      setWorkflowTitle(blankState.workflowTitle);
      setWorkflowRuntimeProfile(blankState.workflowRuntimeProfile);
      setNodes([createEntryBuilderNode()]);
      setEdges([]);
      setSelectedNodeId(blankState.selectedNodeId);
      setDeletedCanvasSnapshot(null);
      setInspectorOpen(true);
      setSandboxOpen(false);
      setSandboxSource("draft");
      showToast("Started a blank workflow.");
      return;
    }

    const version = publishedVersions.find((candidate) => candidate.id === versionId);

    if (version === undefined) {
      showToast("That workflow is no longer available in this workspace.");
      setSelectedWorkflowVersionId("__draft__");
      return;
    }

    const nextCanvas = toBuilderCanvas(version.graph);

    setCurrentWorkflowId(version.manifestPreview.workflowId);
    setWorkflowTitle(version.graph.name);
    setWorkflowRuntimeProfile(version.manifestPreview.runtimeProfile);
    setNodes(nextCanvas.nodes);
    setEdges(nextCanvas.edges);
    setSelectedNodeId(nextCanvas.selectedNodeId);
    setDeletedCanvasSnapshot(null);
    setInspectorOpen(true);
    setSandboxOpen(false);
    setSandboxSource("draft");
    showToast(`Loaded ${version.graph.name}.`);
  }, [publishedVersions, setEdges, setNodes, showToast]);

  const openPublishDialog = useCallback(() => {
    setSelectedWorkspaceId(activeWorkspaceId);
    setPublishErrorMessage(null);
    setPublishDialogOpen(true);
  }, [activeWorkspaceId]);

  const publishDraft = useCallback(() => {
    if (publishSubmitDisabled) {
      return;
    }

    const title = workflowTitle.trim();

    if (title.length === 0) {
      showToast("Name the workflow before publishing.");
      return;
    }

    const publishTarget = resolveWorkflowPublishTarget({
      currentWorkflowId,
      publishedVersions,
      selectedWorkspaceId,
      workflowTitle: title,
    });
    const publishWorkflowId = publishTarget.workflowId;
    const graph = toWorkflowGraph(publishWorkflowId, nodes, edges, title);
    setPublishSubmitting(true);
    setPublishErrorMessage(null);

    void publishTenantWorkflow({
      organizationId: resolvedOrganizationId,
      workflowId: publishWorkflowId,
      actorUserId: resolvedActorUserId,
      workspaceId: selectedWorkspaceId,
      environment,
      graph,
      existingVersions: publishTarget.existingVersions,
      runtime: workflowRuntime,
      runtimeProfile: workflowRuntimeProfile,
      telephonyProvider: draftSandboxTelephonyProvider,
      memory: runtimePreview.memory,
      budget: runtimePreview.budget,
    })
      .then(({ publishedVersion }) => {
        const nextPublishedVersions = [
          ...publishedVersions.filter(
            (version) =>
              version.id !== publishedVersion.id &&
              !publishTarget.replaceWorkflowIds.includes(version.manifestPreview.workflowId),
          ),
          publishedVersion,
        ].sort(comparePublishedWorkflowVersions);

        setCurrentWorkflowId(publishWorkflowId);
        setWorkflowTitle(title);
        setSelectedWorkflowVersionId(publishedVersion.id);
        setPublishedVersions(nextPublishedVersions);
        savePublishedWorkflowVersion(publishedVersion, { replaceWorkflowIds: publishTarget.replaceWorkflowIds });
        setPublishDialogOpen(false);
        showToast(publishTarget.mode === "overwrite" ? `Overwrote ${graph.name}.` : `Published ${graph.name}.`);
      })
      .catch((error: unknown) => {
        const message = getWorkflowPublishErrorMessage(error);

        setPublishErrorMessage(message);
        showToast(message);
      })
      .finally(() => {
        setPublishSubmitting(false);
      });
  }, [currentWorkflowId, edges, nodes, publishSubmitDisabled, publishedVersions, resolvedActorUserId, resolvedOrganizationId, runtimePreview.budget, runtimePreview.memory, selectedWorkspaceId, showToast, workflowRuntime, workflowRuntimeProfile, workflowTitle]);

  const openDraftSandbox = useCallback(() => {
    if (!sandboxWorkspaceAccessReady) {
      showToast("Workspace access is still being prepared. Try again in a moment.");
      return;
    }

    if (graphValidationIssues.length > 0) {
      showToast("Fix the validation items in the inspector before opening the sandbox.");
      return;
    }

    setSandboxOpen(true);
    setSandboxSource("draft");
    showToast("Draft sandbox ready.");
  }, [graphValidationIssues.length, sandboxWorkspaceAccessReady, showToast]);

  const startDraftSandbox = useCallback((mode: "typed" | "voice") => {
    if (!sandboxWorkspaceAccessReady) {
      showToast("Workspace access is still being prepared. Try again in a moment.");
      return;
    }

    if (draftSandboxManifest === null) {
      showToast("Validate the draft before starting the live sandbox.");
      return;
    }

    setSandboxSource("draft");
    setSandboxStarting(true);

    void liveSandbox
      .startSession({
        workspaceId: activeWorkspaceId,
        source: "draft",
        inputMode: mode,
        entryRoleId: draftSandboxManifest.entryRoleId,
        manifest: draftSandboxManifest,
      })
      .then((started) => {
        if (started) {
          showToast(mode === "voice" ? "Draft voice sandbox started." : "Typed draft run started.");
        }
      })
      .finally(() => {
        setSandboxStarting(false);
      });
  }, [activeWorkspaceId, draftSandboxManifest, liveSandbox, sandboxWorkspaceAccessReady, showToast]);

  const sendSandboxTurn = useCallback(() => {
    const callerText = sandboxCallerTurn.trim();

    if (callerText.length === 0 || liveSandbox.status !== "active") {
      return;
    }

    liveSandbox.sendTextTurn({
      transcript: callerText,
      callPhase: "discovery",
    });
    showToast("Caller turn sent through the draft.");
  }, [liveSandbox, sandboxCallerTurn, showToast]);

  const updateSelectedRole = useCallback(
    (patch: Partial<AgentRoleNodeConfig>) => {
      if (selectedNode?.data.kind !== "agent" || selectedNode.data.role === undefined) {
        return;
      }

      const currentRole = selectedNode.data.role;
      const nextRole = {
        ...currentRole,
        ...patch,
        languagePolicy: {
          ...currentRole.languagePolicy,
          ...(patch.languagePolicy ?? {}),
        },
      };

      setDeletedCanvasSnapshot(null);
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === selectedNode.id
            ? createBuilderAgentNode({
                id: node.id,
                label: nextRole.name || node.data.label,
                position: node.position,
                role: nextRole,
              })
            : node,
        ),
      );
    },
    [selectedNode, setNodes],
  );

  const applyTemplateToSelectedRole = useCallback(
    (templateId: string) => {
      if (selectedNode?.data.kind !== "agent" || templateId.length === 0) {
        return;
      }

      const template = specialistTemplates.find((candidate) => candidate.id === templateId);

      if (template === undefined) {
        return;
      }

      const nextRole = applySpecialistRoleTemplateForCurrentNode(template, selectedNode.data.role);

      setDeletedCanvasSnapshot(null);
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === selectedNode.id
            ? createBuilderAgentNode({
                id: node.id,
                label: nextRole.name || node.data.label,
                position: node.position,
                role: nextRole,
              })
            : node,
        ),
      );
      showToast(`${template.name} template applied.`);
    },
    [selectedNode, setNodes, showToast, specialistTemplates],
  );

  const saveSelectedSpecialistTemplate = useCallback(() => {
    if (selectedNode?.data.kind !== "agent" || selectedNode.data.role === undefined) {
      return;
    }

    const now = new Date().toISOString();
    const existingTemplate = specialistTemplates.find(
      (template) =>
        template.id === selectedNode.data.role?.specialistTemplateId ||
        template.name.trim().toLocaleLowerCase() === selectedNode.data.role?.name.trim().toLocaleLowerCase(),
    );
    const template =
      existingTemplate === undefined
        ? createSpecialistRoleTemplate({
            id: `specialist-template-${selectedNode.id}`,
            workspaceId: activeWorkspaceId,
            role: selectedNode.data.role,
            createdAt: now,
            existingTemplates: specialistTemplates,
          })
        : updateSpecialistRoleTemplate(existingTemplate, {
            role: selectedNode.data.role,
            updatedAt: now,
          });
    const nextRole = applySpecialistRoleTemplateForCurrentNode(template, selectedNode.data.role);

    setSpecialistTemplates((currentTemplates) => {
      const nextTemplates = currentTemplates.some((candidate) => candidate.id === template.id)
        ? currentTemplates.map((candidate) => (candidate.id === template.id ? template : candidate))
        : [...currentTemplates, template];

      saveSpecialistRoleTemplatesForWorkspace(activeWorkspaceId, nextTemplates);

      return nextTemplates;
    });
    setDeletedCanvasSnapshot(null);
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.id === selectedNode.id
          ? createBuilderAgentNode({
              id: node.id,
              label: nextRole.name || node.data.label,
              position: node.position,
              role: nextRole,
            })
          : node,
      ),
    );
    showToast(`${template.name} saved as a reusable specialist.`);
  }, [activeWorkspaceId, selectedNode, setNodes, showToast, specialistTemplates]);

  const updateSelectedTool = useCallback(
    (patch: ToolInspectorPatch) => {
      if (selectedNode?.data.kind !== "tool" || selectedNode.data.tool === undefined) {
        return;
      }

      const currentTool = selectedNode.data.tool;
      const { toolId: patchedToolId, clearConnection = false, request, ...toolPatch } = patch;
      const nextToolId =
        patchedToolId
        ?? selectedNode.data.toolId
        ?? getDefaultToolCatalogItem(toolCatalogItems)?.toolId
        ?? selectedNode.id;
      const nextTool: ToolNodeConfig = {
        ...currentTool,
        ...toolPatch,
        request: request ?? currentTool.request,
      };

      if (clearConnection) {
        delete nextTool.integrationConnectionId;
        delete nextTool.integrationLabel;
        nextTool.connectionStatus = "missing";
      }

      setDeletedCanvasSnapshot(null);
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === selectedNode.id
            ? createBuilderToolNode({
                id: node.id,
                label: nextTool.toolName || node.data.label,
                position: node.position,
                toolId: nextToolId,
                tool: nextTool,
              })
            : node,
        ),
      );
    },
    [selectedNode, setNodes, toolCatalogItems],
  );

  const updateSelectedEscalation = useCallback(
    (patch: Partial<HumanEscalationNodeConfig>) => {
      if (selectedNode?.data.kind !== "human-escalation" || selectedNode.data.escalation === undefined) {
        return;
      }

      const nextEscalation = {
        ...selectedNode.data.escalation,
        ...patch,
      };

      setDeletedCanvasSnapshot(null);
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === selectedNode.id
            ? createBuilderEscalationNode({
                id: node.id,
                label: node.data.label,
                position: node.position,
                escalation: nextEscalation,
              })
            : node,
        ),
      );
    },
    [selectedNode, setNodes],
  );

  const updateSelectedEnd = useCallback(
    (patch: Partial<EndNodeConfig>) => {
      if (selectedNode?.data.kind !== "end" || selectedNode.data.end === undefined) {
        return;
      }

      const nextEnd = {
        ...selectedNode.data.end,
        ...patch,
      };

      setDeletedCanvasSnapshot(null);
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === selectedNode.id
            ? createBuilderEndNode({
                id: node.id,
                label: node.data.label,
                position: node.position,
                end: nextEnd,
              })
            : node,
        ),
      );
    },
    [selectedNode, setNodes],
  );

  const updateVoiceLibraryVoice = useCallback((voice: TenantVoiceLibraryVoice) => {
    setVoiceLibraryState((current) => ({
      ...current,
      voices: [
        ...current.voices.filter((candidate) => candidate.id !== voice.id),
        voice,
      ],
    }));
  }, []);

  const closeSandbox = useCallback(() => {
    setSandboxOpen(false);
    setSandboxSource("draft");
    setSandboxStarting(false);
    showToast("Draft sandbox closed.");
  }, [showToast]);

  const builderGridClassName = [
    "workflow-builder-grid",
    inspectorOpen ? "workflow-builder-grid-inspector-open" : "",
    sandboxOpen ? "workflow-builder-grid-sandbox-open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    addAgent,
    addEscalation,
    addExit,
    addRouterAgent,
    addTool,
    applyTemplateToSelectedRole,
    builderGridClassName,
    clearCanvas,
    closeSandbox,
    deleteSelected,
    deletedCanvasSnapshot,
    effectiveSandboxSource,
    effectiveSelectedSandboxRouteId,
    entryAgentName,
    integrationConnections,
    toolGrants,
    inspectorOpen,
    actorUserId: resolvedActorUserId,
    actorRole: activeTenantRole,
    organizationId: resolvedOrganizationId,
    toolCatalogItems,
    voiceLibraryState,
    liveCanvas,
    liveSandbox,
    loadPublishedWorkflow,
    onConnect,
    onEdgesChange,
    onNodesChange,
    onReconnect,
    openDraftSandbox,
    openPublishDialog,
    publishErrorMessage,
    publishDialogOpen,
    publishedVersions,
    publishDraft,
    publishNameConflict,
    publishSubmitting,
    publishSubmitDisabled,
    relationshipRepairAvailable,
    repairRelationships,
    runtimePreview,
    sandboxCallerTurn,
    sandboxOpen,
    sandboxWorkspaceAccessReady,
    sandboxRuntimeDisplay,
    sandboxStarting,
    sandboxTelephonyError,
    sandboxTelephonyLoading,
    sandboxTelephonyRoutes,
    selectedNode,
    selectedNodeAllowsAgent,
    selectedNodeAllowsDelete,
    selectedNodeAllowsEscalation,
    selectedNodeAllowsExit,
    selectedNodeAllowsRouterAgent,
    selectedNodeAllowsTool,
    selectedWorkflowVersionId,
    selectedWorkspaceId,
    setInspectorOpen,
    setPublishDialogOpen,
    setSandboxCallerTurn,
    setSandboxSource,
    setSelectedNodeId,
    setSelectedSandboxRouteId,
    setSelectedWorkspaceId,
    setWorkflowRuntimeProfile,
    setWorkflowTitle,
    specialistOptions,
    specialistTemplates,
    startDraftSandbox,
    undoDelete,
    updateSelectedEnd,
    updateSelectedEscalation,
    updateSelectedRole,
    updateSelectedTool,
    updateVoiceLibraryVoice,
    agentRouteFallbackOptions,
    agentRouteTargetOptions,
    validationIssues,
    visibleToastMessage,
    workflowGraphActionDisabled,
    workflowRuntimeProfile,
    workflowTitle,
    workflowTitleValid,
    workspaces,
    saveSelectedSpecialistTemplate,
    sendSandboxTurn,
  };
}

type WorkflowBuilderScreenModel = ReturnType<typeof useWorkflowBuilderScreenModel>;

function WorkflowBuilderScreenView({ model }: { model: WorkflowBuilderScreenModel }) {
  return (
    <div className="workflow-page">
      <WorkflowBuilderToolbar model={model} />
      <WorkflowBuilderCanvasGrid model={model} />
      <WorkflowPublishDialog model={model} />
      {model.visibleToastMessage !== null ? (
        <output className="workflow-toast" aria-live="polite">
          {model.visibleToastMessage}
        </output>
      ) : null}
    </div>
  );
}

function WorkflowBuilderToolbar({ model }: { model: WorkflowBuilderScreenModel }) {
  const {
    addAgent,
    addEscalation,
    addExit,
    addRouterAgent,
    addTool,
    clearCanvas,
    deleteSelected,
    deletedCanvasSnapshot,
    openDraftSandbox,
    openPublishDialog,
    sandboxOpen,
    sandboxWorkspaceAccessReady,
    selectedNodeAllowsAgent,
    selectedNodeAllowsDelete,
    selectedNodeAllowsEscalation,
    selectedNodeAllowsExit,
    selectedNodeAllowsRouterAgent,
    selectedNodeAllowsTool,
    setWorkflowRuntimeProfile,
    undoDelete,
    validationIssues,
    workflowGraphActionDisabled,
    workflowRuntimeProfile,
    workflowTitle,
  } = model;

  return (
    <section className={["workflow-toolbar", sandboxOpen ? "workflow-toolbar-collapsed" : ""].filter(Boolean).join(" ")}>
      <div className="workflow-toolbox-panel" aria-label="Workflow builder toolbox">
        <div className="workflow-toolbox-header">
          <div className="workflow-toolbox-title" aria-label="Workflow">
            <span>Workflow</span>
            <strong>{workflowTitle.trim().length > 0 ? workflowTitle : "Untitled workflow"}</strong>
          </div>
          <output
            className={[
              "workflow-validation-chip",
              validationIssues.length === 0 ? "workflow-validation-chip-ok" : "workflow-validation-chip-error",
            ].join(" ")}
            aria-label="Workflow validation status"
          >
            {validationIssues.length === 0 ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            <span>{validationIssues.length === 0 ? "Ready" : `${validationIssues.length} issues`}</span>
          </output>
        </div>
        <label className="workflow-toolbox-runtime">
          <span>Runtime</span>
          <Select
            aria-label="Workflow runtime profile"
            value={workflowRuntimeProfile}
            onChange={(event) => setWorkflowRuntimeProfile(event.target.value as RuntimeProfileId)}
          >
            {runtimeProfileOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
        <div className="workflow-toolbox-section-label">Nodes</div>
        <div className="workflow-toolbox-grid">
          <WorkflowToolboxTile
            accent="teal"
            disabled={!selectedNodeAllowsAgent}
            icon={<Plus size={20} />}
            label="Agent"
            title={selectedNodeAllowsAgent ? undefined : "Select a node that can hand off to another agent"}
            onClick={addAgent}
          />
          <WorkflowToolboxTile
            accent="blue"
            disabled={!selectedNodeAllowsRouterAgent}
            icon={<Bot size={20} />}
            label="Router Agent"
            title={selectedNodeAllowsRouterAgent ? undefined : "Select a node that can hand off to another agent"}
            onClick={addRouterAgent}
          />
          <WorkflowToolboxTile
            accent="violet"
            disabled={!selectedNodeAllowsTool}
            icon={<KeyRound size={20} />}
            label="Tool"
            title={selectedNodeAllowsTool ? undefined : "Select an agent to add a tool"}
            onClick={addTool}
          />
          <WorkflowToolboxTile
            accent="amber"
            disabled={!selectedNodeAllowsEscalation}
            icon={<Headphones size={20} />}
            label="Escalation"
            title={selectedNodeAllowsEscalation ? undefined : "Select an agent to add escalation"}
            onClick={addEscalation}
          />
          <WorkflowToolboxTile
            accent="rose"
            disabled={!selectedNodeAllowsExit}
            icon={<PhoneOff size={20} />}
            label="Exit"
            title={selectedNodeAllowsExit ? undefined : "Select an agent to add an exit"}
            onClick={addExit}
          />
        </div>
        <div className="workflow-toolbox-section-label">Actions</div>
        <div className="workflow-toolbox-grid workflow-toolbox-grid-actions">
          <WorkflowToolboxTile accent="blue" icon={<Play size={20} />} label="Run in sandbox" disabled={workflowGraphActionDisabled || !sandboxWorkspaceAccessReady} title={sandboxWorkspaceAccessReady ? undefined : "Workspace access is still being prepared"} onClick={openDraftSandbox} />
          <WorkflowToolboxTile accent="violet" icon={<CheckCircle2 size={20} />} label="Publish" disabled={workflowGraphActionDisabled} onClick={openPublishDialog} />
          <WorkflowToolboxTile accent="slate" icon={<Trash2 size={20} />} label="Clear canvas" onClick={clearCanvas} />
          <WorkflowToolboxTile accent="rose" icon={<Trash2 size={20} />} label="Delete selected" disabled={!selectedNodeAllowsDelete} onClick={deleteSelected} />
          {deletedCanvasSnapshot !== null ? (
            <WorkflowToolboxTile accent="teal" icon={<RotateCcw size={20} />} label="Undo delete" onClick={undoDelete} />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function WorkflowToolboxTile({
  accent,
  disabled,
  icon,
  label,
  title,
  onClick,
}: {
  accent: "amber" | "blue" | "rose" | "slate" | "teal" | "violet";
  disabled?: boolean | undefined;
  icon: ReactNode;
  label: string;
  title?: string | undefined;
  onClick: () => void;
}) {
  return (
    <Button
      className="workflow-toolbox-tile"
      data-accent={accent}
      disabled={disabled}
      title={title}
      type="button"
      variant="ghost"
      onClick={onClick}
    >
      <span className="workflow-toolbox-tile-corner" aria-hidden="true">
        <RotateCcw size={11} />
      </span>
      <span className="workflow-toolbox-tile-icon">{icon}</span>
      <span className="workflow-toolbox-tile-label">{label}</span>
    </Button>
  );
}

function WorkflowBuilderCanvasGrid({ model }: { model: WorkflowBuilderScreenModel }) {
  return (
    <section className={model.builderGridClassName}>
      <WorkflowBuilderCanvas model={model} />
      {model.inspectorOpen ? <WorkflowBuilderInspector model={model} /> : null}
      {model.sandboxOpen ? <WorkflowSandboxDrawer
        callerTurn={model.sandboxCallerTurn}
        mode={model.liveSandbox.inputMode}
        routeOptions={model.sandboxTelephonyRoutes}
        sandboxSource={model.effectiveSandboxSource}
        selectedRouteId={model.effectiveSelectedSandboxRouteId}
        starting={model.sandboxStarting}
        telephonyError={model.sandboxTelephonyError}
        telephonyLoading={model.sandboxTelephonyLoading}
        liveEvents={model.liveSandbox.events}
        lastRoutingDecision={model.liveSandbox.lastRoutingDecision}
        microphoneState={model.liveSandbox.microphoneState}
        agentPlaybackActive={model.liveSandbox.agentPlaybackActive}
        voiceTurnCapturing={model.liveSandbox.voiceTurnCapturing}
        runtimeDisplay={model.sandboxRuntimeDisplay}
        runtimePreview={model.runtimePreview}
        status={model.liveSandbox.status}
        transcript={model.liveSandbox.transcript}
        entryAgentName={model.entryAgentName}
        workflowTitle={model.workflowTitle}
        onCallerTurnChange={model.setSandboxCallerTurn}
        onClose={model.closeSandbox}
        onEndSession={() => void model.liveSandbox.endSession()}
        onResetSession={() => void model.liveSandbox.resetSession()}
        onRouteChange={model.setSelectedSandboxRouteId}
        onSendTurn={model.sendSandboxTurn}
        onSourceChange={model.setSandboxSource}
        onStartDraft={model.startDraftSandbox}
      /> : null}
    </section>
  );
}

function WorkflowBuilderCanvas({ model }: { model: WorkflowBuilderScreenModel }) {
  return (
    <div className="workflow-canvas-shell surface-card">
      <ReactFlow
        nodes={model.liveCanvas.nodes}
        edges={model.liveCanvas.edges}
        nodeTypes={nodeTypes}
        onNodesChange={model.onNodesChange}
        onEdgesChange={model.onEdgesChange}
        onConnect={model.onConnect}
        onReconnect={model.onReconnect}
        connectionMode={ConnectionMode.Loose}
        onNodeClick={(_, node) => {
          model.setSelectedNodeId(node.id);
          model.setInspectorOpen(true);
        }}
        fitView
        minZoom={0.42}
        maxZoom={1.3}
        defaultEdgeOptions={{
          type: "smoothstep",
          animated: false,
        }}
      >
        <Background gap={22} size={1} />
        <MiniMap
          pannable
          zoomable
          nodeStrokeWidth={2}
          nodeColor={(node) => getBuilderNodeAccent(getMiniMapNodeKind(node)).minimap}
          nodeStrokeColor={(node) => getBuilderNodeAccent(getMiniMapNodeKind(node)).accent}
          style={{ width: 118, height: 76 }}
        />
        <Controls position="bottom-left" />
      </ReactFlow>
    </div>
  );
}

function WorkflowBuilderInspector({ model }: { model: WorkflowBuilderScreenModel }) {
  const { selectedNode, validationIssues } = model;

  return (
    <aside className="workflow-inspector surface-card" aria-label="Selected node inspector">
      <div className="workflow-panel-heading">
        <div>
          <div className="eyebrow-copy">Inspector</div>
          <div className="workflow-panel-title">{selectedNode?.data.label ?? "No node selected"}</div>
        </div>
        <button className="workflow-icon-button" type="button" aria-label="Close inspector" onClick={() => model.setInspectorOpen(false)}>
          <X size={16} />
        </button>
      </div>

      {selectedNode?.data.kind === "agent" && selectedNode.data.role !== undefined ? (
        <AgentRoleInspector
          actorUserId={model.actorUserId}
          actorRole={model.actorRole}
          organizationId={model.organizationId}
          role={selectedNode.data.role}
          routeFallbackOptions={model.agentRouteFallbackOptions}
          routeTargetOptions={model.agentRouteTargetOptions}
          templates={model.specialistTemplates}
          voiceLibraryState={model.voiceLibraryState}
          workflowRuntimeProfile={model.workflowRuntimeProfile}
          onApplyTemplate={model.applyTemplateToSelectedRole}
          onChange={model.updateSelectedRole}
          onSaveTemplate={model.saveSelectedSpecialistTemplate}
          onVoiceUpdated={model.updateVoiceLibraryVoice}
        />
      ) : null}
      {selectedNode?.data.kind === "tool" && selectedNode.data.tool !== undefined ? (
        <ToolInspector
          integrationConnections={model.integrationConnections}
          toolGrants={model.toolGrants}
          toolCatalogItems={model.toolCatalogItems}
          tool={selectedNode.data.tool}
          toolId={selectedNode.data.toolId ?? getDefaultToolCatalogItem(model.toolCatalogItems)?.toolId ?? selectedNode.id}
          onChange={model.updateSelectedTool}
        />
      ) : null}
      {selectedNode?.data.kind === "human-escalation" && selectedNode.data.escalation !== undefined ? (
        <EscalationInspector escalation={selectedNode.data.escalation} onChange={model.updateSelectedEscalation} />
      ) : null}
      {selectedNode?.data.kind === "end" && selectedNode.data.end !== undefined ? (
        <EndInspector end={selectedNode.data.end} onChange={model.updateSelectedEnd} />
      ) : null}
      {selectedNode === undefined ||
      (selectedNode.data.kind !== "agent" &&
        selectedNode.data.kind !== "tool" &&
        selectedNode.data.kind !== "human-escalation" &&
        selectedNode.data.kind !== "end") ? (
        <NodeSummary node={selectedNode} />
      ) : null}

      <div className="workflow-validation-panel">
        <div className="workflow-validation-head">
          <div>
            <div className="eyebrow-copy">Validation</div>
            <div className="workflow-panel-title">{validationIssues.length === 0 ? "Ready" : "Needs attention"}</div>
          </div>
          {validationIssues.length === 0 ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
        </div>
        <div className="workflow-validation-list">
          {validationIssues.length > 0 ? (
            <>
              {validationIssues.slice(0, 4).map((issue) => (
                <div key={issue.key} className="workflow-validation-item">
                  <div className="workflow-validation-code">{issue.title}</div>
                  <div>{issue.detail}</div>
                </div>
              ))}
              {model.relationshipRepairAvailable ? (
                <button
                  className="workflow-button workflow-validation-repair"
                  type="button"
                  onClick={model.repairRelationships}
                >
                  <Wrench size={14} />
                  <span>Repair relationships</span>
                </button>
              ) : null}
            </>
          ) : (
            <div className="workflow-validation-item workflow-validation-item-ok">
              This draft is ready to publish or run in sandbox.
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function WorkflowPublishDialog({ model }: { model: WorkflowBuilderScreenModel }) {
  if (!model.publishDialogOpen) {
    return null;
  }

  return (
    <div className="workflow-dialog-backdrop" role="presentation">
      <dialog className="workflow-dialog surface-card" aria-label="Publish workflow" open>
        <div className="workflow-dialog-header">
          <div>
            <div className="eyebrow-copy">Publish</div>
            <div className="workflow-panel-title">Workflow release</div>
          </div>
          <button className="workflow-icon-button" type="button" aria-label="Close publish dialog" onClick={() => model.setPublishDialogOpen(false)}>
            <X size={16} />
          </button>
        </div>
        <div className="workflow-form">
          <div className="workflow-form-field">
            <label htmlFor="publish-workflow-name">Workflow name</label>
            <input
              id="publish-workflow-name"
              aria-invalid={model.workflowTitleValid ? undefined : true}
              value={model.workflowTitle}
              onChange={(event) => model.setWorkflowTitle(event.target.value)}
            />
          </div>
          {model.publishNameConflict !== null ? (
            <div className="workflow-muted-panel" role="alert">
              <div className="workflow-validation-code">Overwrite saved workflow</div>
              <div>{`A workflow named "${model.workflowTitle.trim()}" already exists. Overwrite it?`}</div>
            </div>
          ) : null}
          {model.publishErrorMessage !== null ? (
            <div className="workflow-muted-panel" role="alert">
              <div className="workflow-validation-code">Publish blocked</div>
              <div>{model.publishErrorMessage}</div>
            </div>
          ) : null}
          <label>
            <span>Workspace</span>
            <select value={model.selectedWorkspaceId} onChange={(event) => model.setSelectedWorkspaceId(event.target.value)}>
              {model.workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="workflow-dialog-footer">
          <button className="workflow-button" type="button" disabled={model.publishSubmitting} onClick={() => model.setPublishDialogOpen(false)}>
            Cancel
          </button>
          <button className="workflow-button workflow-button-primary" type="button" disabled={model.publishSubmitDisabled} onClick={model.publishDraft}>
            {model.publishSubmitting ? "Publishing..." : model.publishNameConflict !== null ? "Overwrite workflow" : "Publish workflow"}
          </button>
        </div>
      </dialog>
    </div>
  );
}

function WorkflowSandboxDrawer({
  callerTurn,
  agentPlaybackActive,
  entryAgentName,
  liveEvents,
  lastRoutingDecision,
  microphoneState,
  mode,
  routeOptions,
  sandboxSource,
  selectedRouteId,
  starting,
  telephonyError,
  telephonyLoading,
  runtimeDisplay,
  runtimePreview,
  status,
  transcript,
  voiceTurnCapturing,
  workflowTitle,
  onCallerTurnChange,
  onClose,
  onEndSession,
  onResetSession,
  onRouteChange,
  onSendTurn,
  onSourceChange,
  onStartDraft,
}: {
  callerTurn: string;
  agentPlaybackActive: boolean;
  entryAgentName: string;
  liveEvents: LiveSandboxStreamEvent[];
  lastRoutingDecision: {
    tier: string;
    provider?: string | undefined;
    modelId?: string | undefined;
    source: string;
    matchedRuleId?: string | undefined;
    reason: string;
  } | null;
  microphoneState: "idle" | "requesting" | "granted" | "denied" | "unsupported";
  mode: "typed" | "voice";
  routeOptions: WorkflowSandboxTelephonyRoute[];
  sandboxSource: "draft" | "phone-test";
  selectedRouteId: string;
  starting: boolean;
  telephonyError: string | null;
  telephonyLoading: boolean;
  runtimeDisplay: WorkflowSandboxRuntimeDisplay;
  runtimePreview: RuntimeManifestPreview;
  status: LiveSandboxStatus;
  transcript: SandboxTranscriptEntry[];
  voiceTurnCapturing: boolean;
  workflowTitle: string;
  onCallerTurnChange: (value: string) => void;
  onClose: () => void;
  onEndSession: () => void;
  onResetSession: () => void;
  onRouteChange: (value: string) => void;
  onSendTurn: () => void;
  onSourceChange: (value: "draft" | "phone-test") => void;
  onStartDraft: (mode: "typed" | "voice") => void;
}) {
  const firstTool = runtimePreview.tools[0];
  const runtimeProfileLabel = formatRuntimeProfileLabel(runtimeDisplay.runtimeProfile);
  const voiceProfileLabel = runtimeDisplay.voiceLabel;
  const selectedRoute = routeOptions.find((route) => route.id === selectedRouteId) ?? null;
  const phoneTestHref =
    selectedRoute === null
      ? undefined
      : `/sandbox?mode=phone-test&workflow=${encodeURIComponent(selectedRoute.publishedVersionId)}&number=${encodeURIComponent(selectedRoute.phoneNumberId)}`;
  const callInProgress = isWorkflowSandboxCallInProgress({
    agentPlaybackActive,
    status,
    voiceTurnCapturing,
  });
  const startDisabled = callInProgress || starting;
  const recentLiveEvents = selectRecentLiveSandboxEvents(liveEvents);
  const sandboxTitle =
    sandboxSource === "phone-test" ? "Phone test (Twilio/PSTN)" : "Draft test (browser)";
  const runtimeDecisionCopy =
    sandboxSource === "phone-test"
      ? selectedRoute !== null
        ? `Open the shared Phone test sandbox for ${selectedRoute.phoneNumber}. The protected PSTN route stays tied to ${selectedRoute.workflowLabel} and its exact published version.`
        : "Assign a published route on Calls, then open Phone test from this drawer."
      : runtimeDisplay.isPremiumRealtime
        ? formatWorkflowSandboxRealtimeDecisionCopy(runtimeDisplay)
      : lastRoutingDecision !== null
        ? `${lastRoutingDecision.reason} (${formatWorkflowSandboxModelDecision(lastRoutingDecision)} via ${lastRoutingDecision.source}).`
        : "The draft starts at the entry role and follows the current graph validation path.";
  const toolCheckCopy =
    sandboxSource === "phone-test" && selectedRoute !== null
      ? `${selectedRoute.connectionLabel} is ready for a protected Phone test with ${selectedRoute.recordingSummary.toLowerCase()}.`
      : firstTool !== undefined
        ? `${firstTool.toolName} is ${firstTool.integrationConnectionId === undefined ? "missing credentials" : "connected"} and marked ${firstTool.risk} risk.`
        : "No tool nodes are required for this draft path.";

  return (
    <aside className="workflow-sandbox-drawer surface-card" aria-label="Workflow sandbox">
      <WorkflowSandboxHeader
        entryAgentName={entryAgentName}
        runtimeLabel={runtimeDisplay.label}
        sandboxTitle={sandboxTitle}
        workflowTitle={workflowTitle}
        onClose={onClose}
      />
      <WorkflowSandboxSourceSwitch
        sandboxSource={sandboxSource}
        onSourceChange={onSourceChange}
      />
      <WorkflowSandboxProfileGrid runtimeProfileLabel={runtimeProfileLabel} voiceProfileLabel={voiceProfileLabel} />
      {sandboxSource === "phone-test" ? (
        <WorkflowSandboxPhoneTestPath
          phoneTestHref={phoneTestHref}
          routeOptions={routeOptions}
          selectedRoute={selectedRoute}
          selectedRouteId={selectedRouteId}
          telephonyError={telephonyError}
          telephonyLoading={telephonyLoading}
          onRouteChange={onRouteChange}
        />
      ) : null}
      {sandboxSource === "draft" ? (
        <WorkflowSandboxDraftPath
          agentPlaybackActive={agentPlaybackActive}
          callerTurn={callerTurn}
          callInProgress={callInProgress}
          liveEvents={liveEvents}
          microphoneState={microphoneState}
          mode={mode}
          recentLiveEvents={recentLiveEvents}
          starting={starting}
          startDisabled={startDisabled}
          status={status}
          transcript={transcript}
          voiceTurnCapturing={voiceTurnCapturing}
          onCallerTurnChange={onCallerTurnChange}
          onEndSession={onEndSession}
          onResetSession={onResetSession}
          onSendTurn={onSendTurn}
          onStartDraft={onStartDraft}
        />
      ) : null}
      <WorkflowSandboxDecisionSections
        lastRoutingDecision={lastRoutingDecision}
        routeCount={routeOptions.length}
        runtimeDecisionCopy={runtimeDecisionCopy}
        runtimeDisplay={runtimeDisplay}
        runtimePreview={runtimePreview}
        sandboxSource={sandboxSource}
        telephonyLoading={telephonyLoading}
        toolCheckCopy={toolCheckCopy}
      />
    </aside>
  );
}

function WorkflowSandboxHeader({
  entryAgentName,
  runtimeLabel,
  sandboxTitle,
  workflowTitle,
  onClose,
}: {
  entryAgentName: string;
  runtimeLabel: string;
  sandboxTitle: string;
  workflowTitle: string;
  onClose: () => void;
}) {
  return (
    <>
      <div className="workflow-sandbox-header">
        <div>
          <div className="eyebrow-copy">Sandbox</div>
          <div className="workflow-panel-title">{sandboxTitle}</div>
        </div>
        <button className="workflow-icon-button" type="button" aria-label="Close workflow sandbox" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="workflow-sandbox-summary">
        <div className="workflow-sandbox-title">{workflowTitle}</div>
        <div className="panel-meta">{entryAgentName} - {runtimeLabel}</div>
      </div>
    </>
  );
}

function WorkflowSandboxSourceSwitch({
  sandboxSource,
  onSourceChange,
}: {
  sandboxSource: "draft" | "phone-test";
  onSourceChange: (value: "draft" | "phone-test") => void;
}) {
  return (
    <div className="workflow-sandbox-source-switch" role="tablist" aria-label="Sandbox path">
      <button
        className={["workflow-sandbox-source-button", sandboxSource === "draft" ? "workflow-sandbox-source-button-active" : ""].filter(Boolean).join(" ")}
        type="button"
        aria-pressed={sandboxSource === "draft"}
        onClick={() => onSourceChange("draft")}
      >
        Draft test (browser)
      </button>
      <button
        className={["workflow-sandbox-source-button", sandboxSource === "phone-test" ? "workflow-sandbox-source-button-active" : ""].filter(Boolean).join(" ")}
        type="button"
        aria-pressed={sandboxSource === "phone-test"}
        onClick={() => onSourceChange("phone-test")}
      >
        Phone test (Twilio/PSTN)
      </button>
    </div>
  );
}

function WorkflowSandboxProfileGrid({
  runtimeProfileLabel,
  voiceProfileLabel,
}: {
  runtimeProfileLabel: string;
  voiceProfileLabel: string;
}) {
  return (
    <div className="workflow-sandbox-profile-grid">
      <div className="sandbox-inline-metric">
        <span>Runtime profile</span>
        <strong>{runtimeProfileLabel}</strong>
      </div>
      <div className="sandbox-inline-metric">
        <span>Voice</span>
        <strong>{voiceProfileLabel}</strong>
      </div>
    </div>
  );
}

function WorkflowSandboxPhoneTestPath({
  phoneTestHref,
  routeOptions,
  selectedRoute,
  selectedRouteId,
  telephonyError,
  telephonyLoading,
  onRouteChange,
}: {
  phoneTestHref: string | undefined;
  routeOptions: WorkflowSandboxTelephonyRoute[];
  selectedRoute: WorkflowSandboxTelephonyRoute | null;
  selectedRouteId: string;
  telephonyError: string | null;
  telephonyLoading: boolean;
  onRouteChange: (value: string) => void;
}) {
  return (
    <>
      <label className="workflow-toolbar-select workflow-sandbox-select">
        <span className="sandbox-field-label">Routed phone number</span>
        <select
          aria-label="Routed phone number"
          disabled={routeOptions.length === 0}
          value={selectedRouteId}
          onChange={(event) => onRouteChange(event.target.value)}
        >
          {routeOptions.map((route) => (
            <option key={route.id} value={route.id}>
              {route.phoneNumber} - {route.workflowLabel}
            </option>
          ))}
        </select>
      </label>

      {telephonyLoading ? (
        <div className="workflow-muted-panel">
          <div className="workflow-validation-code">Loading routes</div>
          <div>Refreshing telephony inventory for this workflow.</div>
        </div>
      ) : null}

      {telephonyError !== null ? (
        <div className="workflow-muted-panel">
          <div className="workflow-validation-code">Route load failed</div>
          <div>{telephonyError}</div>
        </div>
      ) : null}

      {selectedRoute !== null ? (
        <div className="workflow-sandbox-route-grid">
          <div className="sandbox-inline-metric">
            <span>Connection</span>
            <strong>{selectedRoute.connectionLabel}</strong>
          </div>
          <div className="sandbox-inline-metric">
            <span>Provider rail</span>
            <strong>{formatTelephonyRouteRailLabel(selectedRoute)}</strong>
          </div>
          <div className="sandbox-inline-metric">
            <span>Recording</span>
            <strong>{selectedRoute.recordingSummary}</strong>
          </div>
          <div className="sandbox-inline-metric">
            <span>Workflow version</span>
            <strong>{selectedRoute.publishedVersionId}</strong>
          </div>
        </div>
      ) : (
        <div className="workflow-muted-panel">
          <div className="workflow-validation-code">No routed numbers yet</div>
          <div>Publish this workflow and assign a live number on Calls before opening Phone test.</div>
        </div>
      )}
      <div className="workflow-muted-panel">
        <div className="workflow-validation-code">Shared Phone test</div>
        <div>Phone test starts in the standalone sandbox so the waiting session, allowed caller, checklist, events, and result use one operator surface.</div>
        {selectedRoute !== null && phoneTestHref !== undefined ? (
          <Link
            aria-label={`Open Phone test for ${selectedRoute.phoneNumber}`}
            className="workflow-button workflow-button-primary mt-3"
            to={phoneTestHref}
          >
            <PhoneCall size={15} />
            <span>Open Phone test in sandbox</span>
          </Link>
        ) : null}
      </div>
    </>
  );
}

function WorkflowSandboxDraftPath({
  agentPlaybackActive,
  callerTurn,
  callInProgress,
  liveEvents,
  microphoneState,
  mode,
  recentLiveEvents,
  starting,
  startDisabled,
  status,
  transcript,
  voiceTurnCapturing,
  onCallerTurnChange,
  onEndSession,
  onResetSession,
  onSendTurn,
  onStartDraft,
}: {
  agentPlaybackActive: boolean;
  callerTurn: string;
  callInProgress: boolean;
  liveEvents: LiveSandboxStreamEvent[];
  microphoneState: "idle" | "requesting" | "granted" | "denied" | "unsupported";
  mode: "typed" | "voice";
  recentLiveEvents: LiveSandboxStreamEvent[];
  starting: boolean;
  startDisabled: boolean;
  status: LiveSandboxStatus;
  transcript: SandboxTranscriptEntry[];
  voiceTurnCapturing: boolean;
  onCallerTurnChange: (value: string) => void;
  onEndSession: () => void;
  onResetSession: () => void;
  onSendTurn: () => void;
  onStartDraft: (mode: "typed" | "voice") => void;
}) {
  return (
    <>
      <WorkflowSandboxDraftActions
        callInProgress={callInProgress}
        starting={starting}
        startDisabled={startDisabled}
        onEndSession={onEndSession}
        onResetSession={onResetSession}
        onStartDraft={onStartDraft}
      />
      <div className="workflow-sandbox-status-grid">
        <div className="sandbox-inline-metric">
          <span>Status</span>
          <strong>{formatWorkflowSandboxStatus(status, { agentPlaybackActive, voiceTurnCapturing })}</strong>
        </div>
        <div className="sandbox-inline-metric">
          <span>Mode</span>
          <strong>{mode === "voice" ? "Voice" : "Typed"}</strong>
        </div>
        <div className="sandbox-inline-metric">
          <span>Microphone</span>
          <strong>{formatWorkflowSandboxMicrophoneState(microphoneState)}</strong>
        </div>
      </div>
      {mode === "voice" ? (
        <div className="sandbox-voice-capture-row">
          <div className="panel-meta">Voice mode listens continuously and runs the workflow at natural speech endpoints.</div>
          {voiceTurnCapturing ? <VoiceCaptureMeter /> : null}
          <button className="workflow-button workflow-button-primary" type="button" disabled>
            {voiceTurnCapturing ? "Listening" : "Voice idle"}
          </button>
        </div>
      ) : (
        <>
          <label className="sandbox-composer workflow-sandbox-composer">
            <span className="sandbox-field-label">Caller turn</span>
            <textarea value={callerTurn} onChange={(event) => onCallerTurnChange(event.target.value)} />
          </label>
          <button className="workflow-button workflow-button-primary" type="button" disabled={status !== "active" || callerTurn.trim().length === 0} onClick={onSendTurn}>
            Send caller turn
          </button>
        </>
      )}
      {agentPlaybackActive ? <AgentPlaybackMeter /> : null}
      <WorkflowSandboxTranscript transcript={transcript} />
      <WorkflowSandboxLiveEvents liveEvents={liveEvents} recentLiveEvents={recentLiveEvents} />
    </>
  );
}

function WorkflowSandboxDraftActions({
  callInProgress,
  starting,
  startDisabled,
  onEndSession,
  onResetSession,
  onStartDraft,
}: {
  callInProgress: boolean;
  starting: boolean;
  startDisabled: boolean;
  onEndSession: () => void;
  onResetSession: () => void;
  onStartDraft: (mode: "typed" | "voice") => void;
}) {
  return (
    <div className="workflow-sandbox-actions">
      <button className="workflow-button workflow-sandbox-call-button" type="button" disabled={startDisabled} onClick={() => onStartDraft("voice")}>
        <PhoneCall size={15} />
        <span>{starting ? "Calling" : "Call"}</span>
      </button>
      <button className="workflow-button" type="button" disabled={startDisabled} onClick={() => onStartDraft("typed")}>
        <Play size={15} />
        <span>Use typed run</span>
      </button>
      <button
        className={callInProgress ? "workflow-button workflow-sandbox-end-call workflow-button-danger" : "workflow-button workflow-sandbox-end-call"}
        type="button"
        disabled={!callInProgress}
        onClick={onEndSession}
      >
        <Power size={15} />
        <span>End call</span>
      </button>
      <button className="workflow-button workflow-sandbox-reset" type="button" onClick={onResetSession}>
        <RotateCcw size={15} />
        <span>Reset sandbox</span>
      </button>
    </div>
  );
}

function WorkflowSandboxTranscript({ transcript }: { transcript: SandboxTranscriptEntry[] }) {
  return (
    <div className="workflow-sandbox-section">
      <div className="sandbox-pane-header">
        <span>Transcript</span>
        <span>{transcript.length} entries</span>
      </div>
      <div className="workflow-sandbox-transcript" aria-live="polite">
        {transcript.length === 0 ? (
          <div className="sandbox-empty-copy">Start a draft run to inspect the current graph before publishing.</div>
        ) : null}
        {transcript.map((entry, index) => (
          <article key={entry.id ?? `${entry.speaker}-${index}`} className={`sandbox-transcript-item sandbox-transcript-item-${entry.speaker}`}>
            <div className="sandbox-transcript-meta">
              <span>{entry.speaker === "caller" ? "Caller" : entry.speaker === "agent" ? "Agent" : "System"}</span>
              <span>{entry.at !== undefined ? formatWorkflowSandboxTime(entry.at) : "draft"}</span>
            </div>
            <p>{entry.text}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

function WorkflowSandboxLiveEvents({
  liveEvents,
  recentLiveEvents,
}: {
  liveEvents: LiveSandboxStreamEvent[];
  recentLiveEvents: LiveSandboxStreamEvent[];
}) {
  const diagnosticEvents = selectDiagnosticLiveSandboxEvents(liveEvents);

  return (
    <div className="workflow-sandbox-section">
      <div className="sandbox-pane-header">
        <span>Live events</span>
        <span>{liveEvents.length}</span>
      </div>
      <div className="sandbox-event-list">
        {liveEvents.length === 0 ? (
          <div className="sandbox-empty-copy">Runtime events will stream here as soon as the live session starts.</div>
        ) : null}
        {recentLiveEvents.map((event) => {
          const summary = summarizeLiveSandboxEvent(event);

          return (
            <div key={`${event.sessionId}:${event.sequence}`} className="sandbox-event-row">
              <div>
                <div className="panel-title">{summary.title}</div>
                {summary.detail !== undefined ? <div className="panel-meta">{summary.detail}</div> : null}
                <div className="panel-meta">#{event.sequence} - {formatWorkflowSandboxTime(event.at)}</div>
              </div>
              <span className={`status-pill status-pill-${summary.tone}`}>{summary.label}</span>
            </div>
          );
        })}
      </div>
      {diagnosticEvents.length > 0 ? (
        <details className="sandbox-diagnostics-panel">
          <summary>
            <span>Diagnostics</span>
            <span>{diagnosticEvents.length}</span>
          </summary>
          <div className="sandbox-event-list sandbox-diagnostics-list">
            {diagnosticEvents.map((event) => {
              const summary = summarizeLiveSandboxEvent(event);

              return (
                <div key={`diagnostic:${event.sessionId}:${event.sequence}`} className="sandbox-event-row sandbox-diagnostics-row">
                  <div>
                    <div className="panel-title">{summary.title}</div>
                    {summary.detail !== undefined ? <div className="panel-meta">{summary.detail}</div> : null}
                    <div className="panel-meta">#{event.sequence} - {formatWorkflowSandboxTime(event.at)} - {event.type}</div>
                    <code className="sandbox-diagnostics-payload">{formatDiagnosticPayload(event.payload)}</code>
                  </div>
                  <span className={`status-pill status-pill-${summary.tone}`}>{summary.label}</span>
                </div>
              );
            })}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function formatDiagnosticPayload(payload: Record<string, unknown>) {
  const entries = Object.entries(payload)
    .filter(([, value]) => value !== undefined && value !== null)
    .slice(0, 8)
    .map(([key, value]) => `${key}: ${formatDiagnosticPayloadValue(value)}`);

  return entries.length > 0 ? entries.join(" | ") : "No payload";
}

function formatDiagnosticPayloadValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `[${value.length}]`;
  }

  if (typeof value === "object") {
    return "{...}";
  }

  return "unknown";
}

function WorkflowSandboxDecisionSections({
  lastRoutingDecision,
  routeCount,
  runtimeDecisionCopy,
  runtimeDisplay,
  runtimePreview,
  sandboxSource,
  telephonyLoading,
  toolCheckCopy,
}: {
  lastRoutingDecision: {
    tier: string;
    provider?: string | undefined;
    modelId?: string | undefined;
    source: string;
    matchedRuleId?: string | undefined;
    reason: string;
  } | null;
  routeCount: number;
  runtimeDecisionCopy: string;
  runtimeDisplay: WorkflowSandboxRuntimeDisplay;
  runtimePreview: RuntimeManifestPreview;
  sandboxSource: "draft" | "phone-test";
  telephonyLoading: boolean;
  toolCheckCopy: string;
}) {
  return (
    <>
      <div className="workflow-sandbox-section">
        <div className="sandbox-pane-header">
          <span>Runtime decision</span>
          <span>{sandboxSource === "phone-test" ? "Phone test" : runtimeDisplay.label}</span>
        </div>
        <div className="body-copy">{runtimeDecisionCopy}</div>
        {sandboxSource === "draft" && lastRoutingDecision !== null && !runtimeDisplay.isPremiumRealtime ? (
          <div className="panel-meta mt-3">
            Rule {lastRoutingDecision.matchedRuleId ?? "default"} selected {formatWorkflowSandboxModelDecision(lastRoutingDecision)}.
          </div>
        ) : null}
      </div>
      <div className="workflow-sandbox-section">
        <div className="sandbox-pane-header">
          <span>Tool check</span>
          <span>{sandboxSource === "phone-test" ? "Route posture" : `${runtimePreview.tools.length} tools`}</span>
        </div>
        <div className="body-copy">{toolCheckCopy}</div>
      </div>
      {sandboxSource === "phone-test" && routeCount === 0 && !telephonyLoading ? (
        <div className="workflow-sandbox-section">
          <div className="sandbox-pane-header">
            <span>Phone test checklist</span>
            <span>Calls</span>
          </div>
          <div className="body-copy">
            Publish this workflow, go to Calls, provision or import a number, save the route, then return here to open Phone test.
          </div>
        </div>
      ) : null}
      {sandboxSource === "phone-test" && routeCount > 0 ? (
        <div className="workflow-sandbox-section">
          <div className="sandbox-pane-header">
            <span>Phone test checklist</span>
            <span>Ready</span>
          </div>
          <div className="body-copy">
            Open the shared Phone test sandbox to create the protected waiting session, limit allowed callers, and store the PSTN checklist result.
          </div>
        </div>
      ) : null}
    </>
  );
}

function VoiceCaptureMeter() {
  return (
    <output className="sandbox-voice-meter" aria-label="Voice capture active">
      <span className="sandbox-voice-dot" />
      <span className="sandbox-voice-bars" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </span>
      <span>Listening for caller speech</span>
    </output>
  );
}

function AgentPlaybackMeter() {
  return (
    <output className="sandbox-playback-meter" aria-label="Agent playback active">
      <span className="sandbox-playback-ring">
        <Headphones size={14} />
      </span>
      <span className="sandbox-playback-bars" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </span>
      <span>Playing agent response</span>
    </output>
  );
}

function BuilderNodeCard({ data, selected }: NodeProps<BuilderNode>) {
  const Icon = getNodeIcon(data.kind);
  const accent = getBuilderNodeAccent(data.kind);
  const accentStyle = {
    "--builder-node-accent": accent.accent,
    "--builder-node-accent-soft": accent.tint,
  } as CSSProperties;
  const isAgentNode = data.kind === "agent";
  const isToolNode = data.kind === "tool";
  const liveState = data.liveState ?? "idle";
  const sideHandleStyle = { backgroundColor: accent.accent };
  const topCallHandleStyle = { backgroundColor: accent.accent, left: "44%" };
  const topResultHandleStyle = { backgroundColor: accent.accent, left: "56%" };
  const bottomCallHandleStyle = { backgroundColor: accent.accent, left: "44%" };
  const bottomResultHandleStyle = { backgroundColor: accent.accent, left: "56%" };

  return (
    <div
      className={[
        "builder-node-card",
        selected ? "builder-node-card-selected" : "",
        liveState !== "idle" ? "builder-node-card-live" : "",
        liveState === "current" ? "builder-node-card-live-current" : "",
        liveState === "visited" ? "builder-node-card-live-visited" : "",
      ].filter(Boolean).join(" ")}
      style={accentStyle}
    >
      {isAgentNode ? (
        <>
          <Handle
            id={builderFlowTargetHandleId}
            type="target"
            position={Position.Left}
            className="builder-node-handle-flow"
            style={sideHandleStyle}
          />
          <Handle
            id="agent-tool-call-source-top"
            type="source"
            position={Position.Top}
            className="builder-node-handle-tool-call"
            style={topCallHandleStyle}
          />
          <Handle
            id="agent-tool-result-target-top"
            type="target"
            position={Position.Top}
            className="builder-node-handle-tool-result"
            style={topResultHandleStyle}
          />
        </>
      ) : null}
      {data.kind !== "entry" && !isAgentNode && !isToolNode ? (
        <Handle
          id={builderFlowTargetHandleId}
          type="target"
          position={Position.Left}
          className="builder-node-handle-flow"
          style={sideHandleStyle}
        />
      ) : null}
      <div className="builder-node-main">
        <div className="builder-node-icon">
          <Icon size={15} />
        </div>
        <div>
          <div className="builder-node-title">{data.label}</div>
          <div className="builder-node-subtitle">{data.subtitle}</div>
        </div>
      </div>
      <div className="builder-node-footer">
        <span>{getNodeKindLabel(data.kind)}</span>
        <span>{data.badge}</span>
      </div>
      {!isToolNode ? (
        <Handle
          id={builderFlowSourceHandleId}
          type="source"
          position={Position.Right}
          className="builder-node-handle-flow"
          style={sideHandleStyle}
        />
      ) : null}
      {isToolNode ? (
        <>
          <Handle
            id="tool-call-target-bottom"
            type="target"
            position={Position.Bottom}
            className="builder-node-handle-tool-call"
            style={bottomCallHandleStyle}
          />
          <Handle
            id="tool-result-source-bottom"
            type="source"
            position={Position.Bottom}
            className="builder-node-handle-tool-result"
            style={bottomResultHandleStyle}
          />
        </>
      ) : null}
    </div>
  );
}

function AgentRoleInspector({
  actorUserId,
  actorRole,
  organizationId,
  role,
  routeFallbackOptions,
  routeTargetOptions,
  templates,
  voiceLibraryState,
  workflowRuntimeProfile,
  onApplyTemplate,
  onChange,
  onSaveTemplate,
  onVoiceUpdated,
}: {
  actorUserId?: string | undefined;
  actorRole: TenantRole;
  organizationId?: string | undefined;
  role: AgentRoleNodeConfig;
  routeFallbackOptions: AgentRouteFallbackOption[];
  routeTargetOptions: AgentRouteTargetOption[];
  templates: SpecialistRoleTemplate[];
  voiceLibraryState: VoiceLibraryState;
  workflowRuntimeProfile: RuntimeProfileId;
  onApplyTemplate: (templateId: string) => void;
  onChange: (patch: Partial<AgentRoleNodeConfig>) => void;
  onSaveTemplate: () => void;
  onVoiceUpdated: (voice: TenantVoiceLibraryVoice) => void;
}) {
  const agentNameMissing = role.name.trim().length === 0;
  const businessNameMissing = role.businessName.trim().length === 0;
  const instructionsMissing = role.instructions.trim().length === 0;

  return (
    <div className="workflow-form">
      <InspectorSection title="Personal details" defaultOpen>
        <label>
          <span>Specialist template</span>
          <select value={role.specialistTemplateId ?? ""} onChange={(event) => onApplyTemplate(event.target.value)}>
            <option value="">Select reusable specialist</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name} v{template.version}
              </option>
            ))}
          </select>
        </label>
        <button className="workflow-button" type="button" onClick={onSaveTemplate}>
          Save specialist template
        </button>
        <label>
          <span>Agent name</span>
          <input
            aria-invalid={agentNameMissing ? true : undefined}
            placeholder="Required"
            value={role.name}
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </label>
        <label>
          <span>Business name</span>
          <input
            aria-invalid={businessNameMissing ? true : undefined}
            placeholder="Required"
            value={role.businessName}
            onChange={(event) => onChange({ businessName: event.target.value })}
          />
        </label>
        <label>
          <span>Instructions</span>
          <textarea
            aria-invalid={instructionsMissing ? true : undefined}
            value={role.instructions}
            rows={6}
            onChange={(event) => onChange({ instructions: event.target.value })}
          />
        </label>
        <label>
          <span>Role type</span>
          <select value={role.kind} onChange={(event) => onChange({ kind: event.target.value as AgentRoleKind })}>
            <option value="receptionist">Receptionist</option>
            <option value="support">Support</option>
            <option value="billing">Billing</option>
            <option value="onboarding">Onboarding</option>
            <option value="sales">Sales</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label className="workflow-checkbox">
          <input
            checked={role.reusableSpecialist}
            type="checkbox"
            onChange={(event) => onChange({ reusableSpecialist: event.target.checked })}
          />
          <span>Reusable specialist</span>
        </label>
      </InspectorSection>
      {role.routePolicy === undefined ? null : (
        <InspectorSection title="Routing" defaultOpen>
          <AgentRoleRoutingSettings
            role={role}
            routeFallbackOptions={routeFallbackOptions}
            routeTargetOptions={routeTargetOptions}
            onChange={onChange}
          />
        </InspectorSection>
      )}
      <InspectorSection title="Voice" defaultOpen>
        <AgentRoleVoiceSettings
          actorUserId={actorUserId}
          actorRole={actorRole}
          organizationId={organizationId}
          role={role}
          voiceLibraryState={voiceLibraryState}
          workflowRuntimeProfile={workflowRuntimeProfile}
          onChange={onChange}
          onVoiceUpdated={onVoiceUpdated}
        />
      </InspectorSection>
      <InspectorSection title="Model config" defaultOpen>
        <AgentRoleRuntimeSettings role={role} workflowRuntimeProfile={workflowRuntimeProfile} onChange={onChange} />
        <AgentRoleLanguageSettings role={role} onChange={onChange} />
      </InspectorSection>
    </div>
  );
}

function AgentRoleRoutingSettings({
  role,
  routeFallbackOptions,
  routeTargetOptions,
  onChange,
}: {
  role: AgentRoleNodeConfig;
  routeFallbackOptions: AgentRouteFallbackOption[];
  routeTargetOptions: AgentRouteTargetOption[];
  onChange: (patch: Partial<AgentRoleNodeConfig>) => void;
}) {
  const routePolicy = role.routePolicy;
  const branch = routePolicy?.branches[0];
  const firstAvailableRouteTarget = routeTargetOptions[0];
  const selectedTargetAgentId =
    branch?.target.type === "agent" ? branch.target.agentId : firstAvailableRouteTarget?.agentId ?? "";
  const selectedFallbackValue = routePolicy === undefined
    ? "clarify_source_agent"
    : formatAgentRouteFallbackValue(routePolicy.fallback.target);

  useEffect(() => {
    if (routePolicy === undefined || branch !== undefined || firstAvailableRouteTarget === undefined) {
      return;
    }

    onChange({
      routePolicy: {
        ...routePolicy,
        branches: [createDefaultAgentRouteBranch(firstAvailableRouteTarget)],
      },
    });
  }, [branch, firstAvailableRouteTarget, onChange, routePolicy]);

  const updateBranch = (patch: Partial<AgentRoutePolicyBranchConfig>) => {
    if (routePolicy === undefined || branch === undefined) {
      return;
    }

    onChange({
      routePolicy: {
        ...routePolicy,
        branches: routePolicy.branches.map((candidate, index) =>
          index === 0
            ? {
                ...branch,
                ...patch,
              }
            : candidate,
        ),
      },
    });
  };

  const updateRouteTarget = (agentId: string) => {
    const target = routeTargetOptions.find((option) => option.agentId === agentId);

    if (target === undefined) {
      return;
    }

    updateBranch({
      ...createDefaultAgentRouteBranch(target),
    });
  };

  const updateFallback = (value: string) => {
    const fallback = routeFallbackOptions.find((option) => option.value === value);

    if (routePolicy === undefined || fallback === undefined) {
      return;
    }

    onChange({
      routePolicy: {
        ...routePolicy,
        fallback: {
          label: fallback.label,
          target: fallback.target,
        },
      },
    });
  };

  return (
    <>
      {routePolicy !== undefined && branch !== undefined ? (
        <>
          <label>
            <span>Route target</span>
            <select
              aria-label="Route target"
              value={selectedTargetAgentId}
              onChange={(event) => updateRouteTarget(event.target.value)}
            >
              {routeTargetOptions.map((option) => (
                <option key={option.agentId} value={option.agentId}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Branch label</span>
            <input
              aria-label="Branch label"
              value={branch.label}
              onChange={(event) => updateBranch({ label: event.target.value })}
            />
          </label>
          <label>
            <span>Branch description</span>
            <textarea
              aria-label="Branch description"
              rows={3}
              value={branch.description}
              onChange={(event) => updateBranch({ description: event.target.value })}
            />
          </label>
          <label>
            <span>Branch examples</span>
            <input
              aria-label="Branch examples"
              value={branch.examples.join("; ")}
              onChange={(event) => updateBranch({ examples: splitAgentRouteExamples(event.target.value) })}
            />
          </label>
          <label>
            <span>Fallback route</span>
            <select
              aria-label="Fallback route"
              value={selectedFallbackValue}
              onChange={(event) => updateFallback(event.target.value)}
            >
              {routeFallbackOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}
      {routePolicy !== undefined && branch === undefined && firstAvailableRouteTarget === undefined ? (
        <div className="workflow-muted-panel">Add another agent before configuring routing.</div>
      ) : null}
    </>
  );
}

function InspectorSection({
  children,
  defaultOpen,
  title,
}: {
  children: ReactNode;
  defaultOpen?: boolean | undefined;
  title: string;
}) {
  return (
    <details className="workflow-inspector-section" open={defaultOpen}>
      <summary>
        <span>{title}</span>
        <ChevronDown size={14} />
      </summary>
      <div className="workflow-inspector-section-body">{children}</div>
    </details>
  );
}

function AgentRoleVoiceSettings({
  actorUserId,
  actorRole,
  organizationId,
  role,
  voiceLibraryState,
  workflowRuntimeProfile,
  onChange,
  onVoiceUpdated,
}: {
  actorUserId?: string | undefined;
  actorRole: TenantRole;
  organizationId?: string | undefined;
  role: AgentRoleNodeConfig;
  voiceLibraryState: VoiceLibraryState;
  workflowRuntimeProfile: RuntimeProfileId;
  onChange: (patch: Partial<AgentRoleNodeConfig>) => void;
  onVoiceUpdated: (voice: TenantVoiceLibraryVoice) => void;
}) {
  const selectedRuntimeProfile = role.runtimeProfileOverride ?? workflowRuntimeProfile;
  const usesPremiumRealtime = selectedRuntimeProfile === "premium-realtime";
  const [draft, setDraft] = useState(() => createVoiceDraft(role.voiceConfig));
  const [previewState, setPreviewState] = useState<{
    status: "idle" | "loading" | "ready" | "error";
    message: string;
    audioSrc: string | null;
  }>({ status: "idle", message: "", audioSrc: null });
  const [cloneDraft, setCloneDraft] = useState<{
    label: string;
    file: File | null;
    consentConfirmed: boolean;
  }>({
    label: "",
    file: null,
    consentConfirmed: false,
  });
  const [cloneState, setCloneState] = useState<{
    status: "idle" | "loading" | "ready" | "error";
    message: string;
  }>({ status: "idle", message: "" });
  const selectedVoice = voiceLibraryState.voices.find((voice) => voice.id === draft.voiceId);
  const selectedVoiceIsConfigurable = selectedVoice !== undefined && isTenantVoiceSelectable(selectedVoice);
  const clonedVoices = voiceLibraryState.voices.filter((voice) => voice.sourceType === "cloned");
  const hasContext = organizationId !== undefined && organizationId.length > 0 && actorUserId !== undefined && actorUserId.length > 0;
  const canManageVoiceClones = actorRole === "owner" || actorRole === "admin";
  const canPreview = hasContext && selectedVoiceIsConfigurable && previewState.status !== "loading";
  const canRequestClone =
    hasContext &&
    canManageVoiceClones &&
    cloneState.status !== "loading" &&
    cloneDraft.label.trim().length > 0 &&
    cloneDraft.file !== null &&
    cloneDraft.consentConfirmed;
  const previewMessage =
    previewState.status === "ready"
      ? previewState.message
      : previewState.status === "error"
        ? previewState.message
        : "";

  useEffect(() => {
    setDraft(createVoiceDraft(role.voiceConfig));
    setPreviewState({ status: "idle", message: "", audioSrc: null });
  }, [
    role.voiceConfig?.emotion,
    role.voiceConfig?.label,
    role.voiceConfig?.sourceType,
    role.voiceConfig?.speed,
    role.voiceConfig?.voiceId,
    role.voiceConfig?.volume,
  ]);

  const commitVoiceConfig = (nextDraft: ReturnType<typeof createVoiceDraft>) => {
    const nextVoice = voiceLibraryState.voices.find((voice) => voice.id === nextDraft.voiceId);
    setDraft(nextDraft);
    setPreviewState({ status: "idle", message: "", audioSrc: null });

    if (nextDraft.voiceId.length === 0) {
      onChange({ voiceConfig: undefined });
      return;
    }

    if (nextVoice === undefined || !isTenantVoiceSelectable(nextVoice)) {
      setPreviewState({
        status: "error",
        message: "Choose an approved voice before using it.",
        audioSrc: null,
      });
      return;
    }

    const nextVoiceConfig: AgentVoiceConfig = {
      provider: "cartesia",
      voiceId: nextVoice.id,
      label: nextVoice.label,
      sourceType: nextVoice.sourceType,
      ...(nextVoice.sourceType === "cloned" ? { cloneStatus: "approved" } : {}),
      speed: nextDraft.speed,
      volume: nextDraft.volume,
      ...(nextDraft.emotion.length > 0 ? { emotion: nextDraft.emotion } : {}),
    };

    onChange({ voiceConfig: nextVoiceConfig });
  };

  const previewVoice = () => {
    if (!canPreview || organizationId === undefined || actorUserId === undefined) {
      return;
    }

    setPreviewState({ status: "loading", message: "Preparing preview...", audioSrc: null });

    void previewTenantVoice({
      organizationId,
      actorUserId,
      actorRole,
      voiceId: draft.voiceId,
      text: buildVoicePreviewText(role),
      speed: draft.speed,
      volume: draft.volume,
      emotion: draft.emotion,
    })
      .then((descriptor) => {
        setPreviewState({
          status: "ready",
          message: descriptor.message ?? "Preview ready.",
          audioSrc: getVoicePreviewAudioSrc(descriptor),
        });
      })
      .catch((error: unknown) => {
        setPreviewState({
          status: "error",
          message: error instanceof Error ? error.message : "Preview could not be prepared.",
          audioSrc: null,
        });
      });
  };

  const requestClone = () => {
    if (!canRequestClone || organizationId === undefined || actorUserId === undefined || cloneDraft.file === null) {
      return;
    }

    setCloneState({ status: "loading", message: "Uploading source audio..." });

    void readFileAsBase64(cloneDraft.file)
      .then((contentBase64) =>
        uploadTenantVoiceSourceAudio({
          organizationId,
          actorUserId,
          actorRole,
          fileName: cloneDraft.file?.name ?? "voice-source",
          contentType: cloneDraft.file?.type || "application/octet-stream",
          contentBase64,
        }),
      )
      .then((upload) =>
        requestTenantVoiceClone({
          organizationId,
          actorUserId,
          actorRole,
          label: cloneDraft.label.trim(),
          sourceAudioRef: upload.sourceAudioRef,
          consentConfirmed: cloneDraft.consentConfirmed,
        }),
      )
      .then((voice) => {
        onVoiceUpdated(voice);
        setCloneDraft({ label: "", file: null, consentConfirmed: false });
        setCloneState({
          status: "ready",
          message: `${voice.label} is pending approval.`,
        });
      })
      .catch((error: unknown) => {
        setCloneState({
          status: "error",
          message: error instanceof Error ? error.message : "Voice clone request failed.",
        });
      });
  };

  const approveClone = (voice: TenantVoiceLibraryVoice) => {
    if (!hasContext || organizationId === undefined || actorUserId === undefined) {
      return;
    }

    setCloneState({ status: "loading", message: `Approving ${voice.label}...` });
    void approveTenantVoiceClone({
      organizationId,
      actorUserId,
      actorRole,
      voiceId: voice.id,
    })
      .then((updatedVoice) => {
        onVoiceUpdated(updatedVoice);
        setCloneState({ status: "ready", message: `${updatedVoice.label} approved.` });
      })
      .catch((error: unknown) => {
        setCloneState({
          status: "error",
          message: error instanceof Error ? error.message : "Voice approval failed.",
        });
      });
  };

  const updateCloneStatus = (
    voice: TenantVoiceLibraryVoice,
    action: "disable" | "delete",
  ) => {
    if (!hasContext || organizationId === undefined || actorUserId === undefined) {
      return;
    }

    setCloneState({
      status: "loading",
      message: `${action === "disable" ? "Disabling" : "Deleting"} ${voice.label}...`,
    });

    const actionRequest = action === "disable" ? disableTenantVoice : deleteTenantVoice;
    void actionRequest({
      organizationId,
      actorUserId,
      actorRole,
      voiceId: voice.id,
    })
      .then((updatedVoice) => {
        onVoiceUpdated(updatedVoice);
        setCloneState({
          status: "ready",
          message: `${updatedVoice.label} ${action === "disable" ? "disabled" : "deleted"}.`,
        });
      })
      .catch((error: unknown) => {
        setCloneState({
          status: "error",
          message: error instanceof Error ? error.message : `Voice ${action} failed.`,
        });
      });
  };

  if (usesPremiumRealtime) {
    return <AgentRoleRealtimeVoiceSettings role={role} onChange={onChange} />;
  }

  if (!hasContext) {
    return (
      <div className="workflow-readonly-row">
        <span>Voice</span>
        <strong>{role.voiceConfig?.label ?? "Workflow default voice"}</strong>
      </div>
    );
  }

  return (
    <section className="workflow-voice-settings" aria-label="Voice">
      <div className="workflow-voice-settings-head">
        <div>
          <span>Voice</span>
          <strong>{role.voiceConfig?.label ?? "Workflow default voice"}</strong>
        </div>
        {voiceLibraryState.loading ? <small>Loading</small> : null}
      </div>
      <label>
        <span>Cartesia voice</span>
        <select
          value={draft.voiceId}
          onChange={(event) => {
            commitVoiceConfig({
              ...draft,
              voiceId: event.target.value,
            });
          }}
        >
          <option value="">Workflow default voice</option>
          {voiceLibraryState.voices.map((voice) => (
            <option key={voice.id} value={voice.id} disabled={!isTenantVoiceSelectable(voice)}>
              {voice.label}{isTenantVoiceSelectable(voice) ? "" : ` (${formatTenantVoiceStatus(voice.status)})`}
            </option>
          ))}
        </select>
      </label>
      <div className="workflow-voice-tuning-grid">
        <label>
          <span>Speed {draft.speed.toFixed(2)}</span>
          <input
            type="range"
            min="0.75"
            max="1.25"
            step="0.05"
            value={draft.speed}
            onChange={(event) => {
              commitVoiceConfig({
                ...draft,
                speed: Number(event.target.value),
              });
            }}
          />
        </label>
        <label>
          <span>Volume {draft.volume.toFixed(2)}</span>
          <input
            type="range"
            min="0.5"
            max="1.5"
            step="0.05"
            value={draft.volume}
            onChange={(event) => {
              commitVoiceConfig({
                ...draft,
                volume: Number(event.target.value),
              });
            }}
          />
        </label>
      </div>
      <label>
        <span>Emotion</span>
        <select
          value={draft.emotion}
          onChange={(event) => {
            commitVoiceConfig({
              ...draft,
              emotion: event.target.value,
            });
          }}
        >
          <option value="">Natural</option>
          <option value="calm">Calm</option>
          <option value="content">Content</option>
          <option value="neutral">Neutral</option>
          <option value="sad">Soft</option>
          <option value="angry">Firm</option>
        </select>
      </label>
      {voiceLibraryState.error !== null ? (
        <div className="workflow-voice-preview workflow-voice-preview-error">{voiceLibraryState.error}</div>
      ) : null}
      <div className="workflow-voice-actions">
        <button
          aria-label="Preview voice"
          className="workflow-button workflow-button-success"
          type="button"
          disabled={!canPreview}
          onClick={previewVoice}
        >
          <Play size={14} />
          <span>{previewState.status === "loading" ? "Previewing" : "Preview"}</span>
        </button>
      </div>
      {previewMessage.length > 0 ? (
        <div
          className={[
            "workflow-voice-preview",
            previewState.status === "error" ? "workflow-voice-preview-error" : "workflow-voice-preview-ready",
          ].join(" ")}
          role="status"
        >
          {previewMessage}
        </div>
      ) : null}
      {previewState.audioSrc !== null ? (
        <audio className="workflow-voice-audio" controls src={previewState.audioSrc} aria-label="Voice preview audio">
          Preview audio is not supported in this browser.
        </audio>
      ) : null}
      {canManageVoiceClones ? (
      <div className="workflow-voice-clone-panel">
        <div className="workflow-voice-clone-head">
          <span>Clone voice</span>
          <strong>{cloneDraft.file?.name ?? "Source audio required"}</strong>
        </div>
        <label>
          <span>Clone label</span>
          <input
            value={cloneDraft.label}
            onChange={(event) =>
              setCloneDraft((current) => ({
                ...current,
                label: event.target.value,
              }))
            }
          />
        </label>
        <label>
          <span>Source audio</span>
          <input
            type="file"
            accept="audio/*"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0] ?? null;

              setCloneDraft((current) => ({
                ...current,
                file,
              }));
            }}
          />
        </label>
        <label className="workflow-checkbox workflow-voice-consent">
          <input
            checked={cloneDraft.consentConfirmed}
            type="checkbox"
            onChange={(event) =>
              setCloneDraft((current) => ({
                ...current,
                consentConfirmed: event.target.checked,
              }))
            }
          />
          <span>Consent confirmed</span>
        </label>
        <button className="workflow-button" type="button" disabled={!canRequestClone} onClick={requestClone}>
          {cloneState.status === "loading" ? "Working" : "Request clone"}
        </button>
      </div>
      ) : (
        <div className="workflow-voice-preview">
          Voice cloning is managed by an owner or admin. You can still choose approved voices for this agent.
        </div>
      )}
      {clonedVoices.length > 0 ? (
        <div className="workflow-voice-clone-list" aria-label="Cloned voices">
          {clonedVoices.map((voice) => (
            <div className="workflow-voice-clone-row" key={voice.id}>
              <div>
                <strong>{voice.label}</strong>
                <span>{formatTenantVoiceStatus(voice.status)}</span>
              </div>
              <div className="workflow-voice-clone-actions">
                <button
                  className="workflow-button"
                  type="button"
                  disabled={!canManageVoiceClones || voice.status === "available" || voice.status === "deleted"}
                  onClick={() => approveClone(voice)}
                >
                  Approve {voice.label}
                </button>
                <button
                  className="workflow-button"
                  type="button"
                  disabled={!canManageVoiceClones || voice.status === "disabled" || voice.status === "deleted"}
                  onClick={() => updateCloneStatus(voice, "disable")}
                >
                  Disable {voice.label}
                </button>
                <button
                  className="workflow-button"
                  type="button"
                  disabled={!canManageVoiceClones || voice.status === "deleted"}
                  onClick={() => updateCloneStatus(voice, "delete")}
                >
                  Delete {voice.label}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {cloneState.message.length > 0 ? (
        <div
          className={[
            "workflow-voice-preview",
            cloneState.status === "error" ? "workflow-voice-preview-error" : "workflow-voice-preview-ready",
          ].join(" ")}
          role="status"
        >
          {cloneState.message}
        </div>
      ) : null}
    </section>
  );
}

function AgentRoleRealtimeVoiceSettings({
  role,
  onChange,
}: {
  role: AgentRoleNodeConfig;
  onChange: (patch: Partial<AgentRoleNodeConfig>) => void;
}) {
  const selectedRealtimeProvider = role.realtimeProvider ?? "openai-realtime";
  const providerLabel = formatRealtimeProviderLabel(selectedRealtimeProvider);
  const providerVoiceOptions = realtimeVoiceOptions[selectedRealtimeProvider];
  const selectedVoice = resolveRealtimeVoiceValue(role, selectedRealtimeProvider);

  return (
    <section className="workflow-voice-settings" aria-label="Voice">
      <div className="workflow-voice-settings-head">
        <div>
          <span>Voice</span>
          <strong>{providerLabel}</strong>
        </div>
      </div>
      <label>
        <span>{providerLabel} voice</span>
        <select
          value={selectedVoice}
          onChange={(event) => {
            onChange({
              realtimeVoiceConfig: createRealtimeVoiceConfig(
                selectedRealtimeProvider,
                event.target.value,
                role.realtimeVoiceConfig,
              ),
            });
          }}
        >
          {providerVoiceOptions.map((voice) => (
            <option key={voice.value} value={voice.value}>
              {voice.label}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}

function resolveRealtimeVoiceValue(role: AgentRoleNodeConfig, provider: RealtimeProviderId) {
  if (role.realtimeVoiceConfig?.provider === "openai-realtime" && provider === "openai-realtime") {
    return role.realtimeVoiceConfig.voice;
  }

  if (role.realtimeVoiceConfig?.provider === "gemini-live" && provider === "gemini-live") {
    return role.realtimeVoiceConfig.voiceName;
  }

  return getDefaultRealtimeVoiceValue(provider);
}

function createRealtimeVoiceConfig(
  provider: RealtimeProviderId,
  value: string,
  previousConfig?: RealtimeVoiceConfig | undefined,
): RealtimeVoiceConfig {
  if (provider === "gemini-live") {
    return {
      provider,
      voiceName: value as GeminiLiveVoiceName,
    };
  }

  return {
    provider,
    voice: value as OpenAiRealtimeVoice,
    ...(previousConfig?.provider === "openai-realtime" && previousConfig.speed !== undefined
      ? { speed: previousConfig.speed }
      : {}),
  };
}

function getDefaultRealtimeVoiceValue(provider: RealtimeProviderId) {
  return provider === "gemini-live" ? "Kore" : "marin";
}

function createVoiceDraft(voiceConfig: AgentVoiceConfig | undefined) {
  return {
    voiceId: voiceConfig?.voiceId ?? "",
    speed: voiceConfig?.speed ?? 1,
    volume: voiceConfig?.volume ?? 1,
    emotion: voiceConfig?.emotion ?? "",
  };
}

function isTenantVoiceSelectable(voice: TenantVoiceLibraryVoice) {
  return voice.provider === "cartesia" && voice.status === "available";
}

function formatTenantVoiceStatus(status: TenantVoiceLibraryVoice["status"]) {
  switch (status) {
    case "available":
      return "Available";
    case "pending":
      return "Pending";
    case "disabled":
      return "Disabled";
    case "deleted":
      return "Deleted";
  }
}

function buildVoicePreviewText(role: AgentRoleNodeConfig) {
  const roleName = role.name.trim().length > 0 ? role.name.trim() : "your Zara agent";

  return `Hello, this is ${roleName}. How can I help today?`;
}

function getVoicePreviewAudioSrc(descriptor: TenantVoicePreviewDescriptor) {
  if (descriptor.audioUrl !== undefined && descriptor.audioUrl.length > 0) {
    return descriptor.audioUrl;
  }

  if (
    descriptor.audioBase64 !== undefined &&
    descriptor.audioBase64.length > 0 &&
    descriptor.audioContentType !== undefined &&
    descriptor.audioContentType.length > 0
  ) {
    return `data:${descriptor.audioContentType};base64,${descriptor.audioBase64}`;
  }

  return null;
}

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const [, base64 = ""] = result.split(",");
      resolve(base64);
    });
    reader.addEventListener("error", () => {
      reject(new Error("Source audio could not be read."));
    });
    reader.readAsDataURL(file);
  });
}

function AgentRoleRuntimeSettings({
  role,
  workflowRuntimeProfile,
  onChange,
}: {
  role: AgentRoleNodeConfig;
  workflowRuntimeProfile: RuntimeProfileId;
  onChange: (patch: Partial<AgentRoleNodeConfig>) => void;
}) {
  const selectedRuntimeProfile = role.runtimeProfileOverride ?? workflowRuntimeProfile;
  const usesPremiumRealtime = selectedRuntimeProfile === "premium-realtime";
  const selectedModelProvider = role.modelProvider ?? "openai";
  const selectedModelId = textModelPresets[selectedModelProvider].includes(role.modelId ?? "")
    ? role.modelId ?? ""
    : "";
  const selectedRealtimeProvider = role.realtimeProvider ?? "openai-realtime";
  const selectedRealtimeModelId = realtimeModelPresets[selectedRealtimeProvider].includes(role.realtimeModelId ?? "")
    ? role.realtimeModelId ?? ""
    : "";
  const updateRuntimeProfileOverride = (value: string) => {
    const runtimeProfileOverride =
      value === "__inherit__" ? undefined : (value as RuntimeProfileId);
    const nextRuntimeProfile = runtimeProfileOverride ?? workflowRuntimeProfile;

    onChange({
      runtimeProfileOverride,
      ...(nextRuntimeProfile === "premium-realtime"
        ? {
            realtimeVoiceConfig:
              role.realtimeVoiceConfig?.provider === selectedRealtimeProvider
                ? role.realtimeVoiceConfig
                : createRealtimeVoiceConfig(
                    selectedRealtimeProvider,
                    getDefaultRealtimeVoiceValue(selectedRealtimeProvider),
                  ),
          }
        : {
            realtimeProvider: undefined,
            realtimeModelId: undefined,
            realtimeVoiceConfig: undefined,
          }),
    });
  };
  const updateModelTier = (value: string) => {
    const nextTier = value as ModelTier;

    onChange({
      defaultModelTier: nextTier,
      modelId: getDefaultTextModelIdForTier(selectedModelProvider, nextTier),
    });
  };
  const updateModelProvider = (value: string) => {
    const nextProvider = value as TextModelProviderId;

    onChange({
      modelProvider: nextProvider,
      modelId: getDefaultTextModelIdForTier(nextProvider, role.defaultModelTier),
    });
  };

  return (
    <>
      {!usesPremiumRealtime ? (
        <>
          <label>
            <span>Model tier</span>
            <select value={role.defaultModelTier} onChange={(event) => updateModelTier(event.target.value)}>
              <option value="cheap">Cheap</option>
              <option value="standard">Standard</option>
              <option value="sota">SOTA</option>
            </select>
          </label>
          <label>
            <span>Model provider</span>
            <select
              value={selectedModelProvider}
              onChange={(event) => updateModelProvider(event.target.value)}
            >
              {textModelProviderOptions.map((provider) => (
                <option key={provider.value} value={provider.value}>
                  {provider.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Model</span>
            <select
              value={selectedModelId}
              onChange={(event) => {
                const nextModelId = event.target.value;

                onChange({
                  modelId: nextModelId.length > 0 ? nextModelId : undefined,
                });
              }}
            >
              <option value="">Auto by tier</option>
              {textModelPresets[selectedModelProvider].map((modelId) => (
                <option key={modelId} value={modelId}>
                  {modelId}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}
      <label>
        <span>Runtime profile override</span>
        <select
          value={role.runtimeProfileOverride ?? "__inherit__"}
          onChange={(event) => updateRuntimeProfileOverride(event.target.value)}
        >
          <option value="__inherit__">Inherit workflow</option>
          <option value="cost-optimized">Cost optimized</option>
          <option value="balanced">Balanced</option>
          <option value="premium-realtime">Premium realtime</option>
        </select>
      </label>
      {usesPremiumRealtime ? (
        <>
          <label>
            <span>Realtime provider</span>
            <select
              value={selectedRealtimeProvider}
              onChange={(event) => {
                const nextProvider = event.target.value as RealtimeProviderId;

                onChange({
                  realtimeProvider: nextProvider,
                  realtimeModelId: undefined,
                  realtimeVoiceConfig: createRealtimeVoiceConfig(
                    nextProvider,
                    getDefaultRealtimeVoiceValue(nextProvider),
                  ),
                });
              }}
            >
              {realtimeProviderOptions.map((provider) => (
                <option key={provider.value} value={provider.value}>
                  {provider.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Realtime model</span>
            <select
              value={selectedRealtimeModelId}
              onChange={(event) => {
                const nextModelId = event.target.value;

                onChange({
                  realtimeModelId: nextModelId.length > 0 ? nextModelId : undefined,
                });
              }}
            >
              <option value="">Provider default</option>
              {realtimeModelPresets[selectedRealtimeProvider].map((modelId) => (
                <option key={modelId} value={modelId}>
                  {modelId}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}
    </>
  );
}

function getDefaultTextModelIdForTier(provider: TextModelProviderId, tier: ModelTier) {
  const presets = textModelPresets[provider];

  switch (tier) {
    case "cheap":
      return presets[0];
    case "standard":
      return presets[1] ?? presets[0];
    case "sota":
      return presets[2] ?? presets[1] ?? presets[0];
  }
}

function AgentRoleLanguageSettings({
  role,
  onChange,
}: {
  role: AgentRoleNodeConfig;
  onChange: (patch: Partial<AgentRoleNodeConfig>) => void;
}) {
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const languagePrompts = role.languagePolicy.languagePrompts ?? {};
  const supportedLanguageSet = new Set(role.languagePolicy.supportedLanguages);
  const selectedLanguageLabels: string[] = [];
  for (const language of languageOptions) {
    if (supportedLanguageSet.has(language.value)) {
      selectedLanguageLabels.push(language.label);
    }
  }
  const languageSummary = selectedLanguageLabels.length > 0 ? selectedLanguageLabels.join(", ") : "Select languages";
  const updateSupportedLanguage = (language: string, selected: boolean) => {
    const supportedLanguages = role.languagePolicy.supportedLanguages;
    const nextSupportedLanguages = selected
      ? Array.from(new Set([...supportedLanguages, language]))
      : supportedLanguages.filter((supportedLanguage) => supportedLanguage !== language);

    if (nextSupportedLanguages.length === 0) {
      return;
    }

    onChange({
      languagePolicy: {
        ...role.languagePolicy,
        defaultLanguage: nextSupportedLanguages.includes(role.languagePolicy.defaultLanguage)
          ? role.languagePolicy.defaultLanguage
          : nextSupportedLanguages[0]!,
        supportedLanguages: nextSupportedLanguages,
      },
    });
  };

  return (
    <>
      <label>
        <span>Default language</span>
        <select
          value={role.languagePolicy.defaultLanguage}
          onChange={(event) =>
            onChange({
              languagePolicy: {
                ...role.languagePolicy,
                defaultLanguage: event.target.value,
              },
            })
          }
        >
          {languageOptions.map((language) => (
            <option key={language.value} value={language.value}>
              {language.label}
            </option>
          ))}
        </select>
      </label>
      <div className="workflow-form-field workflow-language-dropdown">
        <button
          className="workflow-language-trigger"
          type="button"
          aria-expanded={languageMenuOpen}
          aria-haspopup="menu"
          onClick={() => setLanguageMenuOpen((isOpen) => !isOpen)}
        >
          <span>Supported languages</span>
          <strong>{languageSummary}</strong>
        </button>
        {languageMenuOpen ? (
          <div className="workflow-language-menu" aria-label="Supported languages">
            {languageOptions.map((language) => (
              <label className="workflow-checkbox" key={language.value}>
                <input
                  checked={supportedLanguageSet.has(language.value)}
                  type="checkbox"
                  onChange={(event) => updateSupportedLanguage(language.value, event.target.checked)}
                />
                <span>{language.label}</span>
              </label>
            ))}
          </div>
        ) : null}
      </div>
      <label className="workflow-checkbox">
        <input
          checked={role.languagePolicy.allowMidCallSwitching}
          type="checkbox"
          onChange={(event) =>
            onChange({
              languagePolicy: {
                ...role.languagePolicy,
                allowMidCallSwitching: event.target.checked,
              },
            })
          }
        />
        <span>Allow language switching</span>
      </label>
      <label>
        <span>English prompt</span>
        <textarea
          value={languagePrompts.en ?? ""}
          rows={3}
          onChange={(event) =>
            onChange({
              languagePolicy: {
                ...role.languagePolicy,
                languagePrompts: {
                  ...languagePrompts,
                  en: event.target.value,
                },
              },
            })
          }
        />
      </label>
    </>
  );
}

function ToolInspector({
  integrationConnections,
  toolGrants,
  toolCatalogItems,
  tool,
  toolId,
  onChange,
}: {
  integrationConnections: IntegrationConnection[];
  toolGrants: ToolGrant[];
  toolCatalogItems: ToolCatalogItem[];
  tool: ToolNodeConfig;
  toolId: string;
  onChange: (patch: ToolInspectorPatch) => void;
}) {
  const activeAgentToolGrants = toolGrants.filter(
    (grant) => grant.status === "active" && (grant.capability ?? "agent-tool") === "agent-tool",
  );
  const grantsByToolId = new Map<string, ToolGrant[]>();

  for (const grant of activeAgentToolGrants) {
    grantsByToolId.set(grant.toolId, [...(grantsByToolId.get(grant.toolId) ?? []), grant]);
  }

  const connectorsWithActiveGrants = new Set(
    toolCatalogItems.filter((item) => grantsByToolId.has(item.toolId)).map((item) => item.connector),
  );
  const configuredToolCatalogItems = toolCatalogItems.filter(
    (item) =>
      grantsByToolId.has(item.toolId)
      || (!connectorsWithActiveGrants.has(item.connector) && hasConnectedIntegrationForTool(item, integrationConnections)),
  );
  const providerOptions = getToolProviderOptions(configuredToolCatalogItems);
  const selectedProvider = providerOptions.some((provider) => provider.connector === tool.connector)
    ? tool.connector
    : providerOptions[0]?.connector ?? tool.connector;
  const toolsForProvider = providerOptions.find((provider) => provider.connector === selectedProvider)?.tools ?? [];
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const selectedToolId = toolsForProvider.some((item) => item.toolId === toolId)
    ? toolId
    : toolsForProvider[0]?.toolId ?? "";
  const selectedToolIds = new Set([
    ...(selectedToolId.length > 0 ? [selectedToolId] : []),
    ...(tool.additionalTools ?? []).map((additionalTool) => additionalTool.toolId),
  ].filter((candidate) => toolsForProvider.some((item) => item.toolId === candidate)));
  const selectedConnection = tool.integrationConnectionId === undefined
    ? undefined
    : {
        id: tool.integrationConnectionId,
        label: tool.integrationLabel ?? tool.integrationConnectionId,
        status: tool.connectionStatus,
      };
  const providerGrantConnectionIds = new Set(
    toolsForProvider.flatMap((item) =>
      (grantsByToolId.get(item.toolId) ?? []).map((grant) => grant.integrationConnectionId),
    ),
  );
  const providerConnectionOptions = getIntegrationOptionsForConnector(selectedProvider, {
    connections: integrationConnections,
    selectedConnection,
  });
  const providerConnectedConnectionIds = new Set(
    providerConnectionOptions.filter((connection) => connection.status === "connected").map((connection) => connection.value),
  );
  const providerAllowedConnectionIds = new Set([...providerGrantConnectionIds, ...providerConnectedConnectionIds]);
  const selectedToolGrant = (selectedToolId.length > 0 ? grantsByToolId.get(selectedToolId) : undefined)?.find(
    (grant) => grant.integrationConnectionId === tool.integrationConnectionId,
  ) ?? (selectedToolId.length > 0 ? grantsByToolId.get(selectedToolId)?.[0] : undefined);
  const connections = providerConnectionOptions.filter((connection) => providerAllowedConnectionIds.has(connection.value));
  const defaultConnectionValue = connections.find((connection) => connection.status === "connected")?.value;
  const isToolAvailableForConnection = (catalogItem: ToolCatalogItem, connectionId: string) => {
    if (!catalogItem.requiresAuthorization) {
      return true;
    }

    const grants = grantsByToolId.get(catalogItem.toolId) ?? [];

    if (grants.length > 0) {
      return grants.some((grant) => grant.integrationConnectionId === connectionId);
    }

    return connectionId !== "__missing__" && providerAllowedConnectionIds.has(connectionId);
  };
  const selectedConnectionValue =
    tool.integrationConnectionId !== undefined
    && tool.connectionStatus !== "missing"
    && providerAllowedConnectionIds.has(tool.integrationConnectionId)
      ? tool.integrationConnectionId
      : selectedToolGrant?.integrationConnectionId ?? defaultConnectionValue ?? "__missing__";
  const toolsForConnection = toolsForProvider.filter((item) => isToolAvailableForConnection(item, selectedConnectionValue));
  const selectedTools = toolsForConnection.filter((item) => selectedToolIds.has(item.toolId));
  const selectedTool = selectedTools[0] ?? (selectedToolId.length > 0
    ? toolsForProvider.find((item) => item.toolId === selectedToolId)
    : undefined);
  const selectedToolGrants = selectedTools
    .map((item) => (grantsByToolId.get(item.toolId) ?? []).find((grant) => grant.integrationConnectionId === selectedConnectionValue))
    .filter((grant): grant is ToolGrant => grant !== undefined);
  const selectedRisk = selectedToolGrants.length > 0
    ? getHighestRisk(selectedToolGrants.map((grant) => grant.risk))
    : selectedTools.length > 0
      ? getHighestRisk(selectedTools.map((item) => item.risk))
      : tool.risk;
  const selectedRequiresHumanApproval = selectedToolGrants.length > 0
    ? selectedToolGrants.some((grant) => grant.approvalRequired)
    : selectedTools.length > 0
      ? selectedTools.some((item) => item.requiresHumanApproval)
      : tool.requiresHumanApproval;
  const toolsSummary =
    selectedTools.length === 0
      ? "No configured tools"
      : selectedTools.length === 1
        ? selectedTools[0]!.toolName
        : `${selectedTools.length} selected`;
  const applyConfiguredTool = (
    catalogItem: ToolCatalogItem,
    grant: ToolGrant | undefined,
    additionalTools: NonNullable<ToolNodeConfig["additionalTools"]> = [],
    connectionId = selectedConnectionValue,
  ) => {
    onChange({
      toolId: catalogItem.toolId,
      ...createConfiguredToolConfig(catalogItem, grant, integrationConnections, connectionId),
      additionalTools,
    });
  };
  const applyConfiguredToolSelection = (toolIds: string[], connectionId = selectedConnectionValue) => {
    const nextToolItems = toolIds
      .map((nextToolId) => toolsForProvider.find((item) => item.toolId === nextToolId))
      .filter((item): item is ToolCatalogItem => item !== undefined)
      .filter((item) => isToolAvailableForConnection(item, connectionId));
    const primaryTool = nextToolItems[0];

    if (primaryTool === undefined) {
      return;
    }

    const primaryGrant = (grantsByToolId.get(primaryTool.toolId) ?? []).find(
      (grant) => grant.integrationConnectionId === connectionId,
    );
    const additionalTools = nextToolItems.slice(1).map((item) =>
      createAdditionalToolConfig(
        item,
        (grantsByToolId.get(item.toolId) ?? []).find((grant) => grant.integrationConnectionId === connectionId),
      ),
    );

    applyConfiguredTool(primaryTool, primaryGrant, additionalTools, connectionId);
  };

  useEffect(() => {
    if (selectedTool !== undefined && selectedToolId !== toolId) {
      applyConfiguredToolSelection([selectedTool.toolId]);
    }
  });

  return (
    <div className="workflow-form">
      <label>
        <span>Provider</span>
        <select
          value={selectedProvider}
          disabled={providerOptions.length === 0}
          onChange={(event) => {
            const nextTool =
              providerOptions.find((provider) => provider.connector === event.target.value)?.tools[0];

            if (nextTool === undefined) {
              return;
            }

            applyConfiguredTool(nextTool, grantsByToolId.get(nextTool.toolId)?.[0]);
          }}
        >
          {providerOptions.length === 0 ? <option value={selectedProvider}>No configured providers</option> : null}
          {providerOptions.map((provider) => (
            <option key={provider.connector} value={provider.connector}>
              {provider.label}
            </option>
          ))}
        </select>
      </label>
      <div className="workflow-form-field workflow-language-dropdown">
        <button
          className="workflow-language-trigger"
          type="button"
          aria-expanded={toolsMenuOpen}
          aria-haspopup="menu"
          disabled={toolsForConnection.length === 0}
          onClick={() => setToolsMenuOpen((isOpen) => !isOpen)}
        >
          <span>Tools</span>
          <strong>{toolsSummary}</strong>
        </button>
        {toolsMenuOpen ? (
          <div className="workflow-language-menu" aria-label="Tools">
            {toolsForConnection.map((item) => {
              const checked = selectedToolIds.has(item.toolId);
              const canUncheck = selectedToolIds.size > 1;

              return (
                <label className="workflow-checkbox" key={item.toolId}>
                  <input
                    checked={checked}
                    disabled={checked && !canUncheck}
                    type="checkbox"
                    onChange={(event) => {
                      const nextToolIds = event.target.checked
                        ? [...selectedToolIds, item.toolId]
                        : [...selectedToolIds].filter((selectedId) => selectedId !== item.toolId);

                      applyConfiguredToolSelection(nextToolIds);
                    }}
                  />
                  <span>{item.toolName}</span>
                </label>
              );
            })}
          </div>
        ) : null}
      </div>
      {tool.requiresAuthorization ? (
        <label>
          <span>Connection</span>
          <select
            value={selectedConnectionValue}
            disabled={connections.length === 0}
            onChange={(event) => {
              const selectedValue = event.target.value;
              const connection = connections.find((option) => option.value === selectedValue);

              if (selectedValue === "__missing__" || connection === undefined) {
                onChange({ clearConnection: true });
                return;
              }

              const nextToolsForConnection = toolsForProvider.filter((item) =>
                isToolAvailableForConnection(item, connection.value),
              );
              const retainedToolIds = [...selectedToolIds].filter((selectedId) =>
                nextToolsForConnection.some((item) => item.toolId === selectedId),
              );

              applyConfiguredToolSelection(
                retainedToolIds.length > 0 ? retainedToolIds : nextToolsForConnection.slice(0, 1).map((item) => item.toolId),
                connection.value,
              );
            }}
          >
            <option value="__missing__">Not connected</option>
            {connections.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label>
          <span>Connection</span>
          <input value="No connection required" readOnly />
        </label>
      )}
      <label>
        <span>Risk posture</span>
        <input value={formatRiskLabel(selectedRisk)} readOnly />
      </label>
      <div className="workflow-tool-policy-summary" aria-label="Tool access policy">
        <div className="workflow-summary-row">
          <span>Account authorization</span>
          <strong>{(selectedTool?.requiresAuthorization ?? tool.requiresAuthorization) ? "Required" : "Not required"}</strong>
        </div>
        <div className="workflow-summary-row">
          <span>Human approval</span>
          <strong>{selectedRequiresHumanApproval ? "Required" : "Not required"}</strong>
        </div>
      </div>
    </div>
  );
}

function createConfiguredToolConfig(
  catalogItem: ToolCatalogItem,
  grant: ToolGrant | undefined,
  integrationConnections: IntegrationConnection[],
  connectionId?: string,
) {
  const config = createToolConfigFromCatalogItem(catalogItem, integrationConnections);

  if (grant === undefined) {
    const connection = connectionId === undefined || connectionId === "__missing__"
      ? undefined
      : getIntegrationOptionsForConnector(catalogItem.connector, {
          connections: integrationConnections,
        }).find((option) => option.value === connectionId);

    return connection === undefined
      ? config
      : {
          ...config,
          integrationConnectionId: connection.value,
          integrationLabel: connection.label,
          connectionStatus: connection.status,
        } satisfies ToolNodeConfig;
  }

  const connection = getIntegrationOptionsForConnector(catalogItem.connector, {
    connections: integrationConnections,
  }).find((option) => option.value === grant.integrationConnectionId);

  return {
    ...config,
    integrationConnectionId: grant.integrationConnectionId,
    integrationLabel: connection?.label ?? config.integrationLabel ?? grant.integrationConnectionId,
    connectionStatus: connection?.status ?? config.connectionStatus,
    risk: grant.risk,
    requiresHumanApproval: grant.approvalRequired,
  } satisfies ToolNodeConfig;
}

function hasConnectedIntegrationForTool(catalogItem: ToolCatalogItem, integrationConnections: IntegrationConnection[]) {
  if (!catalogItem.requiresAuthorization) {
    return true;
  }

  return getIntegrationOptionsForConnector(catalogItem.connector, { connections: integrationConnections }).some(
    (connection) => connection.status === "connected",
  );
}

function createAdditionalToolConfig(
  catalogItem: ToolCatalogItem,
  grant: ToolGrant | undefined,
): NonNullable<ToolNodeConfig["additionalTools"]>[number] {
  return {
    toolId: catalogItem.toolId,
    toolName: catalogItem.toolName,
    risk: grant?.risk ?? catalogItem.risk,
    requiresHumanApproval: grant?.approvalRequired ?? catalogItem.requiresHumanApproval,
    ...(catalogItem.request !== undefined ? { request: cloneToolRequest(catalogItem.request) } : {}),
  };
}

function getHighestRisk(risks: Array<ToolNodeConfig["risk"]>): ToolNodeConfig["risk"] {
  if (risks.includes("high")) {
    return "high";
  }

  if (risks.includes("medium")) {
    return "medium";
  }

  return "low";
}

function formatRiskLabel(risk: ToolNodeConfig["risk"]) {
  switch (risk) {
    case "low":
      return "Low";
    case "medium":
      return "Medium";
    case "high":
      return "High";
  }
}

function EscalationInspector({
  escalation,
  onChange,
}: {
  escalation: HumanEscalationNodeConfig;
  onChange: (patch: Partial<HumanEscalationNodeConfig>) => void;
}) {
  return (
    <div className="workflow-form">
      <label>
        <span>Queue</span>
        <select
          value={escalation.queueId}
          onChange={(event) => {
            const queue = queueOptions.find((option) => option.queueId === event.target.value);
            onChange({
              queueId: queue?.queueId ?? "",
              queueName: queue?.queueName ?? "",
              fallbackMode: queue?.fallbackMode ?? escalation.fallbackMode,
            });
          }}
        >
          <option value="">Select queue</option>
          {queueOptions.map((queue) => (
            <option key={queue.queueId} value={queue.queueId}>
              {queue.queueName}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Fallback mode</span>
        <select value={escalation.fallbackMode} onChange={(event) => onChange({ fallbackMode: event.target.value as EscalationFallbackMode })}>
          <option value="callback">Callback</option>
          <option value="voicemail">Voicemail</option>
          <option value="ticket">Ticket</option>
        </select>
      </label>
      <label>
        <span>Fallback message</span>
        <textarea value={escalation.fallbackMessage} rows={4} onChange={(event) => onChange({ fallbackMessage: event.target.value })} />
      </label>
    </div>
  );
}

function EndInspector({
  end,
  onChange,
}: {
  end: EndNodeConfig;
  onChange: (patch: Partial<EndNodeConfig>) => void;
}) {
  return (
    <div className="workflow-form">
      <label>
        <span>Outcome</span>
        <select value={end.outcome} onChange={(event) => onChange({ outcome: event.target.value as EndNodeConfig["outcome"] })}>
          <option value="resolved">Resolved</option>
          <option value="voicemail">Voicemail</option>
          <option value="failed">Failed</option>
        </select>
      </label>
      <label>
        <span>Closing message</span>
        <textarea value={end.closingMessage} rows={4} onChange={(event) => onChange({ closingMessage: event.target.value })} />
      </label>
    </div>
  );
}

function NodeSummary({ node }: { node: BuilderNode | undefined }) {
  if (node === undefined) {
    return <div className="workflow-muted-panel">Select a node to inspect its runtime contract.</div>;
  }

  return (
    <div className="workflow-muted-panel">
      <div className="workflow-summary-row">
        <span>Type</span>
        <strong>{getNodeKindLabel(node.data.kind)}</strong>
      </div>
      <div className="workflow-summary-row">
        <span>Position</span>
        <strong>
          {Math.round(node.position.x)}, {Math.round(node.position.y)}
        </strong>
      </div>
    </div>
  );
}

function createBuilderAgentNode(input: {
  id: string;
  label: string;
  position: { x: number; y: number };
  role: AgentRoleNodeConfig;
}): BuilderNode {
  const workflowNode = createAgentRoleNode(input);
  const role = workflowNode.config["role"] as AgentRoleNodeConfig;

  return {
    id: workflowNode.id,
    type: "builderNode",
    position: workflowNode.position,
      data: {
        kind: "agent",
        label: workflowNode.label,
      badge: formatAgentModelBadge(role),
      subtitle: role.languagePolicy.supportedLanguages.join(" + ") || "No language set",
      role,
    },
  };
}

function buildAgentRouteTargetOptions(nodes: BuilderNode[], sourceAgentId: string): AgentRouteTargetOption[] {
  return nodes.flatMap((node) => {
    if (node.id === sourceAgentId || node.data.kind !== "agent" || node.data.role === undefined) {
      return [];
    }

    const role = node.data.role;
    const roleName = role.name.trim();

    return [{
      agentId: node.id,
      label: roleName || node.data.label,
      roleKind: role.kind,
      roleName,
    }];
  });
}

function buildAgentRouteFallbackOptions(input: {
  nodes: BuilderNode[];
  sourceAgentId: string;
  sourceAgentName: string;
}): AgentRouteFallbackOption[] {
  const options: AgentRouteFallbackOption[] = [
    {
      label: `Keep with ${input.sourceAgentName}`,
      target: { type: "clarify_source_agent" },
      value: "clarify_source_agent",
    },
  ];

  for (const target of buildAgentRouteTargetOptions(input.nodes, input.sourceAgentId)) {
    options.push({
      label: target.label,
      target: { type: "agent", agentId: target.agentId },
      value: `agent:${target.agentId}`,
    });
  }

  for (const node of input.nodes) {
    if (node.data.kind === "human-escalation" && node.data.escalation !== undefined) {
      const queueId = node.data.escalation.queueId;
      options.push({
        label: node.data.escalation.queueName || node.data.label,
        target: { type: "human_escalation", queueId },
        value: `human_escalation:${queueId}`,
      });
    }

    if (node.data.kind === "end" && node.data.end !== undefined) {
      options.push({
        label: node.data.label,
        target: { type: "exit", exitNodeId: node.id },
        value: `exit:${node.id}`,
      });
    }
  }

  return options;
}

function createDefaultAgentRoutePolicy(routeTargetOptions: AgentRouteTargetOption[]): AgentRoutePolicyConfig {
  const firstTarget = routeTargetOptions[0];

  return {
    type: "route_by_intent",
    trigger: "on_caller_turn_end",
    activation: "until_routed",
    classifier: {
      mode: "standard",
      modelAlias: "intent-classifier-fast",
      confidenceThreshold: 0.65,
    },
    inputWindow: {
      latestCallerTurn: true,
      recentTranscriptTurns: 6,
      includeConversationSummary: true,
      includePreviousAgentContext: true,
      includeRecentToolResults: true,
    },
    readiness: {
      mode: "auto_with_clarification",
      maxClarificationTurns: 2,
    },
    announcement: {
      mode: "template",
      text: "Got it, I'll be routing you to {targetAgentName} from {branchName}.",
    },
    branches: firstTarget === undefined ? [] : [createDefaultAgentRouteBranch(firstTarget)],
    fallback: {
      label: "Clarify need",
      target: { type: "clarify_source_agent" },
    },
  };
}

function createDefaultAgentRouteBranch(target: AgentRouteTargetOption): AgentRoutePolicyBranchConfig {
  const profile = resolveAgentRouteRoleProfile({
    kind: target.roleKind,
    name: target.roleName,
    label: target.label,
  });

  return {
    id: createAgentRouteBranchId(target),
    label: profile.label,
    intentKey: profile.intentKey,
    description: profile.description,
    examples: profile.examples,
    target: {
      type: "agent",
      agentId: target.agentId,
    },
  };
}

function createAgentRouteBranchId(target: AgentRouteTargetOption): string {
  return `branch-${resolveAgentRouteRoleProfile({
    kind: target.roleKind,
    name: target.roleName,
    label: target.label,
  }).intentKey}`;
}

function slugifyAgentRouteValue(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug.length > 0 ? slug : "route";
}

function splitAgentRouteExamples(value: string): string[] {
  return value
    .split(/[;\n]/)
    .map((example) => example.trim())
    .filter((example) => example.length > 0);
}

function formatAgentRouteFallbackValue(target: AgentRoutePolicyTarget): string {
  switch (target.type) {
    case "agent":
      return `agent:${target.agentId}`;
    case "human_escalation":
      return `human_escalation:${target.queueId}`;
    case "exit":
      return `exit:${target.exitNodeId}`;
    case "clarify_source_agent":
      return "clarify_source_agent";
    default:
      return "clarify_source_agent";
  }
}

function applySpecialistRoleTemplateForCurrentNode(
  template: SpecialistRoleTemplate,
  currentRole: AgentRoleNodeConfig | undefined,
): AgentRoleNodeConfig {
  const nextRole = applySpecialistRoleTemplate(template);

  if (currentRole?.routePolicy === undefined) {
    const { routePolicy: _routePolicy, ...regularRole } = nextRole;

    return regularRole;
  }

  return {
    ...nextRole,
    routePolicy: currentRole.routePolicy,
  };
}

function loadAllSpecialistRoleTemplates(): SpecialistRoleTemplate[] {
  try {
    const raw = window.localStorage.getItem(specialistTemplatesStorageKey);

    if (raw === null) {
      return [];
    }

    const parsed = JSON.parse(raw);

    return Array.isArray(parsed) ? (parsed as SpecialistRoleTemplate[]) : [];
  } catch {
    return [];
  }
}

function loadSpecialistRoleTemplatesForWorkspace(workspaceId: string): SpecialistRoleTemplate[] {
  const storedTemplates = loadAllSpecialistRoleTemplates().filter((template) => template.workspaceId === workspaceId);
  const defaultTemplates = createDefaultSpecialistRoleTemplatesForWorkspace(workspaceId);
  const storedIds = new Set(storedTemplates.map((template) => template.id));
  const storedNames = new Set(storedTemplates.map((template) => template.name.trim().toLocaleLowerCase()));

  return [
    ...storedTemplates,
    ...defaultTemplates.filter(
      (template) => !storedIds.has(template.id) && !storedNames.has(template.name.trim().toLocaleLowerCase()),
    ),
  ];
}

function createDefaultSpecialistRoleTemplatesForWorkspace(workspaceId: string): SpecialistRoleTemplate[] {
  const roles: Array<{ id: string; role: AgentRoleNodeConfig }> = [
    {
      id: "specialist-template-agent-front-desk",
      role: {
        kind: "receptionist",
        name: "Front desk triage",
        businessName: "Tuzzy Labs",
        instructions:
          "Greet callers, identify intent, collect account context, resolve routine reception requests, and route specialist work cleanly.",
        defaultModelTier: "cheap",
        languagePolicy: {
          defaultLanguage: "en",
          supportedLanguages: ["en", "fr"],
          allowMidCallSwitching: true,
        },
        reusableSpecialist: true,
      },
    },
    {
      id: "specialist-template-agent-billing",
      role: {
        kind: "billing",
        name: "Billing specialist",
        businessName: "Tuzzy Labs",
        instructions:
          "Resolve invoice disputes, explain charges, update billing notes, and escalate manager approvals when high-risk changes are requested.",
        defaultModelTier: "standard",
        languagePolicy: {
          defaultLanguage: "en",
          supportedLanguages: ["en"],
          allowMidCallSwitching: false,
        },
        reusableSpecialist: true,
      },
    },
  ];

  return roles.reduce<SpecialistRoleTemplate[]>(
    (templates, templateRole) => [
      ...templates,
      createSpecialistRoleTemplate({
        id: templateRole.id,
        workspaceId,
        role: templateRole.role,
        createdAt: defaultSpecialistTemplateCreatedAt,
        existingTemplates: templates,
      }),
    ],
    [],
  );
}

function saveSpecialistRoleTemplatesForWorkspace(
  workspaceId: string,
  templates: SpecialistRoleTemplate[],
) {
  const templatesById = new Map<string, SpecialistRoleTemplate>();

  for (const template of loadAllSpecialistRoleTemplates()) {
    if (template.workspaceId !== workspaceId) {
      templatesById.set(template.id, template);
    }
  }

  for (const template of templates) {
    templatesById.set(template.id, template);
  }

  window.localStorage.setItem(specialistTemplatesStorageKey, JSON.stringify([...templatesById.values()]));
}

function createBuilderToolNode(input: {
  id: string;
  label: string;
  position: { x: number; y: number };
  toolId: string;
  tool: ToolNodeConfig;
}): BuilderNode {
  const workflowNode = createToolNode(input);
  const tool = workflowNode.config["tool"] as ToolNodeConfig;

  return {
    id: workflowNode.id,
    type: "builderNode",
    position: workflowNode.position,
    data: {
      kind: "tool",
      label: workflowNode.label,
      badge: formatToolBadge(tool),
      subtitle: `${formatToolConnectorLabel(tool.connector)} - ${tool.request?.method ?? "HTTP"}`,
      tool,
      ...(workflowNode.toolId !== undefined ? { toolId: workflowNode.toolId } : {}),
    },
  };
}

function createBuilderEscalationNode(input: {
  id: string;
  label: string;
  position: { x: number; y: number };
  escalation: HumanEscalationNodeConfig;
}): BuilderNode {
  const workflowNode = createHumanEscalationNode(input);
  const escalation = workflowNode.config["escalation"] as HumanEscalationNodeConfig;

  return {
    id: workflowNode.id,
    type: "builderNode",
    position: workflowNode.position,
    data: {
      kind: "human-escalation",
      label: workflowNode.label,
      badge: escalation.queueName || "Queue required",
      subtitle: `${capitalize(escalation.fallbackMode)} fallback`,
      escalation,
    },
  };
}

function createBuilderEndNode(input: {
  id: string;
  label: string;
  position: { x: number; y: number };
  end: EndNodeConfig;
}): BuilderNode {
  const workflowNode = createEndNode(input);
  const end = workflowNode.config["end"] as EndNodeConfig;

  return {
    id: workflowNode.id,
    type: "builderNode",
    position: workflowNode.position,
    data: {
      kind: "end",
      label: workflowNode.label,
      badge: capitalize(end.outcome),
      subtitle: "Terminates this route",
      end,
    },
  };
}

function toBuilderCanvas(graph: WorkflowGraph): {
  nodes: BuilderNode[];
  edges: BuilderEdge[];
  selectedNodeId: string;
} {
  const supportedWorkflowNodes = graph.nodes.filter(isBuilderSupportedWorkflowNode);
  const builderNodes = supportedWorkflowNodes.length > 0
    ? supportedWorkflowNodes.map(toBuilderNode)
    : [createEntryBuilderNode()];
  const nodesById = new Map(builderNodes.map((node) => [node.id, node] as const));
  const builderEdges = graph.edges
    .filter((edge) => nodesById.has(edge.sourceNodeId) && nodesById.has(edge.targetNodeId))
    .map((edge) => toBuilderEdge(edge, nodesById.get(edge.sourceNodeId)));
  const selectedNodeId =
    builderNodes.find((node) => node.data.kind !== "entry")?.id
    ?? builderNodes[0]?.id
    ?? "entry";

  return {
    nodes: builderNodes,
    edges: builderEdges,
    selectedNodeId,
  };
}

function isBuilderSupportedWorkflowNode(node: WorkflowNode): boolean {
  return node.kind !== "handoff" && node.kind !== "condition";
}

function toBuilderNode(node: WorkflowNode): BuilderNode {
  if (node.kind === "entry") {
    return {
      id: node.id,
      type: "builderNode",
      position: node.position,
      data: {
        kind: "entry",
        label: node.label,
        badge: "Entry",
        subtitle: "Incoming caller",
        config: node.config,
      },
    };
  }

  if (node.kind === "agent") {
    const role = node.config["role"] as AgentRoleNodeConfig | undefined;

    return role === undefined
      ? createGenericBuilderNode(node)
      : createBuilderAgentNode({
          id: node.id,
          label: node.label,
          position: node.position,
          role,
        });
  }

  if (node.kind === "tool") {
    const tool = node.config["tool"] as ToolNodeConfig | undefined;

    return tool === undefined || node.toolId === undefined
      ? createGenericBuilderNode(node)
      : createBuilderToolNode({
          id: node.id,
          label: node.label,
          position: node.position,
          toolId: node.toolId,
          tool,
        });
  }

  if (node.kind === "human-escalation") {
    const escalation = node.config["escalation"] as HumanEscalationNodeConfig | undefined;

    return escalation === undefined
      ? createGenericBuilderNode(node)
      : createBuilderEscalationNode({
          id: node.id,
          label: node.label,
          position: node.position,
          escalation,
        });
  }

  if (node.kind === "end") {
    const end = node.config["end"] as EndNodeConfig | undefined;

    return end === undefined
      ? createGenericBuilderNode(node)
      : createBuilderEndNode({
          id: node.id,
          label: node.label,
          position: node.position,
          end,
        });
  }

  return createGenericBuilderNode(node);
}

function createGenericBuilderNode(node: WorkflowNode): BuilderNode {
  return {
    id: node.id,
    type: "builderNode",
    position: node.position,
    data: {
      kind: node.kind,
      label: node.label,
      badge: getNodeKindLabel(node.kind),
      subtitle: "Loaded workflow node",
      config: node.config,
      ...(node.toolId !== undefined ? { toolId: node.toolId } : {}),
    },
  };
}

function toBuilderEdge(edge: WorkflowGraph["edges"][number], sourceNode: BuilderNode | undefined): BuilderEdge {
  return applyBuilderEdgeKind({
    edge: applyBuilderEdgeHandleRoles(
      {
        id: edge.id,
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
        ...(edge.condition !== undefined ? { label: edge.condition } : {}),
        ...(edge.kind === "return" ? { data: { kind: edge.kind } } : {}),
      },
      edge.sourceHandleRole ?? "flow-source",
      edge.targetHandleRole ?? "flow-target",
    ),
    kind: edge.kind ?? "flow",
    sourceNode,
    preserveLabel: true,
  });
}

function toWorkflowGraph(workflowGraphId: string, nodes: BuilderNode[], edges: BuilderEdge[], name: string): WorkflowGraph {
  return createWorkflowGraph({
    id: workflowGraphId,
    name,
    nodes: nodes.map(toWorkflowNode),
    edges: edges.map((edge) => {
      const workflowEdge = {
        id: edge.id,
        sourceNodeId: edge.source,
        targetNodeId: edge.target,
        ...(edge.data?.kind === "return" ? { kind: edge.data.kind } : {}),
        sourceHandleRole: toWorkflowRelationshipSourceHandleRole(edge.sourceHandle),
        targetHandleRole: toWorkflowRelationshipTargetHandleRole(edge.targetHandle),
      };

      if (typeof edge.label !== "string") {
        return workflowEdge;
      }

      return {
        ...workflowEdge,
        condition: edge.label,
      };
    }),
  });
}

function toWorkflowNode(node: BuilderNode): WorkflowNode {
  if (node.data.kind === "agent" && node.data.role !== undefined) {
    return createAgentRoleNode({
      id: node.id,
      label: node.data.label,
      position: node.position,
      role: node.data.role,
    });
  }

  if (node.data.kind === "tool" && node.data.tool !== undefined && node.data.toolId !== undefined) {
    return createToolNode({
      id: node.id,
      label: node.data.label,
      position: node.position,
      toolId: node.data.toolId,
      tool: node.data.tool,
    });
  }

  if (node.data.kind === "human-escalation" && node.data.escalation !== undefined) {
    return createHumanEscalationNode({
      id: node.id,
      label: node.data.label,
      position: node.position,
      escalation: node.data.escalation,
    });
  }

  if (node.data.kind === "end" && node.data.end !== undefined) {
    return createEndNode({
      id: node.id,
      label: node.data.label,
      position: node.position,
      end: node.data.end,
    });
  }

  const workflowNode: WorkflowNode = {
    id: node.id,
    kind: node.data.kind,
    label: node.data.label,
    position: node.position,
    config: node.data.config ?? {},
  };

  if (node.data.toolId !== undefined) {
    workflowNode.toolId = node.data.toolId;
  }

  return workflowNode;
}

interface BuilderRelationshipRepairResult {
  nodes: BuilderNode[];
  edges: BuilderEdge[];
  repairCount: number;
}

function canRepairBuilderRelationships(
  nodes: BuilderNode[],
  edges: BuilderEdge[],
  errors: RuntimeManifestPreview["validation"]["errors"],
): boolean {
  if (errors.some((error) => isRepairableRelationshipCode(error.code))) {
    return true;
  }

  return repairBuilderRelationships(nodes, edges).repairCount > 0;
}

function repairBuilderRelationships(nodes: BuilderNode[], edges: BuilderEdge[]): BuilderRelationshipRepairResult {
  let repairCount = 0;
  let repairedEdges = repairBuilderEdges(nodes, edges, () => {
    repairCount += 1;
  });

  return {
    nodes,
    edges: repairedEdges,
    repairCount,
  };
}

function repairBuilderEdges(
  nodes: BuilderNode[],
  edges: BuilderEdge[],
  onRepair: () => void,
): BuilderEdge[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));
  const repairedEdges: BuilderEdge[] = [];

  for (const edge of edges) {
    const sourceNode = nodesById.get(edge.source);
    const targetNode = nodesById.get(edge.target);

    if (sourceNode === undefined || targetNode === undefined) {
      onRepair();
      continue;
    }

    const decision = getBuilderPolicyDecision({
      nodes,
      edges,
      sourceId: edge.source,
      targetId: edge.target,
      requestedEdgeKind: edge.data?.kind === "return" ? "return" : "flow",
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      strictHandleRoles: false,
    });

    if (decision.kind === null) {
      onRepair();
      continue;
    }

    const repairedEdge = applyBuilderEdgeKind({
      edge: applyBuilderEdgeHandleRoles(edge, decision.sourceHandleRole, decision.targetHandleRole),
      kind: decision.kind,
      sourceNode,
      preserveLabel: true,
    });

    if (serializeBuilderEdges([repairedEdge]) !== serializeBuilderEdges([edge])) {
      onRepair();
    }

    repairedEdges.push(repairedEdge);
  }

  return ensurePolicyCompanionEdges(nodes, repairedEdges, onRepair);
}

function ensurePolicyCompanionEdges(
  nodes: BuilderNode[],
  edges: BuilderEdge[],
  onRepair: () => void,
): BuilderEdge[] {
  let repairedEdges = edges;
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));

  for (const edge of edges) {
    const sourceNode = nodesById.get(edge.source);
    const targetNode = nodesById.get(edge.target);

    if (sourceNode === undefined || targetNode === undefined || edge.data?.kind === "return") {
      continue;
    }

    const decision = getBuilderPolicyDecision({
      nodes,
      edges: repairedEdges,
      sourceId: edge.source,
      targetId: edge.target,
      requestedEdgeKind: "flow",
      strictHandleRoles: false,
    });

    if (decision.kind === null) {
      continue;
    }

    for (const companionEdge of decision.autoCreateCompanionEdges) {
      const companionSourceNode = companionEdge.source === "source" ? sourceNode : targetNode;
      const companionTargetNode = companionEdge.target === "source" ? sourceNode : targetNode;
      const companionExists = repairedEdges.some(
        (candidate) =>
          candidate.source === companionSourceNode.id &&
          candidate.target === companionTargetNode.id &&
          (candidate.data?.kind ?? "flow") === companionEdge.edgeKind,
      );

      if (companionExists) {
        continue;
      }

      repairedEdges = [
        ...repairedEdges,
        applyBuilderEdgeKind({
          edge: applyBuilderEdgeHandleRoles(
            {
              id: buildEdgeId(companionSourceNode.id, companionTargetNode.id, repairedEdges),
              source: companionSourceNode.id,
              target: companionTargetNode.id,
              ...(companionEdge.condition !== undefined ? { label: companionEdge.condition } : {}),
            },
            companionEdge.sourceHandleRole,
            companionEdge.targetHandleRole,
          ),
          kind: companionEdge.edgeKind,
          sourceNode: companionSourceNode,
          preserveLabel: false,
        }),
      ];
      onRepair();
    }
  }

  return repairedEdges;
}

function isRepairableRelationshipCode(code: string): boolean {
  return (
    code.startsWith("relationship.") ||
    code === "workflow.edge_missing_source" ||
    code === "workflow.edge_missing_target" ||
    code === "workflow.unreachable_node"
  );
}

function serializeBuilderEdges(edges: BuilderEdge[]): string {
  return JSON.stringify(
    edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      kind: edge.data?.kind,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      label: edge.label,
      className: edge.className,
    })),
  );
}

function getMiniMapNodeKind(node: Node<Record<string, unknown>>): WorkflowNodeKind {
  const kind = node.data?.kind;

  switch (kind) {
    case "entry":
    case "agent":
    case "tool":
    case "human-escalation":
    case "end":
      return kind;
    default:
      return "agent";
  }
}

function getNodeIcon(kind: WorkflowNodeKind) {
  switch (kind) {
    case "entry":
      return PhoneCall;
    case "agent":
      return Bot;
    case "tool":
      return KeyRound;
    case "human-escalation":
      return Headphones;
    case "end":
      return PhoneOff;
    default:
      return Plus;
  }
}

function getNodeKindLabel(kind: WorkflowNodeKind) {
  switch (kind) {
    case "human-escalation":
      return "Human escalation";
    case "end":
      return "Exit";
    default:
      return kind.charAt(0).toUpperCase() + kind.slice(1);
  }
}

function formatModelTier(tier: ModelTier) {
  switch (tier) {
    case "cheap":
      return "Cheap tier";
    case "standard":
      return "Standard tier";
    case "sota":
      return "SOTA tier";
    default:
      return "Rules tier";
  }
}

function formatAgentModelBadge(role: AgentRoleNodeConfig) {
  if (role.routePolicy !== undefined) {
    return "Routes";
  }

  const provider = textModelProviderOptions.find((option) => option.value === role.modelProvider);

  return provider?.value === "google-gemini" ? provider.badge : formatModelTier(role.defaultModelTier);
}

function formatValidationTitle(code: string) {
  switch (code) {
    case "workflow.missing_entry":
      return "Add an entry point";
    case "workflow.unreachable_node":
      return "Reconnect or remove this node";
    case "workflow.unsafe_cycle":
      return "Close the looping path";
    case "workflow.edge_missing_source":
    case "workflow.edge_missing_target":
      return "Reconnect a broken edge";
    case "agent.missing_name":
      return "Name this agent";
    case "agent.missing_business_name":
      return "Add the business name";
    case "agent.missing_instructions":
      return "Add agent instructions";
    case "agent.missing_model_tier":
      return "Choose a model tier";
    case "agent.missing_default_language":
    case "agent.missing_supported_language":
    case "agent.duplicate_language":
    case "agent.default_language_not_supported":
    case "agent.missing_language_prompt":
      return "Finish the language setup";
    case "tool.missing_binding":
      return "Choose a tool action";
    case "tool.missing_authorization":
    case "tool.revoked_connection":
      return "Reconnect this tool";
    case "tool.missing_request_method":
    case "tool.missing_request_url":
    case "tool.missing_request_auth_token":
    case "tool.missing_request_headers":
      return "Finish the API request setup";
    case "escalation.missing_queue":
      return "Choose an escalation queue";
    case "escalation.missing_fallback_message":
      return "Add the escalation fallback message";
    default:
      return "Finish this workflow step";
  }
}

function getWorkflowPublishErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    return error.message;
  }

  return "Workflow publish failed. Try again after checking validation.";
}

function formatValidationDetail(
  code: string,
  suggestion: string | undefined,
  nodeId: string | undefined,
  edgeId: string | undefined,
  nodeLabelById: Map<string, string>,
) {
  const nodeLabel = nodeId !== undefined ? nodeLabelById.get(nodeId) ?? nodeId : undefined;

  switch (code) {
    case "workflow.missing_entry":
      return "Add an inbound entry node so calls have a clear starting point.";
    case "workflow.unsafe_cycle":
      return "Add an exit or route break so callers cannot get trapped in a loop.";
    case "workflow.edge_missing_source":
    case "workflow.edge_missing_target":
      return edgeId !== undefined
        ? `Reconnect or remove ${edgeId} so every path has a valid source and destination.`
        : "Reconnect or remove the broken edge before publishing.";
    case "agent.missing_name":
      return nodeLabel !== undefined ? `Give ${nodeLabel} a clear working name.` : "Give this agent a clear working name.";
    case "agent.missing_business_name":
      return "Add the company, agency, or business name this agent represents on calls.";
    case "agent.missing_instructions":
      return nodeLabel !== undefined
        ? `Add instructions so ${nodeLabel} knows how to handle the caller.`
        : "Add instructions so this agent knows how to handle the caller.";
    case "agent.missing_model_tier":
      return "Pick the model tier this agent should use at runtime.";
    case "agent.missing_default_language":
    case "agent.missing_supported_language":
      return "Set the default language and at least one supported language.";
    case "agent.duplicate_language":
      return "Remove duplicate supported languages before publishing.";
    case "agent.default_language_not_supported":
      return "Keep the default fallback language in the supported-language list.";
    case "agent.missing_language_prompt":
      return "Fill in or remove the empty language-specific prompt.";
    case "tool.missing_binding":
      return "Choose the exact tool action this node should run.";
    case "tool.missing_authorization":
    case "tool.revoked_connection":
      return nodeLabel !== undefined
        ? `Reconnect ${nodeLabel} before this workflow can call it.`
        : "Reconnect this tool before the workflow can call it.";
    case "tool.missing_request_method":
    case "tool.missing_request_url":
    case "tool.missing_request_auth_token":
    case "tool.missing_request_headers":
      return nodeLabel !== undefined
        ? `Finish the API request setup for ${nodeLabel}.`
        : "Finish the API request setup for this tool node.";
    case "escalation.missing_queue":
      return "Choose the human queue this escalation should reach.";
    case "escalation.missing_fallback_message":
      return "Add the caller message used when no human picks up the escalation.";
    default:
      return suggestion;
  }
}

function formatToolBadge(tool: ToolNodeConfig) {
  if (tool.connectionStatus === "connected") {
    return tool.requiresHumanApproval ? "Approval gate" : "Connected";
  }

  if (tool.connectionStatus === "revoked") {
    return "Reconnect";
  }

  return "Needs auth";
}

function deriveRuntimeFromProfile(profile: RuntimeProfileId): VoiceRuntimeKind {
  return profile === "premium-realtime" ? "openai-realtime" : "sandwich-pipeline";
}

function buildWorkflowSandboxTelephonyRoutes(input: {
  state: TelephonyStateResponse | null;
  workspaceId: string;
  versions: PublishedWorkflowVersion[];
}): WorkflowSandboxTelephonyRoute[] {
  if (input.state === null || input.versions.length === 0) {
    return [];
  }

  const publishedVersionIds = new Set(input.versions.map((version) => version.id));
  const connectionsById = new Map(
    input.state.connections.map((connection) => [connection.id, connection] as const),
  );

  const routes: WorkflowSandboxTelephonyRoute[] = [];

  for (const phoneNumber of input.state.phoneNumbers) {
    if (
      phoneNumber.status !== "routed" ||
      phoneNumber.liveRoute?.workspaceId !== input.workspaceId ||
      !publishedVersionIds.has(phoneNumber.liveRoute.publishedVersionId)
    ) {
      continue;
    }

    const route = toWorkflowSandboxTelephonyRoute(phoneNumber, connectionsById.get(phoneNumber.connectionId));

    if (route !== null) {
      routes.push(route);
    }
  }

  return routes.sort((left, right) => left.friendlyName.localeCompare(right.friendlyName));
}

function toWorkflowSandboxTelephonyRoute(
  phoneNumber: ImportedTelephonyPhoneNumber,
  connection: TelephonyConnection | undefined,
): WorkflowSandboxTelephonyRoute | null {
  if (
    phoneNumber.liveRoute === undefined
    || connection === undefined
  ) {
    return null;
  }

  return {
    id: `${phoneNumber.id}:${phoneNumber.liveRoute.publishedVersionId}`,
    phoneNumberId: phoneNumber.id,
    phoneNumber: phoneNumber.phoneNumber,
    friendlyName: phoneNumber.friendlyName,
    workflowLabel: phoneNumber.liveRoute.workflowLabel,
    publishedVersionId: phoneNumber.liveRoute.publishedVersionId,
    connectionId: connection.id,
    connectionLabel: connection.label,
    ownershipMode: connection.ownershipMode,
    provider: connection.provider,
    recordingSummary: formatRecordingSummary(phoneNumber.recordingPolicy ?? connection.recordingPolicy),
  };
}

function formatRuntimeProfileLabel(profile: RuntimeProfileId) {
  switch (profile) {
    case "balanced":
      return "Balanced profile";
    case "premium-realtime":
      return "Premium realtime";
    default:
      return "Cost optimized";
  }
}

function formatVoiceProfileLabel(profile: RuntimeProfileId) {
  switch (profile) {
    case "balanced":
      return "Neural HD voice";
    case "premium-realtime":
      return "Expressive voice";
    default:
      return "Economy voice";
  }
}

function resolveWorkflowSandboxRuntimeDisplay(input: {
  manifest: CompiledRuntimeManifest | null;
  runtimePreview: RuntimeManifestPreview;
}): WorkflowSandboxRuntimeDisplay {
  const manifest = input.manifest;
  const entryRole =
    manifest === null ? undefined : manifest.roles.find((role) => role.id === manifest.entryRoleId);
  const effectiveRuntimeProfile = entryRole?.runtimeProfileOverride ?? input.runtimePreview.runtimeProfile;
  const voiceLabel = entryRole?.voiceConfig?.label ?? formatVoiceProfileLabel(effectiveRuntimeProfile);

  if (effectiveRuntimeProfile === "premium-realtime") {
    const realtimeProvider = entryRole?.realtimeProvider ?? "openai-realtime";
    const realtimeModelId = entryRole?.realtimeModelId?.trim();

    return {
      label: formatRealtimeProviderLabel(realtimeProvider),
      runtimeProfile: effectiveRuntimeProfile,
      isPremiumRealtime: true,
      voiceLabel,
      ...(realtimeModelId !== undefined && realtimeModelId.length > 0 ? { modelId: realtimeModelId } : {}),
    };
  }

  return {
    label: input.runtimePreview.runtime,
    runtimeProfile: effectiveRuntimeProfile,
    isPremiumRealtime: false,
    voiceLabel,
  };
}

function formatRealtimeProviderLabel(provider: RealtimeProviderId) {
  switch (provider) {
    case "gemini-live":
      return "Gemini Live";
    default:
      return "OpenAI Realtime";
  }
}

function formatWorkflowSandboxRealtimeDecisionCopy(display: WorkflowSandboxRuntimeDisplay) {
  const modelCopy = display.modelId !== undefined
    ? ` with ${display.modelId}`
    : " with the provider default model";

  return `${display.label}${modelCopy} is selected for premium realtime voice turns.`;
}

function isWorkflowSandboxCallInProgress(input: {
  agentPlaybackActive: boolean;
  status: LiveSandboxStatus;
  voiceTurnCapturing: boolean;
}) {
  return (
    input.status === "connecting"
    || input.status === "active"
    || input.voiceTurnCapturing
    || input.agentPlaybackActive
  );
}

function formatWorkflowSandboxStatus(
  status: LiveSandboxStatus,
  activity: { agentPlaybackActive: boolean; voiceTurnCapturing: boolean },
) {
  if (activity.voiceTurnCapturing) {
    return "Listening";
  }

  if (activity.agentPlaybackActive) {
    return "Agent responding";
  }

  switch (status) {
    case "connecting":
      return "Connecting";
    case "active":
      return "Active";
    case "error":
      return "Needs attention";
    case "ended":
      return "Ended";
    default:
      return "Idle";
  }
}

function formatWorkflowSandboxMicrophoneState(state: "idle" | "requesting" | "granted" | "denied" | "unsupported") {
  switch (state) {
    case "granted":
      return "Granted";
    case "denied":
      return "Denied";
    case "requesting":
      return "Requesting";
    case "unsupported":
      return "Unavailable";
    default:
      return "Optional";
  }
}

function formatWorkflowSandboxTime(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
}

function formatWorkflowSandboxModelDecision(decision: {
  tier: string;
  provider?: string | undefined;
  modelId?: string | undefined;
}) {
  const provider = decision.provider === "google-gemini"
    ? "Gemini"
    : decision.provider === "openai"
      ? "OpenAI"
      : undefined;

  if (provider !== undefined && decision.modelId !== undefined) {
    return `${provider} ${decision.modelId}`;
  }

  if (provider !== undefined) {
    return `${provider} ${decision.tier}`;
  }

  return decision.tier;
}

function formatRecordingSummary(policy: {
  enabled: boolean;
  consentMode: string;
}) {
  if (!policy.enabled || policy.consentMode === "disabled") {
    return "Recording off";
  }

  if (policy.consentMode === "two-party") {
    return "Two-party consent";
  }

  return "Single-party consent";
}

function formatTelephonyRouteRailLabel(
  route: Pick<WorkflowSandboxTelephonyRoute, "ownershipMode" | "provider">,
) {
  return `${formatOwnershipModeLabel(route.ownershipMode)} / ${formatProviderLabel(route.provider)}`;
}

function formatOwnershipModeLabel(ownershipMode: string) {
  switch (ownershipMode) {
    case "platform_managed":
      return "Platform";
    case "byo_provider_account":
      return "BYO";
    case "byo_sip_trunk":
      return "SIP";
    default:
      return ownershipMode;
  }
}

function formatProviderLabel(provider: string) {
  switch (provider) {
    case "twilio":
      return "Twilio";
    case "signalwire":
      return "SignalWire";
    case "telnyx":
      return "Telnyx";
    case "custom-sip":
      return "Custom SIP";
    default:
      return provider;
  }
}

function buildBuilderEdge(input: {
  connection: Connection;
  id: string;
  kind: WorkflowEdgeKind;
  sourceHandleRole: WorkflowRelationshipHandleRole;
  targetHandleRole: WorkflowRelationshipHandleRole;
  sourceNode: BuilderNode | undefined;
}): BuilderEdge {
  return applyBuilderEdgeKind({
    edge: applyBuilderEdgeHandleRoles(
      {
        id: input.id,
        source: input.connection.source ?? "",
        target: input.connection.target ?? "",
      },
      input.sourceHandleRole,
      input.targetHandleRole,
    ),
    kind: input.kind,
    sourceNode: input.sourceNode,
    preserveLabel: false,
  });
}

function applyBuilderEdgeKind(input: {
  edge: BuilderEdge;
  kind: WorkflowEdgeKind;
  sourceNode: BuilderNode | undefined;
  preserveLabel: boolean;
}): BuilderEdge {
  const returnLabel = input.kind === "return" ? getDefaultReturnEdgeLabel(input.sourceNode) : undefined;
  const preservedLabel = input.preserveLabel ? input.edge.label : undefined;
  const label = returnLabel ?? preservedLabel;
  const nextEdge: BuilderEdge = {
    ...input.edge,
    ...(label !== undefined ? { label } : {}),
  };

  if (input.kind !== "return") {
    return nextEdge;
  }

  return {
    ...nextEdge,
    data: { ...(input.edge.data ?? {}), kind: "return" },
    className: "workflow-return-edge",
  };
}

function getDefaultReturnEdgeLabel(sourceNode: BuilderNode | undefined): string {
  return sourceNode?.data.kind === "tool" ? "success" : "response";
}

function buildEdgeId(source: string, target: string, edges: BuilderEdge[]) {
  const baseId = `edge-${source}-${target}`;

  if (!edges.some((edge) => edge.id === baseId)) {
    return baseId;
  }

  let suffix = 2;

  while (edges.some((edge) => edge.id === `${baseId}-${suffix}`)) {
    suffix += 1;
  }

  return `${baseId}-${suffix}`;
}


function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
