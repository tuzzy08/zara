import { useCallback, useEffect, useState } from "react";
import { Cable, RefreshCw } from "lucide-react";
import type {
  IntegrationProviderCatalogEntry,
  IntegrationProviderCatalogTool,
  PublishedWorkflowVersion,
} from "@zara/core";

import {
  checkIntegrationHealth,
  configureZendeskIntegration,
  fetchIntegrationCatalog,
  fetchIntegrationConnections,
  fetchToolGrants,
  fetchWebhookTools,
  grantIntegrationCapability,
  promoteIntegrationConnection,
  revokeIntegrationConnection,
  startIntegrationConnect,
  type IntegrationConnection,
  type IntegrationConnectionAvailability,
  type IntegrationCapabilityGrant,
  type IntegrationConnectionScope,
  type IntegrationProvider,
  type ToolGrant,
  type WebhookTool,
} from "./tenantIntegrationsApi";
import { getIntegrationProviderBranding } from "./integrationProviderBranding";
import { formatStatus } from "./tenantPageFormatting";
import { TenantPageIntro } from "./TenantPageIntro";
import { TenantSectionHeader } from "./TenantSectionHeader";
import { TenantStatusBanner } from "./TenantStatusBanner";
import { TenantSummaryGrid } from "./TenantSummaryGrid";
import { type TenantPageProps } from "./tenantPageTypes";
import { loadPublishedWorkflowVersionsForWorkspace } from "./workflowSandboxRegistry";

interface CapabilityGrantDraft {
  workflowId: string;
  connectionId: string;
  toolId: string;
  approvalRequired: boolean;
}

