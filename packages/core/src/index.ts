export * from "./env";
export * from "./provider-registry";

export type ID = string;

export type TenantEnvironment = "sandbox" | "production";

export const frontendApps = ["web", "platform-admin"] as const;
export type FrontendApp = (typeof frontendApps)[number];

export const tenantRoles = ["owner", "admin", "builder", "operator", "viewer"] as const;
export type TenantRole = (typeof tenantRoles)[number];

export const platformRoles = [
  "platform_owner",
  "platform_admin",
  "platform_support",
  "platform_readonly",
] as const;
export type PlatformRole = (typeof platformRoles)[number];

export type VoiceRuntimeKind =
  | "openai-realtime"
  | "gemini-live"
  | "cloudflare-voice"
  | "sandwich-pipeline";
export type RuntimeProfileId = "cost-optimized" | "balanced" | "premium-realtime";
export type RuntimeTtsVoice = "economy" | "neural-hd" | "expressive";
export type RealtimeProviderId = "openai-realtime" | "gemini-live";

export type AgentVoiceSourceType = "catalog" | "cloned";
export type AgentVoiceCloneStatus = "pending" | "approved" | "disabled" | "deleted";

export const openAiRealtimeVoices = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
] as const;
export type OpenAiRealtimeVoice = (typeof openAiRealtimeVoices)[number];

export const geminiLiveVoiceNames = [
  "Zephyr",
  "Puck",
  "Charon",
  "Kore",
  "Fenrir",
  "Leda",
  "Orus",
  "Aoede",
  "Callirrhoe",
  "Autonoe",
  "Enceladus",
  "Iapetus",
  "Umbriel",
  "Algieba",
  "Despina",
  "Erinome",
  "Algenib",
  "Rasalgethi",
  "Laomedeia",
  "Achernar",
  "Alnilam",
  "Schedar",
  "Gacrux",
  "Pulcherrima",
  "Achird",
  "Zubenelgenubi",
  "Vindemiatrix",
  "Sadachbia",
  "Sadaltager",
  "Sulafat",
] as const;
export type GeminiLiveVoiceName = (typeof geminiLiveVoiceNames)[number];

export type RealtimeVoiceConfig =
  | {
      provider: "openai-realtime";
      voice: OpenAiRealtimeVoice;
      speed?: number | undefined;
    }
  | {
      provider: "gemini-live";
      voiceName: GeminiLiveVoiceName;
    };

export interface AgentVoiceConfig {
  provider: "cartesia";
  voiceId: ID;
  label: string;
  sourceType: AgentVoiceSourceType;
  cloneStatus?: AgentVoiceCloneStatus | undefined;
  speed?: number | undefined;
  volume?: number | undefined;
  emotion?: string | undefined;
}

export type TelephonyProvider =
  | "browser-webrtc"
  | "openai-sip"
  | "twilio"
  | "signalwire"
  | "telnyx"
  | "custom-sip";

export type TelephonyOwnershipMode = "platform" | "bring-your-own";

export type AgentRoleKind =
  | "triage"
  | "receptionist"
  | "support"
  | "billing"
  | "onboarding"
  | "sales"
  | "scheduler"
  | "custom";

export type ModelTier = "rules" | "cheap" | "standard" | "sota";
export type TextModelProviderId = "openai" | "google-gemini";

export type RuntimeCallPhase =
  | "greeting"
  | "discovery"
  | "tool-use"
  | "resolution"
  | "escalation";

export interface TenantRef {
  tenantId: ID;
  environment: TenantEnvironment;
}

export interface VoiceAgentRole {
  id: ID;
  kind: AgentRoleKind;
  name: string;
  businessName: string;
  instructions: string;
  handoffDescription?: string;
  defaultModelTier: ModelTier;
  modelProvider?: TextModelProviderId;
  modelId?: string;
  realtimeProvider?: RealtimeProviderId;
  realtimeModelId?: string;
  runtimeProfileOverride?: RuntimeProfileId;
  realtimeVoiceConfig?: RealtimeVoiceConfig | undefined;
  voiceConfig?: AgentVoiceConfig | undefined;
  routePolicy?: unknown;
  toolIds: ID[];
  languagePolicy: LanguagePolicy;
}

export interface LanguagePolicy {
  defaultLanguage: string;
  supportedLanguages: string[];
  allowMidCallSwitching: boolean;
  languagePrompts?: Record<string, string>;
}

