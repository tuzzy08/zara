import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  Cable,
  CheckCircle2,
  CreditCard,
  DatabaseZap,
  ExternalLink,
  FileClock,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";

import {
  checkIntegrationHealth,
  fetchConnectorTools,
  fetchIntegrationConnections,
  fetchToolGrants,
  fetchWebhookTools,
  revokeIntegrationConnection,
  startIntegrationConnect,
  type ConnectorTool,
  type IntegrationConnection,
  type IntegrationProvider,
  type ToolGrant,
  type WebhookTool,
} from "./tenantIntegrationsApi";
import {
  approveMemoryDraft,
  deleteMemoryRecord,
  disableMemoryRecord,
  fetchTenantMemoryExport,
  purgeMemoryRetention,
  rejectMemoryDraft,
  type TenantMemoryExport,
} from "./tenantMemoryApi";
import {
  fetchTenantBillingState,
  openPolarCustomerPortal,
  startPolarCheckout,
  type TenantBillingState,
} from "./tenantBillingApi";

const providerLabels: Record<IntegrationProvider, string> = {
  zendesk: "Zendesk Support",
  hubspot: "HubSpot CRM",
  "google-workspace": "Google Workspace",
  notion: "Notion",
  "webhook-http": "Webhook HTTP",
};

const oauthProviders = ["zendesk", "hubspot", "google-workspace", "notion"] as const;

interface TenantPageProps {
  organizationId: string;
  activeWorkspaceId: string;
  showToast: (message: string) => void;
}