export function TenantIntegrationsScreen({ organizationId, activeWorkspaceId, showToast }: TenantPageProps) {
  const [integrationsResource, setIntegrationsResource] = useState<{
    catalogProviders: IntegrationProviderCatalogEntry[];
    connections: IntegrationConnection[];
    errorMessage: string | null;
    loading: boolean;
    toolGrants: ToolGrant[];
    webhookTools: WebhookTool[];
  }>(() => ({
    catalogProviders: [],
    connections: [],
    errorMessage: null,
    loading: true,
    toolGrants: [],
    webhookTools: [],
  }));
  const { catalogProviders, connections, errorMessage, loading, toolGrants, webhookTools } = integrationsResource;
  const [zendeskDraft, setZendeskDraft] = useState({
    subdomain: "",
    email: "",
    apiToken: "",
  });
  const [connectionScope, setConnectionScope] = useState<IntegrationConnectionScope>("workspace");
  const [activeCapabilitySetup, setActiveCapabilitySetup] = useState<string | null>(null);
  const [capabilityGrantDrafts, setCapabilityGrantDrafts] = useState<Record<string, CapabilityGrantDraft>>({});

  const loadIntegrations = useCallback(async () => {
    setIntegrationsResource((current) => ({
      ...current,
      errorMessage: null,
      loading: true,
    }));

    try {
      const [nextConnections, nextCatalogProviders, nextWebhookTools, nextToolGrants] = await Promise.all([
        fetchIntegrationConnections(organizationId, activeWorkspaceId),
        fetchIntegrationCatalog(organizationId),
        fetchWebhookTools(organizationId, activeWorkspaceId),
        fetchToolGrants(organizationId, activeWorkspaceId),
      ]);

      setIntegrationsResource({
        catalogProviders: nextCatalogProviders,
        connections: nextConnections,
        errorMessage: null,
        loading: false,
        toolGrants: nextToolGrants,
        webhookTools: nextWebhookTools,
      });
    } catch (error) {
      setIntegrationsResource((current) => ({
        ...current,
        errorMessage: error instanceof Error ? error.message : "Integrations could not be loaded.",
        loading: false,
      }));
    }
  }, [activeWorkspaceId, organizationId]);

  useEffect(() => {
    void loadIntegrations();
  }, [loadIntegrations]);

  const catalogToolCount = catalogProviders.reduce((count, provider) => count + provider.tools.length, 0);
  const availableToolCount = catalogToolCount + webhookTools.length;
  const activeGrantCount = toolGrants.filter((grant) => grant.status === "active").length;
  const publishedWorkflows = loadPublishedWorkflowVersionsForWorkspace({
    tenantId: organizationId,
    workspaceId: activeWorkspaceId,
  });
  const capabilitySetupProviders = catalogProviders
    .map((provider) => ({
      provider,
      capabilities: getProviderCapabilityLanes(provider),
    }))
    .filter((entry) => entry.capabilities.length > 0);

  const refreshConnection = async (connectionId: string) => {
    const connection = await checkIntegrationHealth(organizationId, connectionId);
    setIntegrationsResource((current) => ({
      ...current,
      connections: current.connections.map((candidate) => candidate.id === connectionId ? connection : candidate),
    }));
    showToast("Integration health refreshed.");
  };

  const revokeConnection = async (connectionId: string) => {
    const connection = await revokeIntegrationConnection(organizationId, connectionId);
    setIntegrationsResource((current) => ({
      ...current,
      connections: current.connections.map((candidate) => candidate.id === connectionId ? connection : candidate),
    }));
    showToast("Integration revoked.");
  };

  const connectProvider = async (
    provider: IntegrationProvider,
    reconnectConnectionId?: string,
    availability?: IntegrationConnectionAvailability,
  ) => {
    const nextScope = availability?.scope ?? connectionScope;
    const workspaceId = availability?.scope === "workspace" ? availability.workspaceId : activeWorkspaceId;
    const connect = await startIntegrationConnect(organizationId, provider, {
      connectionScope: nextScope,
      ...(nextScope === "workspace" ? { workspaceId } : {}),
      ...(reconnectConnectionId !== undefined ? { reconnectConnectionId } : {}),
    });
    showToast(`Secure OAuth handoff ready: ${new URL(connect.authorizationUrl).hostname}`);
  };

  const configureZendesk = async () => {
    const connection = await configureZendeskIntegration(organizationId, {
      subdomain: zendeskDraft.subdomain.trim(),
      email: zendeskDraft.email.trim(),
      apiToken: zendeskDraft.apiToken,
      connectionScope,
      ...(connectionScope === "workspace" ? { workspaceId: activeWorkspaceId } : {}),
    });
    setIntegrationsResource((current) => ({
      ...current,
      connections: [
        ...current.connections.filter((candidate) => candidate.id !== connection.id),
        connection,
      ],
    }));
    setZendeskDraft((current) => ({
      ...current,
      apiToken: "",
    }));
    showToast("Zendesk credentials saved.");
  };

  const promoteConnection = async (connectionId: string) => {
    const connection = await promoteIntegrationConnection(organizationId, connectionId, {
      workspaceId: activeWorkspaceId,
      reason: "Make this connection available across organization workspaces.",
    });
    setIntegrationsResource((current) => ({
      ...current,
      connections: current.connections.map((candidate) => candidate.id === connectionId ? connection : candidate),
    }));
    showToast("Integration promoted.");
  };

  const openCapabilitySetup = (
    provider: IntegrationProviderCatalogEntry,
    providerConnections: IntegrationConnection[],
    capability: IntegrationCapabilityGrant,
  ) => {
    const setupKey = getCapabilitySetupKey(provider.id, capability);

    setCapabilityGrantDrafts((current) => ({
      ...current,
      [setupKey]: current[setupKey] ?? createDefaultCapabilityGrantDraft({
        provider,
        providerConnections,
        capability,
        publishedWorkflows,
      }),
    }));
    setActiveCapabilitySetup(setupKey);
  };

  const updateCapabilityGrantDraft = (
    setupKey: string,
    nextDraft: Partial<CapabilityGrantDraft>,
  ) => {
    setCapabilityGrantDrafts((current) => ({
      ...current,
      [setupKey]: {
        ...(current[setupKey] ?? createEmptyCapabilityGrantDraft()),
        ...nextDraft,
      },
    }));
  };

  const saveCapabilityGrant = async (
    provider: IntegrationProviderCatalogEntry,
    providerConnections: IntegrationConnection[],
    capability: IntegrationCapabilityGrant,
  ) => {
    const setupKey = getCapabilitySetupKey(provider.id, capability);
    const draft = capabilityGrantDrafts[setupKey] ?? createDefaultCapabilityGrantDraft({
      provider,
      providerConnections,
      capability,
      publishedWorkflows,
    });
    const selectedTool = provider.tools.find((tool) => tool.id === draft.toolId);

    if (
      draft.workflowId.length === 0 ||
      draft.connectionId.length === 0 ||
      draft.toolId.length === 0 ||
      selectedTool === undefined
    ) {
      return;
    }

    const grant = await grantIntegrationCapability(organizationId, {
      workspaceId: activeWorkspaceId,
      workflowId: draft.workflowId,
      capability,
      toolId: draft.toolId,
      integrationConnectionId: draft.connectionId,
      risk: selectedTool.riskPosture,
      approvalRequired: draft.approvalRequired,
    });

    setIntegrationsResource((current) => ({
      ...current,
      toolGrants: [
        grant,
        ...current.toolGrants.filter((candidate) => candidate.id !== grant.id),
      ],
    }));
    showToast("Capability grant saved.");
  };

  return (
    <div className="tenant-feature-page">
      <TenantPageIntro
        icon={Cable}
        eyebrow="Integrations"
        title="Integration command center"
        body="Connect CRM, productivity, and webhook tools with visible health, grants, and revocation posture while provider tokens stay inside Zara."
      />

      <TenantSummaryGrid
        items={[
          { label: "Connections", value: String(connections.length), detail: "OAuth accounts" },
          { label: "Available tools", value: String(availableToolCount), detail: "Connector and webhook tools" },
          { label: "Active grants", value: String(activeGrantCount), detail: "Workflow permissions" },
        ]}
      />

      {errorMessage === null ? null : <TenantStatusBanner tone="danger">{errorMessage}</TenantStatusBanner>}
      {loading ? <TenantStatusBanner tone="neutral">Loading integrations.</TenantStatusBanner> : null}

      <section className="tenant-page-grid">
        <div className="surface-card overflow-hidden">
          <TenantSectionHeader eyebrow="Zendesk" title="Secure ticket credentials" />
          <div className="tenant-form-grid">
            <label className="form-field">
              <span>Zendesk subdomain</span>
              <input
                type="text"
                value={zendeskDraft.subdomain}
                onChange={(event) => setZendeskDraft((current) => ({ ...current, subdomain: event.target.value }))}
                placeholder="acme-support"
              />
            </label>
            <label className="form-field">
              <span>Zendesk email</span>
              <input
                type="email"
                value={zendeskDraft.email}
                onChange={(event) => setZendeskDraft((current) => ({ ...current, email: event.target.value }))}
                placeholder="support@example.com"
              />
            </label>
            <label className="form-field">
              <span>Zendesk API token</span>
              <input
                type="password"
                value={zendeskDraft.apiToken}
                onChange={(event) => setZendeskDraft((current) => ({ ...current, apiToken: event.target.value }))}
              />
            </label>
            <label className="form-field">
              <span>Connection scope</span>
              <select
                value={connectionScope}
                onChange={(event) => setConnectionScope(event.target.value as IntegrationConnectionScope)}
              >
                <option value="workspace">Use only in this workspace</option>
                <option value="organization">Use across organization</option>
              </select>
            </label>
          </div>
          <div className="tenant-row-actions tenant-form-actions">
            <button
              className="workflow-button"
              type="button"
              onClick={() => void configureZendesk()}
            >
              Save Zendesk credentials
            </button>
          </div>
        </div>

        <div className="surface-card overflow-hidden">
          <TenantSectionHeader eyebrow="Connections" title="Provider health" />
          <div className="tenant-list">
            {connections.map((connection) => {
              const branding = getIntegrationProviderBranding(connection.provider);
              const scopeLabel = getConnectionScopeLabel(connection.availability, activeWorkspaceId);
              const canPromote = connection.status === "connected"
                && connection.availability.scope === "workspace"
                && connection.availability.workspaceId === activeWorkspaceId;

              return (
                <article key={connection.id} className="tenant-row">
                  <div className="tenant-row-main">
                    <ProviderLogo branding={branding} />
                    <div>
                      <div className="panel-title">{branding.label}</div>
                      <div className="panel-meta">
                        <span>{scopeLabel}</span> -{" "}
                        {connection.accountLabel !== undefined ? `${connection.accountLabel} - ` : ""}
                        {connection.scopes.join(", ")} - credential {connection.credentialReference.preview}
                      </div>
                    </div>
                  </div>
                  <div className="tenant-row-actions">
                    <span className={`table-status tenant-status-${connection.health.status}`}>
                      {formatStatus(connection.health.status)}
                    </span>
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`Check health for ${branding.label}`}
                      onClick={() => void refreshConnection(connection.id)}
                    >
                      <RefreshCw size={15} />
                    </button>
                    {connection.status === "revoked" ? (
                      <button className="workflow-button" type="button" onClick={() => void connectProvider(connection.provider, connection.id, connection.availability)}>
                        Reconnect
                      </button>
                    ) : (
                      <>
                        {canPromote ? (
                          <button
                            className="workflow-button"
                            type="button"
                            aria-label={`Promote ${branding.label} to organization scope`}
                            onClick={() => void promoteConnection(connection.id)}
                          >
                            Promote
                          </button>
                        ) : null}
                        <button className="workflow-button workflow-button-danger" type="button" onClick={() => void revokeConnection(connection.id)}>
                          Revoke
                        </button>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <div className="surface-card overflow-hidden">
          <TenantSectionHeader eyebrow="Capabilities" title="Capability setup" />
          <div className="tenant-list">
            {capabilitySetupProviders.map(({ provider, capabilities }) => {
              const branding = getIntegrationProviderBranding(provider.id, {
                label: provider.label,
                logoToken: provider.logoToken,
              });
              const providerConnections = connections.filter((connection) => connection.provider === provider.id);

              return (
                <article
                  key={provider.id}
                  aria-label={`${branding.label} capability setup`}
                  className="tenant-row tenant-row-stack"
                >
                  <div className="tenant-row-main">
                    <ProviderLogo branding={branding} />
                    <div>
                      <div className="panel-title">{branding.label}</div>
                      <div className="panel-meta">{getProviderCapabilityMeta(providerConnections.length)}</div>
                    </div>
                  </div>
                  <div className="tenant-row-actions tenant-capability-actions">
                    {capabilities.map((capability) => {
                      const status = getProviderCapabilityGrantStatus(providerConnections, toolGrants, capability);
                      const setupKey = getCapabilitySetupKey(provider.id, capability);
                      const isSetupActive = activeCapabilitySetup === setupKey;

                      return (
                        <div key={capability} className="tenant-capability-control">
                          <span className="table-status tenant-capability-pill">
                            <span>{getCapabilityLabel(capability)}</span>
                            <strong>{getCapabilityStatusLabel(status)}</strong>
                          </span>
                          <button
                            className="workflow-button"
                            type="button"
                            aria-label={`Configure ${branding.label} ${getCapabilityButtonLabel(capability)}`}
                            onClick={() => openCapabilitySetup(provider, providerConnections, capability)}
                          >
                            Configure
                          </button>
                          {isSetupActive ? (
                            <CapabilityGrantForm
                              draft={capabilityGrantDrafts[setupKey] ?? createDefaultCapabilityGrantDraft({
                                provider,
                                providerConnections,
                                capability,
                                publishedWorkflows,
                              })}
                              provider={provider}
                              providerConnections={providerConnections}
                              publishedWorkflows={publishedWorkflows}
                              capability={capability}
                              setupKey={setupKey}
                              onChange={updateCapabilityGrantDraft}
                              onSave={saveCapabilityGrant}
                            />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <div className="surface-card overflow-hidden">
          <TenantSectionHeader eyebrow="Catalog" title="Tools and grants" />
          <div className="tenant-list">
            {catalogProviders.flatMap((provider) =>
              provider.tools.map((tool) => {
                const branding = getIntegrationProviderBranding(provider.id, {
                  label: provider.label,
                  logoToken: provider.logoToken,
                });

                return (
                  <article key={`${provider.id}:${tool.id}`} className="tenant-row">
                    <div>
                      <div className="panel-title">{tool.name}</div>
                      <div className="panel-meta">{tool.id} - {tool.capabilities.join(", ")}</div>
                    </div>
                    <span className="table-status table-status-with-logo">
                      <ProviderLogo branding={branding} compact />
                      <span>{branding.label}</span>
                    </span>
                  </article>
                );
              }),
            )}
            {webhookTools.map((tool) => (
              <article key={tool.id} className="tenant-row">
                <div>
                  <div className="panel-title">{tool.toolName}</div>
                  <div className="panel-meta">{tool.request.method} {tool.request.url}</div>
                </div>
                <span className="table-status table-status-with-logo">
                  <ProviderLogo branding={getIntegrationProviderBranding("webhook-http")} compact />
                  <span>{getIntegrationProviderBranding("webhook-http").label}</span>
                </span>
              </article>
            ))}
            {toolGrants.map((grant) => (
              <article key={grant.id} className="tenant-row">
                <div>
                  <div className="panel-title">{grant.toolId}</div>
                  <div className="panel-meta">
                    {grant.workflowId}
                    {grant.pausedReason === undefined ? "" : ` - ${formatStatus(grant.pausedReason)}`}
                  </div>
                </div>
                <span className="table-status">{getGrantStatusLabel(grant)}</span>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function CapabilityGrantForm({
  capability,
  draft,
  provider,
  providerConnections,
  publishedWorkflows,
  setupKey,
  onChange,
  onSave,
}: {
  capability: IntegrationCapabilityGrant;
  draft: CapabilityGrantDraft;
  provider: IntegrationProviderCatalogEntry;
  providerConnections: IntegrationConnection[];
  publishedWorkflows: PublishedWorkflowVersion[];
  setupKey: string;
  onChange: (setupKey: string, nextDraft: Partial<CapabilityGrantDraft>) => void;
  onSave: (
    provider: IntegrationProviderCatalogEntry,
    providerConnections: IntegrationConnection[],
    capability: IntegrationCapabilityGrant,
  ) => Promise<void>;
}) {
  const tools = getCapabilityTools(provider, capability);
  const canSave = draft.workflowId.length > 0 && draft.connectionId.length > 0 && draft.toolId.length > 0;

  return (
    <div className="tenant-capability-form">
      <label className="form-field">
        <span>Workflow</span>
        <select
          aria-label="Capability workflow"
          value={draft.workflowId}
          onChange={(event) => onChange(setupKey, { workflowId: event.target.value })}
        >
          {publishedWorkflows.length === 0 ? <option value="">No published workflows</option> : null}
          {publishedWorkflows.map((workflow) => (
            <option key={workflow.id} value={workflow.id}>
              {workflow.graph.name} v{workflow.version}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        <span>Connection</span>
        <select
          aria-label="Capability connection"
          value={draft.connectionId}
          onChange={(event) => onChange(setupKey, { connectionId: event.target.value })}
        >
          {providerConnections.length === 0 ? <option value="">No available connection</option> : null}
          {providerConnections.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connection.accountLabel ?? connection.credentialReference.preview}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        <span>Tool</span>
        <select
          aria-label="Capability tool"
          value={draft.toolId}
          onChange={(event) => {
            const selectedTool = tools.find((tool) => tool.id === event.target.value);
            onChange(setupKey, {
              toolId: event.target.value,
              ...(selectedTool === undefined
                ? {}
                : { approvalRequired: selectedTool.riskPosture !== "low" }),
            });
          }}
        >
          {tools.map((tool) => (
            <option key={tool.id} value={tool.id}>
              {tool.name}
            </option>
          ))}
        </select>
      </label>
      <label className="tenant-checkbox-field">
        <input
          type="checkbox"
          checked={draft.approvalRequired}
          onChange={(event) => onChange(setupKey, { approvalRequired: event.target.checked })}
        />
        <span>Require approval</span>
      </label>
      <button
        className="workflow-button"
        type="button"
        disabled={!canSave}
        onClick={() => void onSave(provider, providerConnections, capability)}
      >
        Save capability grant
      </button>
    </div>
  );
}

function createDefaultCapabilityGrantDraft({
  capability,
  provider,
  providerConnections,
  publishedWorkflows,
}: {
  capability: IntegrationCapabilityGrant;
  provider: IntegrationProviderCatalogEntry;
  providerConnections: IntegrationConnection[];
  publishedWorkflows: PublishedWorkflowVersion[];
}): CapabilityGrantDraft {
  const selectedTool = getDefaultCapabilityTool(provider, capability);

  return {
    workflowId: publishedWorkflows[0]?.id ?? "",
    connectionId: providerConnections.find((connection) => connection.status === "connected")?.id
      ?? providerConnections[0]?.id
      ?? "",
    toolId: selectedTool?.id ?? "",
    approvalRequired: selectedTool?.riskPosture !== "low",
  };
}

function createEmptyCapabilityGrantDraft(): CapabilityGrantDraft {
  return {
    workflowId: "",
    connectionId: "",
    toolId: "",
    approvalRequired: false,
  };
}

function getDefaultCapabilityTool(
  provider: IntegrationProviderCatalogEntry,
  capability: IntegrationCapabilityGrant,
) {
  const tools = getCapabilityTools(provider, capability);

  return tools.find((tool) => tool.riskPosture === "low") ?? tools[0];
}

function getCapabilityTools(
  provider: IntegrationProviderCatalogEntry,
  capability: IntegrationCapabilityGrant,
): IntegrationProviderCatalogTool[] {
  if (capability === "knowledge-source") {
    return nonEmptyTools(
      provider.tools.filter((tool) => tool.knowledgeSource),
      provider.tools.filter((tool) => tool.riskPosture === "low"),
      provider.tools,
    );
  }

  if (capability === "post-call-sync") {
    return nonEmptyTools(
      provider.tools.filter((tool) => tool.riskPosture !== "low"),
      provider.tools,
    );
  }

  return nonEmptyTools(
    provider.tools.filter((tool) => tool.capabilities.includes("agent-tool")),
    provider.tools,
  );
}

function nonEmptyTools(...toolSets: IntegrationProviderCatalogTool[][]) {
  return toolSets.find((tools) => tools.length > 0) ?? [];
}

function getCapabilitySetupKey(
  provider: IntegrationProvider,
  capability: IntegrationCapabilityGrant,
) {
  return `${provider}:${capability}`;
}

function getConnectionScopeLabel(
  availability: IntegrationConnectionAvailability,
  activeWorkspaceId: string,
) {
  if (availability.scope === "organization") {
    return "Organization-wide";
  }

  return availability.workspaceId === activeWorkspaceId ? "This workspace" : "Workspace-owned";
}

function getProviderCapabilityLanes(
  provider: IntegrationProviderCatalogEntry,
): IntegrationCapabilityGrant[] {
  const lanes: IntegrationCapabilityGrant[] = [];

  if (provider.capabilities.includes("agent-tool")) {
    lanes.push("agent-tool");
  }

  if (provider.knowledgeSource.supported || provider.capabilities.includes("knowledge-source")) {
    lanes.push("knowledge-source");
  }

  if (provider.capabilities.includes("post-call-sync")) {
    lanes.push("post-call-sync");
  }

  return lanes;
}

function getProviderCapabilityMeta(connectionCount: number) {
  if (connectionCount === 0) {
    return "No available connection";
  }

  return connectionCount === 1 ? "1 available connection" : `${connectionCount} available connections`;
}

function getProviderCapabilityGrantStatus(
  providerConnections: IntegrationConnection[],
  grants: ToolGrant[],
  capability: IntegrationCapabilityGrant,
) {
  const connectionIds = new Set(providerConnections.map((connection) => connection.id));
  const matchingGrants = grants.filter(
    (grant) => connectionIds.has(grant.integrationConnectionId) && getGrantCapability(grant) === capability,
  );

  if (matchingGrants.some((grant) => grant.status === "active")) {
    return "active";
  }

  if (matchingGrants.some((grant) => grant.status === "paused")) {
    return "paused";
  }

  if (matchingGrants.some((grant) => grant.status === "revoked")) {
    return "revoked";
  }

  return "not-configured";
}

function getGrantCapability(grant: ToolGrant): IntegrationCapabilityGrant {
  return grant.capability ?? "agent-tool";
}

function getCapabilityLabel(capability: IntegrationCapabilityGrant) {
  switch (capability) {
    case "agent-tool":
      return "Agent tools";
    case "knowledge-source":
      return "Knowledge source";
    case "post-call-sync":
      return "Post-call sync";
  }
}

function getCapabilityButtonLabel(capability: IntegrationCapabilityGrant) {
  switch (capability) {
    case "agent-tool":
      return "agent tools";
    case "knowledge-source":
      return "knowledge source";
    case "post-call-sync":
      return "post-call sync";
  }
}

function getCapabilityStatusLabel(status: ReturnType<typeof getProviderCapabilityGrantStatus>) {
  switch (status) {
    case "active":
      return "Active";
    case "paused":
      return "Paused";
    case "revoked":
      return "Revoked";
    case "not-configured":
      return "Not configured";
  }
}

function getGrantStatusLabel(grant: ToolGrant) {
  if (grant.status === "paused") {
    return "Paused";
  }

  if (grant.status === "revoked") {
    return "Revoked";
  }

  return grant.approvalRequired ? "Approval required" : grant.risk;
}

function ProviderLogo({
  branding,
  compact = false,
}: {
  branding: ReturnType<typeof getIntegrationProviderBranding>;
  compact?: boolean | undefined;
}) {
  return (
    <span
      aria-label={branding.ariaLabel}
      className={compact ? `${branding.logoClassName} integration-provider-logo-compact` : branding.logoClassName}
      role="img"
    >
      {branding.logoText}
    </span>
  );
}