export interface ToolDefinition {
  id: ID;
  name: string;
  description: string;
  connector:
    | "zendesk"
    | "hubspot"
    | "google-workspace"
    | "notion"
    | "salesforce"
    | "slack"
    | "microsoft-365"
    | "intercom"
    | "shopify"
    | "stripe"
    | "webhook"
    | "internal";
  requiresHumanApproval: boolean;
  risk: "low" | "medium" | "high";
}

export type WorkflowNodeKind =
  | "entry"
  | "agent"
  | "tool"
  | "condition"
  | "human-escalation"
  | "end";

export interface WorkflowNode {
  id: ID;
  kind: WorkflowNodeKind;
  label: string;
  position: WorkflowNodePosition;
  toolId?: ID;
  config: Record<string, unknown>;
}

export interface WorkflowNodePosition {
  x: number;
  y: number;
}

export type WorkflowEdgeKind = "flow" | "return";

export type WorkflowRelationshipHandleRole =
  | "flow-source"
  | "flow-target"
  | "tool-call-source"
  | "tool-call-target"
  | "tool-result-source"
  | "tool-result-target";

export interface WorkflowEdge {
  id: ID;
  sourceNodeId: ID;
  targetNodeId: ID;
  kind?: WorkflowEdgeKind;
  sourceHandleRole?: WorkflowRelationshipHandleRole;
  targetHandleRole?: WorkflowRelationshipHandleRole;
  condition?: string;
}

export interface WorkflowGraph {
  id: ID;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface PublishedAgentVersion {
  id: ID;
  tenantId: ID;
  version: number;
  graph: WorkflowGraph;
  roles: VoiceAgentRole[];
  tools: ToolDefinition[];
  createdAt: string;
  createdBy: ID;
}

export interface ModelRoutingRule {
  id: ID;
  priority?: number;
  when: {
    intent?: string;
    maxRisk?: ToolDefinition["risk"];
    minRisk?: ToolDefinition["risk"];
    language?: string;
    minConfidence?: number;
    maxConfidence?: number;
    callPhase?: RuntimeCallPhase;
  };
  useTier: ModelTier;
  reason: string;
}

export type EscalationFallbackMode = "callback" | "voicemail" | "ticket";

export interface EscalationPolicy {
  enabled: boolean;
  queueId?: ID;
  fallbackMode: EscalationFallbackMode;
  triggers: Array<
    | "user-request"
    | "low-confidence"
    | "high-risk-tool"
    | "negative-sentiment"
    | "repeated-failure"
  >;
  fallbackMessage: string;
}

export interface RuntimeManifest extends TenantRef {
  manifestId: ID;
  publishedVersionId: ID;
  workflowId: ID;
  workspaceId?: ID | undefined;
  runtime: VoiceRuntimeKind;
  telephonyProvider: TelephonyProvider;
  entryAgentId: ID;
  roles: VoiceAgentRole[];
  tools: ToolDefinition[];
  graph: WorkflowGraph;
  modelRouting: ModelRoutingRule[];
  escalation: EscalationPolicy;
  telemetry: TelemetryPolicy;
}

export interface TelemetryPolicy {
  captureAudio: boolean;
  captureTranscript: boolean;
  redactSensitiveData: boolean;
  sinks: Array<"live-monitor" | "postgres" | "clickhouse" | "langsmith" | "opentelemetry">;
}

export type CallEventType =
  | "call.started"
  | "call.lifecycle"
  | "call.ended"
  | "call.failed"
  | "turn.started"
  | "turn.transcribed"
  | "turn.response.started"
  | "turn.audio.first_byte"
  | "turn.completed"
  | "pstn.media.received"
  | "pstn.media.outbound"
  | "pstn.barge_in.detected"
  | "pstn.audio.clear_requested"
  | "agent.handoff.requested"
  | "agent.handoff.completed"
  | "tool.requested"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "tool.approval_required"
  | "routing.model_selected"
  | "escalation.requested"
  | "escalation.accepted"
  | "escalation.failed"
  | "quality.flagged"
  | "improvement.suggested";

export interface CallEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  id: ID;
  callSessionId: ID;
  tenantId: ID;
  type: CallEventType;
  at: string;
  payload: TPayload;
}

export * from "./workflow";
export * from "./runtime";
export * from "./telephony";
export * from "./workspace";
export * from "./workspace-seed";
export * from "./turn-runtime-packet";
export * from "./intent-routing";
export * from "./agent-action";
export * from "./agent-runtime-context";
export * from "./realtime-tool-bridge";
export * from "./live-call-session";
export * from "./pstn-sandwich-runtime";
export * from "./pstn-premium-realtime-runtime";