export function TenantIntegrationsScreen({ organizationId, activeWorkspaceId, showToast }: TenantPageProps) {
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [connectorTools, setConnectorTools] = useState<ConnectorTool[]>([]);
  const [webhookTools, setWebhookTools] = useState<WebhookTool[]>([]);
  const [toolGrants, setToolGrants] = useState<ToolGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadIntegrations = async () => {
    setLoading(true);
    setErrorMessage(null);

    try {
      const [nextConnections, nextWebhookTools, nextToolGrants, ...toolsByProvider] = await Promise.all([
        fetchIntegrationConnections(organizationId),
        fetchWebhookTools(organizationId, activeWorkspaceId),
        fetchToolGrants(organizationId, activeWorkspaceId),
        ...oauthProviders.map((provider) => fetchConnectorTools(organizationId, provider)),
      ]);

      setConnections(nextConnections);
      setWebhookTools(nextWebhookTools);
      setToolGrants(nextToolGrants);
      setConnectorTools(toolsByProvider.flat());
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Integrations could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadIntegrations();
  }, [organizationId, activeWorkspaceId]);

  const availableToolCount = connectorTools.length + webhookTools.length;
  const activeGrantCount = toolGrants.filter((grant) => grant.status === "active").length;

  const refreshConnection = async (connectionId: string) => {
    const connection = await checkIntegrationHealth(organizationId, connectionId);
    setConnections((current) => current.map((candidate) => candidate.id === connectionId ? connection : candidate));
    showToast("Integration health refreshed.");
  };

  const revokeConnection = async (connectionId: string) => {
    const connection = await revokeIntegrationConnection(organizationId, connectionId);
    setConnections((current) => current.map((candidate) => candidate.id === connectionId ? connection : candidate));
    showToast("Integration revoked.");
  };

  const connectProvider = async (provider: IntegrationProvider, reconnectConnectionId?: string) => {
    const connect = await startIntegrationConnect(organizationId, provider, reconnectConnectionId);
    showToast(`Secure OAuth handoff ready: ${new URL(connect.authorizationUrl).hostname}`);
  };

  return (
    <div className="tenant-feature-page">
      <PageIntro
        icon={Cable}
        eyebrow="Integrations"
        title="Integration command center"
        body="Connect CRM, productivity, and webhook tools with visible health, grants, and revocation posture while provider tokens stay inside Zara."
      />

      <SummaryGrid
        items={[
          { label: "Connections", value: String(connections.length), detail: "OAuth accounts" },
          { label: "Available tools", value: String(availableToolCount), detail: "Connector and webhook tools" },
          { label: "Active grants", value: String(activeGrantCount), detail: "Workflow permissions" },
        ]}
      />

      {errorMessage === null ? null : <StatusBanner tone="danger">{errorMessage}</StatusBanner>}
      {loading ? <StatusBanner tone="neutral">Loading integrations.</StatusBanner> : null}

      <section className="tenant-page-grid">
        <div className="surface-card overflow-hidden">
          <SectionHeader eyebrow="Connections" title="Provider health" />
          <div className="tenant-list">
            {connections.map((connection) => (
              <article key={connection.id} className="tenant-row">
                <div className="tenant-row-main">
                  <div className="tenant-row-icon"><KeyRound size={16} /></div>
                  <div>
                    <div className="panel-title">{providerLabels[connection.provider]}</div>
                    <div className="panel-meta">
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
                    aria-label={`Check health for ${providerLabels[connection.provider]}`}
                    onClick={() => void refreshConnection(connection.id)}
                  >
                    <RefreshCw size={15} />
                  </button>
                  {connection.status === "revoked" ? (
                    <button className="workflow-button" type="button" onClick={() => void connectProvider(connection.provider, connection.id)}>
                      Reconnect
                    </button>
                  ) : (
                    <button className="workflow-button workflow-button-danger" type="button" onClick={() => void revokeConnection(connection.id)}>
                      Revoke
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="surface-card overflow-hidden">
          <SectionHeader eyebrow="Catalog" title="Tools and grants" />
          <div className="tenant-list">
            {connectorTools.slice(0, 5).map((tool) => (
              <article key={tool.toolId} className="tenant-row">
                <div>
                  <div className="panel-title">{tool.toolId}</div>
                  <div className="panel-meta">{tool.description}</div>
                </div>
                <span className="table-status">{providerLabels[tool.provider]}</span>
              </article>
            ))}
            {webhookTools.map((tool) => (
              <article key={tool.id} className="tenant-row">
                <div>
                  <div className="panel-title">{tool.toolName}</div>
                  <div className="panel-meta">{tool.request.method} {tool.request.url}</div>
                </div>
                <span className="table-status">Webhook HTTP</span>
              </article>
            ))}
            {toolGrants.map((grant) => (
              <article key={grant.id} className="tenant-row">
                <div>
                  <div className="panel-title">{grant.toolId}</div>
                  <div className="panel-meta">{grant.workflowId}</div>
                </div>
                <span className="table-status">{grant.approvalRequired ? "Approval required" : grant.risk}</span>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

export function TenantMemoryScreen({ organizationId, showToast }: TenantPageProps) {
  const [memoryExport, setMemoryExport] = useState<TenantMemoryExport | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadMemory = async () => {
    setLoading(true);
    setErrorMessage(null);

    try {
      setMemoryExport(await fetchTenantMemoryExport(organizationId));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Memory state could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMemory();
  }, [organizationId]);

  const activeMemories = memoryExport?.memories.filter((memory) => memory.status === "active") ?? [];
  const pendingDrafts = memoryExport?.drafts.filter((draft) => draft.status === "draft") ?? [];
  const knowledge = memoryExport?.knowledge ?? [];
  const ingestions = memoryExport?.ingestions ?? [];

  const approveDraft = async (draftId: string) => {
    await approveMemoryDraft(organizationId, draftId);
    showToast("Memory draft approved.");
    await loadMemory();
  };

  const rejectDraft = async (draftId: string) => {
    await rejectMemoryDraft(organizationId, draftId);
    showToast("Memory draft rejected.");
    await loadMemory();
  };

  const disableMemory = async (memoryId: string) => {
    await disableMemoryRecord(organizationId, memoryId);
    showToast("Memory disabled.");
    await loadMemory();
  };

  const deleteMemory = async (memoryId: string) => {
    await deleteMemoryRecord(organizationId, memoryId);
    showToast("Memory deleted.");
    await loadMemory();
  };

  const purgeRetention = async () => {
    await purgeMemoryRetention(organizationId);
    showToast("Retention purge completed.");
    await loadMemory();
  };

  return (
    <div className="tenant-feature-page">
      <PageIntro
        icon={DatabaseZap}
        eyebrow="Memory"
        title="Memory control room"
        body="Review approved facts, pending drafts, knowledge sources, ingestion health, and audit posture before the runtime can use tenant memory."
      />

      <SummaryGrid
        items={[
          { label: "Approved memory", value: String(activeMemories.length), detail: "Callable facts" },
          { label: "Pending drafts", value: String(pendingDrafts.length), detail: "Need approval" },
          { label: "Knowledge", value: String(knowledge.length), detail: "Policies and FAQs" },
        ]}
      />

      {errorMessage === null ? null : <StatusBanner tone="danger">{errorMessage}</StatusBanner>}
      {loading ? <StatusBanner tone="neutral">Loading memory.</StatusBanner> : null}

      <section className="tenant-page-grid">
        <div className="surface-card overflow-hidden">
          <SectionHeader eyebrow="Approved" title="Durable memory" />
          <div className="tenant-list">
            {activeMemories.map((memory) => (
              <article key={memory.id} className="tenant-row">
                <div>
                  <div className="panel-title">{memory.text}</div>
                  <div className="panel-meta">
                    {memory.scope} - confidence {Math.round(memory.confidence * 100)}% - {memory.auditTrail.length} audit events
                  </div>
                </div>
                <div className="tenant-row-actions">
                  <button className="icon-button" type="button" aria-label={`Disable memory ${memory.id}`} onClick={() => void disableMemory(memory.id)}>
                    <XCircle size={15} />
                  </button>
                  <button className="icon-button" type="button" aria-label={`Delete memory ${memory.id}`} onClick={() => void deleteMemory(memory.id)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="surface-card overflow-hidden">
          <SectionHeader eyebrow="Approval" title="Drafts" />
          <div className="tenant-list">
            {pendingDrafts.map((draft) => (
              <article key={draft.id} className="tenant-row">
                <div>
                  <div className="panel-title">{draft.text}</div>
                  <div className="panel-meta">{draft.scope} - confidence {Math.round(draft.confidence * 100)}%</div>
                </div>
                <div className="tenant-row-actions">
                  <button className="icon-button" type="button" aria-label={`Approve memory draft ${draft.id}`} onClick={() => void approveDraft(draft.id)}>
                    <CheckCircle2 size={15} />
                  </button>
                  <button className="icon-button" type="button" aria-label={`Reject memory draft ${draft.id}`} onClick={() => void rejectDraft(draft.id)}>
                    <XCircle size={15} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="surface-card overflow-hidden">
          <SectionHeader eyebrow="Knowledge" title="Policies and ingestion" />
          <div className="tenant-list">
            {knowledge.map((record) => (
              <article key={record.id} className="tenant-row">
                <div>
                  <div className="panel-title">{record.text}</div>
                  <div className="panel-meta">{record.title} - {formatStatus(record.conflictState)}</div>
                </div>
                <span className="table-status">{formatStatus(record.status)}</span>
              </article>
            ))}
            {ingestions.map((ingestion) => (
              <article key={ingestion.id} className="tenant-row">
                <div>
                  <div className="panel-title">{formatStatus(ingestion.status)}</div>
                  <div className="panel-meta">{ingestion.succeededCount}/{ingestion.sourceCount} sources indexed</div>
                </div>
                <FileClock size={16} />
              </article>
            ))}
          </div>
        </div>

        <div className="surface-card overflow-hidden">
          <SectionHeader eyebrow="Privacy" title="Audit and retention" />
          <div className="tenant-list">
            <article className="tenant-row">
              <div>
                <div className="panel-title">Export package</div>
                <div className="panel-meta">Includes memory, drafts, knowledge, ingestions, and embedding metadata without raw vectors.</div>
              </div>
              <button className="workflow-button" type="button" aria-label="Export tenant memory" onClick={() => showToast("Tenant memory export prepared.")}>
                Export
              </button>
            </article>
            <article className="tenant-row">
              <div>
                <div className="panel-title">Retention purge</div>
                <div className="panel-meta">Deletes expired memory-module state when legal hold is off.</div>
              </div>
              <button className="workflow-button workflow-button-danger" type="button" onClick={() => void purgeRetention()}>
                Purge
              </button>
            </article>
          </div>
        </div>
      </section>
    </div>
  );
}

export function TenantBillingScreen({ organizationId, showToast }: TenantPageProps) {
  const [billing, setBilling] = useState<TenantBillingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadBilling = async () => {
    setLoading(true);
    setErrorMessage(null);

    try {
      setBilling(await fetchTenantBillingState(organizationId));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Billing state could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBilling();
  }, [organizationId]);

  const totalUsageUsd = useMemo(
    () => billing?.usage.reduce((sum, usage) => sum + usage.costUsd, 0) ?? 0,
    [billing],
  );

  const openPortal = async () => {
    const portal = await openPolarCustomerPortal(organizationId);
    showToast(`Polar portal ready: ${new URL(portal.customerPortalUrl).hostname}`);
  };

  const startCheckout = async () => {
    const checkout = await startPolarCheckout(organizationId, billing?.plan.slug ?? "growth");
    showToast(`Polar checkout ready: ${new URL(checkout.checkoutUrl).hostname}`);
  };

  return (
    <div className="tenant-feature-page">
      <PageIntro
        icon={CreditCard}
        eyebrow="Billing"
        title="Billing and subscription"
        body="Manage plan state, Polar subscription access, customer portal entry, budgets, invoices, and usage charges from Zara-owned backend APIs."
      />

      {errorMessage === null ? null : <StatusBanner tone="danger">{errorMessage}</StatusBanner>}
      {loading ? <StatusBanner tone="neutral">Loading billing.</StatusBanner> : null}

      {billing === null ? null : (
        <>
          <SummaryGrid
            items={[
              { label: "Plan", value: billing.plan.name, detail: formatStatus(billing.plan.status) },
              { label: "Usage spend", value: formatUsd(totalUsageUsd), detail: "Current cycle" },
              { label: "Budget", value: formatUsd(billing.plan.budgetUsedUsd), detail: `${formatUsd(billing.plan.budgetLimitUsd)} limit` },
            ]}
          />

          <section className="tenant-page-grid">
            <div className="surface-card overflow-hidden">
              <SectionHeader eyebrow="Subscription" title="Polar customer state" />
              <div className="tenant-list">
                <article className="tenant-row">
                  <div>
                    <div className="panel-title">{billing.plan.name}</div>
                    <div className="panel-meta">
                      {formatUsd(billing.plan.monthlyBaseUsd)} base - {billing.plan.includedMinutes.toLocaleString()} included minutes
                    </div>
                  </div>
                  <span className="table-status">{formatStatus(billing.plan.status)}</span>
                </article>
                <article className="tenant-row">
                  <div>
                    <div className="panel-title">Customer external id</div>
                    <div className="panel-meta">{billing.customerExternalId}</div>
                  </div>
                  <ShieldCheck size={16} />
                </article>
                {billing.entitlements.map((entitlement) => (
                  <article key={entitlement.id} className="tenant-row">
                    <div>
                      <div className="panel-title">{entitlement.label}</div>
                      <div className="panel-meta">{entitlement.id}</div>
                    </div>
                    <span className="table-status">{formatStatus(entitlement.status)}</span>
                  </article>
                ))}
                <div className="tenant-action-bar">
                  <button className="workflow-button workflow-button-primary" type="button" onClick={() => void startCheckout()}>
                    <ExternalLink size={14} />
                    Checkout
                  </button>
                  <button className="workflow-button" type="button" aria-label="Open Polar customer portal" onClick={() => void openPortal()}>
                    <ExternalLink size={14} />
                    Portal
                  </button>
                </div>
              </div>
            </div>

            <div className="surface-card overflow-hidden">
              <SectionHeader eyebrow="Usage" title="Meters and budget" />
              <div className="tenant-list">
                {billing.usage.map((usage) => (
                  <article key={usage.id} className="tenant-row">
                    <div>
                      <div className="panel-title">{usage.label}</div>
                      <div className="panel-meta">
                        {usage.used.toLocaleString()} {usage.unit}{usage.limit === undefined ? "" : ` of ${usage.limit.toLocaleString()}`}
                      </div>
                    </div>
                    <strong>{formatUsd(usage.costUsd)}</strong>
                  </article>
                ))}
                {billing.plan.budgetWarning ? (
                  <StatusBanner tone="danger">Budget usage has crossed the warning threshold.</StatusBanner>
                ) : null}
              </div>
            </div>

            <div className="surface-card overflow-hidden">
              <SectionHeader eyebrow="Orders" title="Invoices" />
              <div className="tenant-list">
                {billing.invoices.map((invoice) => (
                  <article key={invoice.id} className="tenant-row">
                    <div>
                      <div className="panel-title">{invoice.invoiceNumber}</div>
                      <div className="panel-meta">{invoice.providerOrderId} - {new Date(invoice.createdAt).toLocaleDateString()}</div>
                    </div>
                    <strong>{formatUsd(invoice.amountUsd)}</strong>
                  </article>
                ))}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function PageIntro({
  icon: Icon,
  eyebrow,
  title,
  body,
}: {
  icon: typeof Cable;
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <section className="surface-card tenant-page-intro">
      <div className="tenant-page-intro-icon"><Icon size={20} /></div>
      <div>
        <div className="eyebrow-copy">{eyebrow}</div>
        <h1 className="tenant-page-title">{title}</h1>
        <p className="body-copy tenant-page-copy">{body}</p>
      </div>
    </section>
  );
}

function SummaryGrid({ items }: { items: Array<{ label: string; value: string; detail: string }> }) {
  return (
    <section className="tenant-summary-grid">
      {items.map((item) => (
        <div key={item.label} className="metric-card">
          <div className="metric-label">{item.label}</div>
          <div className="metric-value">{item.value}</div>
          <div className="metric-detail">{item.detail}</div>
        </div>
      ))}
    </section>
  );
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="section-header">
      <div>
        <div className="eyebrow-copy">{eyebrow}</div>
        <div className="subhead-copy mt-1">{title}</div>
      </div>
    </div>
  );
}

function StatusBanner({ tone, children }: { tone: "neutral" | "danger"; children: string }) {
  return (
    <div className={`tenant-status-banner tenant-status-banner-${tone}`} role={tone === "danger" ? "alert" : "status"}>
      {tone === "danger" ? <XCircle size={15} /> : <BadgeCheck size={15} />}
      <span>{children}</span>
    </div>
  );
}

function formatStatus(value: string) {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}
