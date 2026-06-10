import { useCallback, useEffect, useState } from "react";
import { Cable } from "lucide-react";
import type {
  IntegrationProviderCatalogEntry,
  IntegrationProviderCatalogTool,
  IntegrationProviderSetupField,
  PublishedWorkflowVersion,
} from "@zara/core";

import {
  checkIntegrationHealth,
  configureFreshdeskIntegration,
  configureZendeskIntegration,
  deleteIntegrationConnection,
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

interface ConnectionSetupModalState {
  provider: IntegrationProviderCatalogEntry;
  reconnectConnection?: IntegrationConnection | undefined;
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
  const [connectionSetupModal, setConnectionSetupModal] = useState<ConnectionSetupModalState | null>(null);
  const [connectionSetupDraft, setConnectionSetupDraft] = useState<Record<string, string>>({});
  const [connectionSetupScope, setConnectionSetupScope] = useState<IntegrationConnectionScope>("workspace");
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

  const deleteConnection = async (connectionId: string) => {
    await deleteIntegrationConnection(organizationId, connectionId);
    setIntegrationsResource((current) => ({
      ...current,
      connections: current.connections.filter((candidate) => candidate.id !== connectionId),
      toolGrants: current.toolGrants.filter((grant) => grant.integrationConnectionId !== connectionId),
    }));
    showToast("Integration connection deleted.");
  };

  const connectProvider = async (
    provider: IntegrationProvider,
    reconnectConnectionId?: string,
    availability?: IntegrationConnectionAvailability,
    requestedScopes?: string[],
    setup?: { shopDomain?: string },
  ) => {
    const nextScope = availability?.scope ?? connectionSetupScope;
    const workspaceId = availability?.scope === "workspace" ? availability.workspaceId : activeWorkspaceId;
    const connect = await startIntegrationConnect(organizationId, provider, {
      connectionScope: nextScope,
      ...(nextScope === "workspace" ? { workspaceId } : {}),
      ...(reconnectConnectionId !== undefined ? { reconnectConnectionId } : {}),
      ...(requestedScopes !== undefined ? { requestedScopes } : {}),
      ...(setup?.shopDomain !== undefined ? { shopDomain: setup.shopDomain } : {}),
    });
    showToast(`Secure OAuth handoff ready: ${new URL(connect.authorizationUrl).hostname}`);
  };

  const openConnectionSetup = (
    provider: IntegrationProviderCatalogEntry,
    reconnectConnection?: IntegrationConnection,
  ) => {
    setConnectionSetupModal({ provider, reconnectConnection });
    setConnectionSetupScope(reconnectConnection?.availability.scope ?? "workspace");
    setConnectionSetupDraft(createDefaultConnectionSetupDraft(provider, reconnectConnection));
  };

  const closeConnectionSetup = () => {
    setConnectionSetupModal(null);
    setConnectionSetupDraft({});
  };

  const updateConnectionSetupDraft = (fieldId: string, value: string) => {
    setConnectionSetupDraft((current) => ({
      ...current,
      [fieldId]: value,
    }));
  };

  const saveConfiguredConnection = (connection: IntegrationConnection) => {
    setIntegrationsResource((current) => ({
      ...current,
      connections: [
        connection,
        ...current.connections.filter((candidate) => candidate.id !== connection.id),
      ],
    }));
  };

  const connectFromModal = async () => {
    if (connectionSetupModal === null) {
      return;
    }

    const { provider, reconnectConnection } = connectionSetupModal;
    const effectiveScope = reconnectConnection?.availability.scope ?? connectionSetupScope;
    const reconnectWorkspaceId = reconnectConnection?.availability.scope === "workspace"
      ? reconnectConnection.availability.workspaceId
      : undefined;
    const workspaceId = reconnectWorkspaceId ?? activeWorkspaceId;

    if (provider.id === "zendesk") {
      const connection = await configureZendeskIntegration(organizationId, {
        subdomain: (connectionSetupDraft.subdomain ?? "").trim(),
        email: (connectionSetupDraft.email ?? "").trim(),
        apiToken: connectionSetupDraft.apiToken ?? "",
        connectionScope: effectiveScope,
        ...(effectiveScope === "workspace" ? { workspaceId } : {}),
        ...(reconnectConnection !== undefined ? { reconnectConnectionId: reconnectConnection.id } : {}),
      });
      saveConfiguredConnection(connection);
      closeConnectionSetup();
      showToast(reconnectConnection === undefined ? "Zendesk connected." : "Zendesk reconnected.");
      return;
    }

    if (provider.id === "freshdesk") {
      const connection = await configureFreshdeskIntegration(organizationId, {
        subdomain: (connectionSetupDraft.subdomain ?? "").trim(),
        apiToken: connectionSetupDraft.apiToken ?? "",
        connectionScope: effectiveScope,
        ...(effectiveScope === "workspace" ? { workspaceId } : {}),
      });
      saveConfiguredConnection(connection);
      closeConnectionSetup();
      showToast("Freshdesk connected.");
      return;
    }

    await connectProvider(
      provider.id,
      reconnectConnection?.id,
      reconnectConnection?.availability ?? (effectiveScope === "workspace" ? { scope: "workspace", workspaceId } : { scope: "organization" }),
      undefined,
      provider.id === "shopify" ? { shopDomain: (connectionSetupDraft.shopDomain ?? "").trim() } : undefined,
    );
    closeConnectionSetup();
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

  const reconnectForMissingScopes = async (
    provider: IntegrationProvider,
    connection: IntegrationConnection,
    missingScopes: string[],
  ) => {
    await connectProvider(provider, connection.id, connection.availability, missingScopes, getConnectionSetupOptions(connection));
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

      <section className="tenant-page-grid tenant-integrations-page-grid">
        <div className="surface-card overflow-hidden tenant-tool-access-card">
          <TenantSectionHeader eyebrow="Tools" title="Tool access" />
          <div className="tenant-list">
            {capabilitySetupProviders.map(({ provider, capabilities }) => {
              const branding = getIntegrationProviderBranding(provider.id, {
                label: provider.label,
                logoToken: provider.logoToken,
              });
              const allProviderConnections = connections.filter((connection) => connection.provider === provider.id);
              const providerConnections = allProviderConnections.filter((connection) => connection.status === "connected");
              const primaryConnection = providerConnections[0];
              const reconnectConnection = allProviderConnections.find((connection) => connection.status === "revoked");
              const actionLabel = getConnectionActionLabel(provider.id, branding.label);
              const canPromote = primaryConnection?.availability.scope === "workspace"
                && primaryConnection.availability.workspaceId === activeWorkspaceId;

              return (
                <article
                  key={provider.id}
                  aria-label={`${branding.label} tool access`}
                  className="tenant-row tenant-tool-access-row"
                >
                  <div className="tenant-row-main">
                    <ProviderLogo branding={branding} />
                    <div>
                      <div className="tenant-provider-title-line">
                        <span className="panel-title">{branding.label}</span>
                        {primaryConnection === undefined ? null : (
                          <span className="table-status tenant-connected-pill">Connected</span>
                        )}
                      </div>
                      <div className="panel-meta">
                        {getProviderCapabilityMeta(providerConnections.length)}
                        {primaryConnection === undefined ? "" : ` - ${getConnectionScopeLabel(primaryConnection.availability, activeWorkspaceId)}`}
                        {primaryConnection?.accountLabel === undefined ? "" : ` - ${primaryConnection.accountLabel}`}
                      </div>
                    </div>
                  </div>
                  <div className="tenant-row-actions tenant-capability-actions">
                    <div className="tenant-provider-connection-actions">
                      {primaryConnection === undefined ? (
                        <button
                          className="workflow-button"
                          type="button"
                          aria-label={`Connect ${actionLabel}`}
                          onClick={() => openConnectionSetup(provider, reconnectConnection)}
                        >
                          Connect
                        </button>
                      ) : (
                        <>
                          <button
                            className="workflow-button"
                            type="button"
                            aria-label={`Connect ${actionLabel}`}
                            onClick={() => openConnectionSetup(provider)}
                          >
                            Connect
                          </button>
                          <button
                            className="workflow-button"
                            type="button"
                            aria-label={`Test ${actionLabel} connection`}
                            onClick={() => void refreshConnection(primaryConnection.id)}
                          >
                            Test connection
                          </button>
                          {canPromote ? (
                            <button
                              className="workflow-button"
                              type="button"
                              aria-label={`Promote ${actionLabel} to organization scope`}
                              onClick={() => void promoteConnection(primaryConnection.id)}
                            >
                              Promote
                            </button>
                          ) : null}
                          <button
                            className="workflow-button workflow-button-danger"
                            type="button"
                            aria-label={`Revoke ${actionLabel} connection`}
                            onClick={() => void revokeConnection(primaryConnection.id)}
                          >
                            Revoke
                          </button>
                          <button
                            className="workflow-button workflow-button-danger"
                            type="button"
                            aria-label={`Delete ${actionLabel} connection`}
                            onClick={() => void deleteConnection(primaryConnection.id)}
                          >
                            Delete
                          </button>
                        </>
                      )}
                      {primaryConnection === undefined && reconnectConnection !== undefined ? (
                        <button
                          className="workflow-button workflow-button-danger"
                          type="button"
                          aria-label={`Delete ${actionLabel} connection`}
                          onClick={() => void deleteConnection(reconnectConnection.id)}
                        >
                          Delete old connection
                        </button>
                      ) : null}
                    </div>
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
                              onReconnect={reconnectForMissingScopes}
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
      </section>
      {connectionSetupModal === null ? null : (
        <ProviderConnectionModal
          provider={connectionSetupModal.provider}
          draft={connectionSetupDraft}
          scope={connectionSetupScope}
          reconnectConnection={connectionSetupModal.reconnectConnection}
          connectedConnection={connections.find((connection) =>
            connection.provider === connectionSetupModal.provider.id && connection.status === "connected"
          )}
          onCancel={closeConnectionSetup}
          onChange={updateConnectionSetupDraft}
          onScopeChange={setConnectionSetupScope}
          onSubmit={connectFromModal}
          onTest={refreshConnection}
        />
      )}
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
  onReconnect,
  onSave,
}: {
  capability: IntegrationCapabilityGrant;
  draft: CapabilityGrantDraft;
  provider: IntegrationProviderCatalogEntry;
  providerConnections: IntegrationConnection[];
  publishedWorkflows: PublishedWorkflowVersion[];
  setupKey: string;
  onChange: (setupKey: string, nextDraft: Partial<CapabilityGrantDraft>) => void;
  onReconnect: (
    provider: IntegrationProvider,
    connection: IntegrationConnection,
    missingScopes: string[],
  ) => Promise<void>;
  onSave: (
    provider: IntegrationProviderCatalogEntry,
    providerConnections: IntegrationConnection[],
    capability: IntegrationCapabilityGrant,
  ) => Promise<void>;
}) {
  const tools = getCapabilityTools(provider, capability);
  const selectedConnection = providerConnections.find((connection) => connection.id === draft.connectionId);
  const selectedTool = tools.find((tool) => tool.id === draft.toolId);
  const missingScopes = getMissingProviderScopes(selectedConnection, selectedTool);
  const canSave = draft.workflowId.length > 0
    && draft.connectionId.length > 0
    && draft.toolId.length > 0
    && selectedConnection?.status === "connected"
    && missingScopes.length === 0;

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
        {getCapabilitySaveLabel(capability)}
      </button>
      {selectedConnection !== undefined && missingScopes.length > 0 ? (
        <div className="tenant-scope-warning" role="status">
          <span>Reconnect required for missing scopes: {missingScopes.join(", ")}</span>
          <button
            className="workflow-button"
            type="button"
            onClick={() => void onReconnect(provider.id, selectedConnection, missingScopes)}
          >
            Reconnect {provider.label} for missing scopes
          </button>
        </div>
      ) : null}
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

function ProviderConnectionModal({
  connectedConnection,
  draft,
  provider,
  reconnectConnection,
  scope,
  onCancel,
  onChange,
  onScopeChange,
  onSubmit,
  onTest,
}: {
  connectedConnection?: IntegrationConnection | undefined;
  draft: Record<string, string>;
  provider: IntegrationProviderCatalogEntry;
  reconnectConnection?: IntegrationConnection | undefined;
  scope: IntegrationConnectionScope;
  onCancel: () => void;
  onChange: (fieldId: string, value: string) => void;
  onScopeChange: (scope: IntegrationConnectionScope) => void;
  onSubmit: () => Promise<void>;
  onTest: (connectionId: string) => Promise<void>;
}) {
  const branding = getIntegrationProviderBranding(provider.id, {
    label: provider.label,
    logoToken: provider.logoToken,
  });
  const actionLabel = getConnectionActionLabel(provider.id, branding.label);
  const isReconnect = reconnectConnection !== undefined;

  return (
    <div className="tenant-modal-backdrop">
      <section
        aria-label={`Connect ${actionLabel}`}
        aria-modal="true"
        className="surface-card tenant-connection-modal"
        role="dialog"
      >
        <div className="tenant-connection-modal-header">
          <div className="tenant-row-main">
            <ProviderLogo branding={branding} />
            <div>
              <div className="panel-title">Connect {actionLabel}</div>
              <div className="panel-meta">
                {isReconnect ? "Reconnect with fresh credentials." : getSetupSchemaDescription(provider.setupSchema.type)}
              </div>
            </div>
          </div>
          {connectedConnection === undefined ? null : (
            <span className="table-status tenant-connected-pill">Connected</span>
          )}
        </div>
        <div className="tenant-connection-modal-fields">
          {provider.setupSchema.fields.map((field) => (
            <label key={field.id} className="form-field">
              <span>{getSetupFieldLabel(provider.id, field)}</span>
              <input
                aria-label={getSetupFieldLabel(provider.id, field)}
                required={field.required}
                type={getSetupFieldInputType(field)}
                value={draft[field.id] ?? ""}
                onChange={(event) => onChange(field.id, event.target.value)}
                placeholder={getSetupFieldPlaceholder(provider.id, field.id)}
              />
            </label>
          ))}
          <label className="form-field">
            <span>Connection scope</span>
            <select
              aria-label="Connection scope"
              value={scope}
              disabled={isReconnect}
              onChange={(event) => onScopeChange(event.target.value as IntegrationConnectionScope)}
            >
              <option value="workspace">Use only in this workspace</option>
              <option value="organization">Use across organization</option>
            </select>
          </label>
        </div>
        <div className="tenant-row-actions tenant-form-actions tenant-connection-modal-actions">
          {connectedConnection === undefined ? null : (
            <button
              className="workflow-button"
              type="button"
              aria-label={`Test ${actionLabel} connection`}
              onClick={() => void onTest(connectedConnection.id)}
            >
              Test connection
            </button>
          )}
          <button className="workflow-button" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="workflow-button workflow-button-primary" type="button" onClick={() => void onSubmit()}>
            Connect {actionLabel}
          </button>
        </div>
      </section>
    </div>
  );
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

function getMissingProviderScopes(
  connection: IntegrationConnection | undefined,
  tool: IntegrationProviderCatalogTool | undefined,
) {
  if (connection === undefined || tool === undefined) {
    return [];
  }

  return tool.requiredScopes.filter((scope) => !connection.scopes.includes(scope));
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

function getConnectionActionLabel(provider: IntegrationProvider, fallbackLabel: string) {
  switch (provider) {
    case "zendesk":
      return "Zendesk";
    case "hubspot":
      return "HubSpot";
    case "google-workspace":
      return "Google Workspace";
    case "microsoft-365":
      return "Microsoft 365";
    case "freshdesk":
      return "Freshdesk";
    case "salesforce-knowledge":
      return "Salesforce Knowledge";
    case "webhook-http":
      return "Webhook HTTP";
    default:
      return fallbackLabel;
  }
}

function getCapabilitySaveLabel(capability: IntegrationCapabilityGrant) {
  switch (capability) {
    case "agent-tool":
      return "Enable selected tool";
    case "knowledge-source":
      return "Enable knowledge source";
    case "post-call-sync":
      return "Enable post-call sync";
  }
}

function getConnectionSetupOptions(connection: IntegrationConnection) {
  if (connection.provider === "shopify" && connection.accountLabel !== undefined) {
    return { shopDomain: connection.accountLabel };
  }

  return undefined;
}

function createDefaultConnectionSetupDraft(
  provider: IntegrationProviderCatalogEntry,
  connection: IntegrationConnection | undefined,
) {
  const draft = Object.fromEntries(provider.setupSchema.fields.map((field) => [field.id, ""]));

  if (provider.id === "zendesk" && connection?.accountLabel?.endsWith(".zendesk.com") === true) {
    draft.subdomain = connection.accountLabel.slice(0, -".zendesk.com".length);
  }

  if (provider.id === "shopify" && connection?.accountLabel !== undefined) {
    draft.shopDomain = connection.accountLabel;
  }

  return draft;
}

function getSetupFieldInputType(field: IntegrationProviderSetupField) {
  if (field.secret) {
    return "password";
  }

  if (field.kind === "email") {
    return "email";
  }

  if (field.kind === "url") {
    return "url";
  }

  return "text";
}

function getSetupFieldLabel(provider: IntegrationProvider, field: IntegrationProviderSetupField) {
  if (provider === "zendesk" && field.id === "email") {
    return "Zendesk email";
  }

  return field.label;
}

function getSetupFieldPlaceholder(provider: IntegrationProvider, fieldId: string) {
  if ((provider === "zendesk" || provider === "freshdesk") && fieldId === "subdomain") {
    return "acme-support";
  }

  if (provider === "shopify" && fieldId === "shopDomain") {
    return "acme-store.myshopify.com";
  }

  if (fieldId === "email") {
    return "support@example.com";
  }

  return undefined;
}

function getSetupSchemaDescription(setupType: IntegrationProviderCatalogEntry["setupSchema"]["type"]) {
  switch (setupType) {
    case "api-token":
      return "Enter the required API token details.";
    case "oauth":
      return "Confirm connection scope before starting OAuth.";
    case "oauth-or-api-token":
      return "Enter credentials or continue with the provider handoff.";
    case "tenant-defined-webhook":
      return "Enter the webhook connection details.";
  }
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
      <ProviderLogoMark token={branding.logoToken} fallbackText={branding.logoText} />
    </span>
  );
}

function ProviderLogoMark({ fallbackText, token }: { fallbackText: string; token: string }) {
  switch (token) {
    case "zendesk":
      return (
        <svg aria-hidden="true" viewBox="0 0 32 32">
          <path d="M6 7h10L6 18V7Z" fill="currentColor" />
          <path d="M6 25h10L6 14v11Z" fill="currentColor" />
          <circle cx="22" cy="11" r="5" fill="currentColor" />
          <path d="M17 25a5 5 0 0 1 10 0H17Z" fill="currentColor" />
        </svg>
      );
    case "hubspot":
      return (
        <svg aria-hidden="true" viewBox="0 0 32 32">
          <path d="M12 10.5h7.4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
          <path d="M12 21.5h7.4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
          <circle cx="22.5" cy="10.5" r="4.4" fill="currentColor" />
          <circle cx="22.5" cy="21.5" r="4.4" fill="currentColor" />
          <circle cx="9" cy="16" r="4" fill="currentColor" />
        </svg>
      );
    case "google-workspace":
      return (
        <svg aria-hidden="true" viewBox="0 0 32 32">
          <path d="M7 9h18v14H7V9Z" fill="#fff" stroke="currentColor" strokeWidth="2" />
          <path d="M8 10l8 7 8-7" fill="none" stroke="#ea4335" strokeWidth="3" />
          <path d="M8 22v-9" stroke="#34a853" strokeWidth="3" />
          <path d="M24 22v-9" stroke="#4285f4" strokeWidth="3" />
          <path d="M9 23h14" stroke="#fbbc04" strokeWidth="3" />
        </svg>
      );
    case "shopify":
      return (
        <svg aria-hidden="true" viewBox="0 0 32 32">
          <path d="M10 11.5 23 10l2 15.5H8L10 11.5Z" fill="currentColor" />
          <path d="M13 12c0-4 2-6 4.2-6 2 0 3.5 1.5 3.8 4.5" fill="none" stroke="#fff" strokeWidth="2" />
          <path d="M14 18c1.2 1.1 3.6 1.4 4.8.3" fill="none" stroke="#fff" strokeLinecap="round" strokeWidth="2" />
        </svg>
      );
    case "stripe":
      return (
        <svg aria-hidden="true" viewBox="0 0 32 32">
          <path d="M21.5 10.5c-1.7-.8-3.3-1.1-4.8-1.1-3.6 0-5.8 1.7-5.8 4.2 0 4.7 7.5 3.1 7.5 5.6 0 .8-.8 1.2-2.2 1.2-1.8 0-4-.6-5.7-1.6v4.1c1.8.9 3.8 1.3 5.8 1.3 3.9 0 6.4-1.7 6.4-4.6 0-4.9-7.5-3.4-7.5-5.6 0-.7.6-1.1 1.9-1.1 1.5 0 3.1.5 4.4 1.2v-3.6Z" fill="currentColor" />
        </svg>
      );
    case "slack":
      return (
        <svg aria-hidden="true" viewBox="0 0 32 32">
          <path d="M13 6a3 3 0 0 1 3 3v5h-3a3 3 0 0 1 0-6V6Z" fill="#36c5f0" />
          <path d="M26 13a3 3 0 0 1-3 3h-5v-3a3 3 0 0 1 6 0h2Z" fill="#2eb67d" />
          <path d="M19 26a3 3 0 0 1-3-3v-5h3a3 3 0 0 1 0 6v2Z" fill="#ecb22e" />
          <path d="M6 19a3 3 0 0 1 3-3h5v3a3 3 0 0 1-6 0H6Z" fill="#e01e5a" />
        </svg>
      );
    case "salesforce":
    case "salesforce-knowledge":
      return (
        <svg aria-hidden="true" viewBox="0 0 32 32">
          <path d="M12 23h11.2a5 5 0 0 0 .8-9.9 7 7 0 0 0-13-2.7A5.6 5.6 0 0 0 12 23Z" fill="currentColor" />
        </svg>
      );
    case "microsoft-365":
    case "sharepoint":
      return (
        <svg aria-hidden="true" viewBox="0 0 32 32">
          <path d="M6 6h9v9H6V6Z" fill="#f35325" />
          <path d="M17 6h9v9h-9V6Z" fill="#81bc06" />
          <path d="M6 17h9v9H6v-9Z" fill="#05a6f0" />
          <path d="M17 17h9v9h-9v-9Z" fill="#ffba08" />
        </svg>
      );
    case "notion":
      return (
        <svg aria-hidden="true" viewBox="0 0 32 32">
          <path d="M7 7.5 22.5 6 25 8.5v16L9.5 26 7 23.4V7.5Z" fill="#fff" stroke="currentColor" strokeWidth="2" />
          <path d="M12 12h3.5l4.5 7.5V12h2.5v9h-3.4l-4.6-7.5V21H12v-9Z" fill="currentColor" />
        </svg>
      );
    case "freshdesk":
      return (
        <svg aria-hidden="true" viewBox="0 0 32 32">
          <path d="M8 18a8 8 0 1 1 16 0v6a2 2 0 0 1-2 2h-4v-5h6" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
          <path d="M10 19h4v6h-4v-6Zm8 0h4v6h-4v-6Z" fill="currentColor" />
        </svg>
      );
    case "intercom":
      return (
        <svg aria-hidden="true" viewBox="0 0 32 32">
          <rect x="7" y="7" width="18" height="18" rx="5" fill="currentColor" />
          <path d="M12 12v8m4-8v8m4-8v8" stroke="#fff" strokeLinecap="round" strokeWidth="2" />
        </svg>
      );
    case "confluence":
      return (
        <svg aria-hidden="true" viewBox="0 0 32 32">
          <path d="M9 20c2.6-4.6 4.4-7 7.2-7h7.2l-3.2 5.6h-4.4c-1.3 0-2 .8-3.3 3L11 24.2 9 20Z" fill="currentColor" />
          <path d="M23 12c-2.6 4.6-4.4 7-7.2 7H8.6l3.2-5.6h4.4c1.3 0 2-.8 3.3-3L21 7.8 23 12Z" fill="currentColor" opacity=".75" />
        </svg>
      );
    case "webhook-http":
      return (
        <svg aria-hidden="true" viewBox="0 0 32 32">
          <path d="M12 9 6 16l6 7m8-14 6 7-6 7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
        </svg>
      );
    default:
      return <span>{fallbackText}</span>;
  }
}
