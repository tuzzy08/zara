import { useCallback, useEffect, useState } from "react";
import { Cable, RefreshCw } from "lucide-react";
import type {
  IntegrationProviderCatalogEntry,
  IntegrationProviderCatalogTool,
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
import {
  createCopyableIntegrationSetupTemplate,
  createIntegrationSetupCopyPreview,
  createIntegrationSetupPresetPreviews,
  type IntegrationSetupCapabilityIntent,
  type IntegrationSetupCopyPreview,
  type IntegrationSetupPresetId,
  type IntegrationSetupPresetPreview,
} from "./integrationSetupPresets";
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

interface SetupPresetDraftIntent {
  enabled: boolean;
  approvalRequired: boolean;
}

type SetupPresetDrafts = Record<string, SetupPresetDraftIntent>;

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
  const [zendeskReconnectConnection, setZendeskReconnectConnection] = useState<IntegrationConnection | null>(null);
  const [freshdeskDraft, setFreshdeskDraft] = useState({
    subdomain: "",
    apiToken: "",
  });
  const [shopifyDraft, setShopifyDraft] = useState({
    shopDomain: "",
  });
  const [connectionScope, setConnectionScope] = useState<IntegrationConnectionScope>("workspace");
  const [activeCapabilitySetup, setActiveCapabilitySetup] = useState<string | null>(null);
  const [capabilityGrantDrafts, setCapabilityGrantDrafts] = useState<Record<string, CapabilityGrantDraft>>({});
  const [activeSetupPresetId, setActiveSetupPresetId] = useState<IntegrationSetupPresetId | null>(null);
  const [setupPresetDrafts, setSetupPresetDrafts] = useState<Partial<Record<IntegrationSetupPresetId, SetupPresetDrafts>>>({});
  const [setupCopyPreview, setSetupCopyPreview] = useState<IntegrationSetupCopyPreview | null>(null);

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
  const setupPresetPreviews = createIntegrationSetupPresetPreviews(catalogProviders);
  const activeSetupPreset = activeSetupPresetId === null
    ? undefined
    : setupPresetPreviews.find((preset) => preset.id === activeSetupPresetId);
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
    const nextScope = availability?.scope ?? connectionScope;
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

  const configureZendesk = async () => {
    const reconnectConnection = zendeskReconnectConnection;
    const effectiveScope = reconnectConnection?.availability.scope ?? connectionScope;
    const reconnectWorkspaceId = reconnectConnection?.availability.scope === "workspace"
      ? reconnectConnection.availability.workspaceId
      : undefined;
    const connection = await configureZendeskIntegration(organizationId, {
      subdomain: zendeskDraft.subdomain.trim(),
      email: zendeskDraft.email.trim(),
      apiToken: zendeskDraft.apiToken,
      connectionScope: effectiveScope,
      ...(effectiveScope === "workspace" ? { workspaceId: reconnectWorkspaceId ?? activeWorkspaceId } : {}),
      ...(reconnectConnection !== null ? { reconnectConnectionId: reconnectConnection.id } : {}),
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
    setZendeskReconnectConnection(null);
    showToast(reconnectConnection === null ? "Zendesk credentials saved." : "Zendesk reconnected.");
  };

  const startZendeskCredentialReconnect = (connection: IntegrationConnection) => {
    const accountSubdomain = connection.accountLabel?.endsWith(".zendesk.com") === true
      ? connection.accountLabel.slice(0, -".zendesk.com".length)
      : "";

    setZendeskReconnectConnection(connection);
    setZendeskDraft({
      subdomain: accountSubdomain,
      email: "",
      apiToken: "",
    });
    setConnectionScope(connection.availability.scope);
    showToast("Enter Zendesk credentials to reconnect.");
  };

  const cancelZendeskCredentialReconnect = () => {
    setZendeskReconnectConnection(null);
    setZendeskDraft({
      subdomain: "",
      email: "",
      apiToken: "",
    });
  };

  const configureFreshdesk = async () => {
    const connection = await configureFreshdeskIntegration(organizationId, {
      subdomain: freshdeskDraft.subdomain.trim(),
      apiToken: freshdeskDraft.apiToken,
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
    setFreshdeskDraft((current) => ({
      ...current,
      apiToken: "",
    }));
    showToast("Freshdesk credentials saved.");
  };

  const connectShopify = async () => {
    await connectProvider("shopify", undefined, undefined, undefined, {
      shopDomain: shopifyDraft.shopDomain.trim(),
    });
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

  const previewSetupPreset = (preset: IntegrationSetupPresetPreview) => {
    setSetupPresetDrafts((current) => ({
      ...current,
      [preset.id]: current[preset.id] ?? createSetupPresetDraft(preset),
    }));
    setActiveSetupPresetId(preset.id);
    setSetupCopyPreview(null);
  };

  const updateSetupPresetIntent = (
    preset: IntegrationSetupPresetPreview,
    intent: IntegrationSetupCapabilityIntent,
    nextDraft: Partial<SetupPresetDraftIntent>,
  ) => {
    setSetupPresetDrafts((current) => {
      const presetDraft = current[preset.id] ?? createSetupPresetDraft(preset);
      const intentKey = getSetupPresetIntentKey(intent);

      return {
        ...current,
        [preset.id]: {
          ...presetDraft,
          [intentKey]: {
            ...(presetDraft[intentKey] ?? createSetupPresetIntentDraft(intent)),
            ...nextDraft,
          },
        },
      };
    });
  };

  const openSetupCopyPreview = (preset: IntegrationSetupPresetPreview) => {
    const template = createCopyableIntegrationSetupTemplate(preset);

    setSetupCopyPreview(createIntegrationSetupCopyPreview(template, catalogProviders));
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

      <section className="tenant-page-grid">
        <div className="surface-card overflow-hidden">
          <TenantSectionHeader eyebrow="Zendesk" title="Secure ticket credentials" />
          {zendeskReconnectConnection === null ? null : (
            <TenantStatusBanner tone="neutral">
              Reconnecting Zendesk connection. Enter the Zendesk subdomain, email, and API token to create a fresh connection.
            </TenantStatusBanner>
          )}
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
                disabled={zendeskReconnectConnection !== null}
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
              {zendeskReconnectConnection === null ? "Save Zendesk credentials" : "Reconnect Zendesk credentials"}
            </button>
            {zendeskReconnectConnection === null ? null : (
              <button
                className="workflow-button"
                type="button"
                onClick={cancelZendeskCredentialReconnect}
              >
                Cancel reconnect
              </button>
            )}
          </div>
        </div>

        <div className="surface-card overflow-hidden">
          <TenantSectionHeader eyebrow="Freshdesk" title="Secure Solutions credentials" />
          <div className="tenant-form-grid">
            <label className="form-field">
              <span>Freshdesk subdomain</span>
              <input
                type="text"
                value={freshdeskDraft.subdomain}
                onChange={(event) => setFreshdeskDraft((current) => ({ ...current, subdomain: event.target.value }))}
                placeholder="acme-support"
              />
            </label>
            <label className="form-field">
              <span>Freshdesk API token</span>
              <input
                type="password"
                value={freshdeskDraft.apiToken}
                onChange={(event) => setFreshdeskDraft((current) => ({ ...current, apiToken: event.target.value }))}
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
              onClick={() => void configureFreshdesk()}
            >
              Save Freshdesk credentials
            </button>
          </div>
        </div>

        <div className="surface-card overflow-hidden">
          <TenantSectionHeader eyebrow="Shopify" title="Store OAuth setup" />
          <div className="tenant-form-grid">
            <label className="form-field">
              <span>Shopify store domain</span>
              <input
                type="text"
                value={shopifyDraft.shopDomain}
                onChange={(event) => setShopifyDraft({ shopDomain: event.target.value })}
                placeholder="acme-store.myshopify.com"
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
              onClick={() => void connectShopify()}
            >
              Connect Shopify
            </button>
          </div>
        </div>

        <div className="surface-card overflow-hidden">
          <TenantSectionHeader eyebrow="Connections" title="Provider health" />
          <div className="tenant-list">
            {connections.map((connection) => {
              const branding = getIntegrationProviderBranding(connection.provider);
              const actionLabel = getConnectionActionLabel(connection.provider, branding.label);
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
                      connection.provider === "zendesk" ? (
                        <button
                          className="workflow-button"
                          type="button"
                          aria-label="Reconnect Zendesk with credentials"
                          onClick={() => startZendeskCredentialReconnect(connection)}
                        >
                          Reconnect credentials
                        </button>
                      ) : (
                        <button
                          className="workflow-button"
                          type="button"
                          aria-label={`Reconnect ${actionLabel} with OAuth`}
                          onClick={() => void connectProvider(connection.provider, connection.id, connection.availability, undefined, getConnectionSetupOptions(connection))}
                        >
                          Reconnect OAuth
                        </button>
                      )
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
                        <button
                          className="workflow-button workflow-button-danger"
                          type="button"
                          aria-label={`Revoke ${actionLabel} connection`}
                          onClick={() => void revokeConnection(connection.id)}
                        >
                          Revoke
                        </button>
                      </>
                    )}
                    <button
                      className="workflow-button workflow-button-danger"
                      type="button"
                      aria-label={`Delete ${actionLabel} connection`}
                      onClick={() => void deleteConnection(connection.id)}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <div className="surface-card overflow-hidden">
          <TenantSectionHeader eyebrow="Setup presets" title="Guided capability previews" />
          <div className="tenant-preset-list" role="list">
            {setupPresetPreviews.map((preset) => (
              <button
                key={preset.id}
                className={`tenant-preset-button${activeSetupPreset?.id === preset.id ? " tenant-preset-button-active" : ""}`}
                type="button"
                aria-label={`Preview ${preset.name} setup preset`}
                onClick={() => previewSetupPreset(preset)}
              >
                <span>{preset.name}</span>
                <small>{preset.capabilityIntents.length} capabilities</small>
              </button>
            ))}
          </div>
          {setupPresetPreviews.length === 0 ? (
            <TenantStatusBanner tone="neutral">No setup presets available.</TenantStatusBanner>
          ) : null}
          {activeSetupPreset === undefined ? null : (
            <SetupPresetPreview
              preset={activeSetupPreset}
              draft={setupPresetDrafts[activeSetupPreset.id] ?? createSetupPresetDraft(activeSetupPreset)}
              onChange={updateSetupPresetIntent}
              onCopy={openSetupCopyPreview}
            />
          )}
          {setupCopyPreview === null ? null : <SetupCopyPreviewPanel preview={setupCopyPreview} />}
        </div>

        <div className="surface-card overflow-hidden">
          <TenantSectionHeader eyebrow="Capabilities" title="Capability setup" />
          <div className="tenant-list">
            {capabilitySetupProviders.map(({ provider, capabilities }) => {
              const branding = getIntegrationProviderBranding(provider.id, {
                label: provider.label,
                logoToken: provider.logoToken,
              });
              const providerConnections = connections.filter((connection) =>
                connection.provider === provider.id && connection.status === "connected"
              );

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
                    {providerConnections.length === 0 && provider.setupSchema.type === "oauth" ? (
                      <button
                        className="workflow-button"
                        type="button"
                        aria-label={`Connect ${branding.label}`}
                        onClick={() => void connectProvider(provider.id)}
                      >
                        Connect
                      </button>
                    ) : null}
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

function SetupPresetPreview({
  draft,
  preset,
  onChange,
  onCopy,
}: {
  draft: SetupPresetDrafts;
  preset: IntegrationSetupPresetPreview;
  onChange: (
    preset: IntegrationSetupPresetPreview,
    intent: IntegrationSetupCapabilityIntent,
    nextDraft: Partial<SetupPresetDraftIntent>,
  ) => void;
  onCopy: (preset: IntegrationSetupPresetPreview) => void;
}) {
  const enabledCount = preset.capabilityIntents.filter((intent) =>
    draft[getSetupPresetIntentKey(intent)]?.enabled ?? true,
  ).length;

  return (
    <section
      aria-label={`${preset.name} preset preview`}
      className="tenant-preset-preview"
    >
      <div className="tenant-preset-preview-header">
        <div>
          <div className="panel-title">{preset.name}</div>
          <div className="panel-meta">{preset.summary}</div>
        </div>
        <span className="table-status">{getConnectionScopeOptionLabel(preset.recommendedConnectionScope)}</span>
      </div>
      <div className="tenant-preset-intents">
        {preset.capabilityIntents.map((intent) => {
          const intentKey = getSetupPresetIntentKey(intent);
          const intentDraft = draft[intentKey] ?? createSetupPresetIntentDraft(intent);
          const canEditApproval = intent.capability !== "knowledge-source";

          return (
            <article key={intentKey} className="tenant-preset-intent">
              <label className="tenant-checkbox-field">
                <input
                  type="checkbox"
                  checked={intentDraft.enabled}
                  onChange={(event) => onChange(preset, intent, { enabled: event.target.checked })}
                />
                <span>{getSetupPresetIntentLabel(intent)}</span>
              </label>
              <div className="tenant-preset-intent-actions">
                <span className="table-status">{getCapabilityLabel(intent.capability)}</span>
                {intentDraft.approvalRequired ? <span className="table-status">Approval required</span> : null}
                {canEditApproval ? (
                  <label className="tenant-checkbox-field">
                    <input
                      type="checkbox"
                      checked={intentDraft.approvalRequired}
                      onChange={(event) => onChange(preset, intent, { approvalRequired: event.target.checked })}
                    />
                    <span>Require approval</span>
                  </label>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
      <div className="tenant-preset-footer">
        <span>{enabledCount} selected</span>
        <button className="workflow-button" type="button" onClick={() => onCopy(preset)}>
          Copy setup template
        </button>
      </div>
    </section>
  );
}

function SetupCopyPreviewPanel({ preview }: { preview: IntegrationSetupCopyPreview }) {
  return (
    <section
      aria-label={`${preview.title} copy plan`}
      className="tenant-copy-preview"
    >
      <div className="tenant-copy-preview-header">
        <div>
          <div className="panel-title">{preview.title}</div>
          <div className="panel-meta">{preview.recommendedConnectionScopeLabel}</div>
        </div>
        <span className="table-status">Review required</span>
      </div>
      <div className="tenant-copy-preview-grid">
        <div>
          <div className="panel-title">Required selections</div>
          <ul className="tenant-plain-list">
            {preview.requiredSelections.map((selection) => (
              <li key={selection.id}>{selection.label}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="panel-title">Not cloned</div>
          <ul className="tenant-plain-list">
            {preview.notClonedItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="tenant-copy-capability-list">
        {preview.capabilityRows.map((row) => (
          <article key={`${row.title}:${row.detail}`} className="tenant-copy-capability-row">
            <div>
              <div className="panel-title">{row.title}</div>
              <div className="panel-meta">{row.detail}</div>
            </div>
            <span className="table-status">{row.approvalLabel}</span>
          </article>
        ))}
      </div>
    </section>
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

function createSetupPresetDraft(preset: IntegrationSetupPresetPreview): SetupPresetDrafts {
  return Object.fromEntries(
    preset.capabilityIntents.map((intent) => [
      getSetupPresetIntentKey(intent),
      createSetupPresetIntentDraft(intent),
    ]),
  );
}

function createSetupPresetIntentDraft(intent: IntegrationSetupCapabilityIntent): SetupPresetDraftIntent {
  return {
    enabled: true,
    approvalRequired: intent.approvalRequired,
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

function getSetupPresetIntentKey(intent: IntegrationSetupCapabilityIntent) {
  switch (intent.capability) {
    case "agent-tool":
      return `${intent.capability}:${intent.providerId}:${intent.toolId}`;
    case "knowledge-source":
      return `${intent.capability}:${intent.providerId}`;
    case "post-call-sync":
      return `${intent.capability}:${intent.providerId}:${intent.target}`;
  }
}

function getSetupPresetIntentLabel(intent: IntegrationSetupCapabilityIntent) {
  const providerLabel = getSetupPresetProviderLabel(intent.providerId);

  switch (intent.capability) {
    case "agent-tool":
      return intent.toolName;
    case "knowledge-source":
      return `${providerLabel} knowledge source`;
    case "post-call-sync":
      return `${providerLabel} call-summary sync`;
  }
}

function getSetupPresetProviderLabel(provider: IntegrationProvider) {
  return getIntegrationProviderBranding(provider).label
    .replace(/\s+Support$/, "")
    .replace(/\s+CRM$/, "");
}

function getConnectionScopeOptionLabel(scope: IntegrationConnectionScope) {
  return scope === "organization" ? "Use across organization" : "Use only in this workspace";
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
