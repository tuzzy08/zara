import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, FileClock, Trash2, XCircle } from "lucide-react";
import type { TenantRole } from "@zara/core";

import {
  approveKnowledgeReviewDraft,
  approveMemoryDraft,
  createKnowledgeSource,
  deleteMemoryRecord,
  disableMemoryRecord,
  fetchTenantMemoryExport,
  purgeMemoryRetention,
  rejectMemoryDraft,
  type CreateKnowledgeSourceRequest,
  type KnowledgeRecordType,
  type KnowledgeReviewDraft,
  type KnowledgeSourceSyncCadence,
  type KnowledgeSourceSyncMode,
  type KnowledgeSourceType,
  type TenantMemoryExport,
} from "./tenantMemoryApi";
import { formatStatus } from "./tenantPageFormatting";
import { TenantSectionHeader } from "./TenantSectionHeader";
import { TenantStatusBanner } from "./TenantStatusBanner";
import { TenantSummaryGrid } from "./TenantSummaryGrid";
import { type TenantPageProps } from "./tenantPageTypes";
import {
  fetchIntegrationCatalog,
  fetchIntegrationConnections,
  type IntegrationConnection,
  type IntegrationProvider,
} from "./tenantIntegrationsApi";

interface KnowledgeSourceFormState {
  sourceType: KnowledgeSourceType;
  syncSelection: "snapshot" | "manual" | "daily";
  workspaceId: string;
  workflowIdsText: string;
  title: string;
  text: string;
  uri: string;
  crawlLimitText: string;
  excludePathsText: string;
  recordType: KnowledgeRecordType;
  providerId: string;
  integrationConnectionId: string;
  externalId: string;
}

const knowledgeRecordTypes: KnowledgeRecordType[] = [
  "faq",
  "policy",
  "procedure",
  "troubleshooting",
  "pricing",
  "escalation",
  "legal_compliance",
  "general_reference",
];

const sourceTypes: KnowledgeSourceType[] = ["manual_text", "single_url", "pdf", "provider_import", "website_crawl"];
const highRiskRecordTypes = new Set<KnowledgeRecordType>(["policy", "pricing", "escalation", "legal_compliance"]);

export function TenantMemoryScreen({
  organizationId,
  activeWorkspaceId,
  activeActorUserId,
  activeTenantRole,
  showToast,
}: TenantPageProps & { activeActorUserId: string; activeTenantRole: TenantRole }) {
  const [memoryExport, setMemoryExport] = useState<TenantMemoryExport | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sourceSubmitting, setSourceSubmitting] = useState(false);
  const [sourceForm, setSourceForm] = useState<KnowledgeSourceFormState>(() => createInitialSourceForm(activeWorkspaceId));
  const [reviewRecordTypes, setReviewRecordTypes] = useState<Record<string, KnowledgeRecordType>>({});
  const [highRiskConfirmations, setHighRiskConfirmations] = useState<Record<string, boolean>>({});
  const [knowledgeProviders, setKnowledgeProviders] = useState<Array<{ id: IntegrationProvider; label: string }>>([]);
  const [integrationConnections, setIntegrationConnections] = useState<IntegrationConnection[]>([]);
  const [integrationErrorMessage, setIntegrationErrorMessage] = useState<string | null>(null);

  const loadMemory = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);

    try {
      setMemoryExport(await fetchTenantMemoryExport(organizationId));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Memory state could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void loadMemory();
  }, [loadMemory]);

  const loadKnowledgeIntegrations = useCallback(async () => {
    try {
      const [connections, providers] = await Promise.all([
        fetchIntegrationConnections(organizationId, activeWorkspaceId),
        fetchIntegrationCatalog(organizationId),
      ]);

      setIntegrationConnections(connections.filter((connection) => connection.status === "connected"));
      setKnowledgeProviders(
        providers
          .filter((provider) => provider.knowledgeSource.supported)
          .map((provider) => ({ id: provider.id, label: provider.label })),
      );
      setIntegrationErrorMessage(null);
    } catch (error) {
      setIntegrationErrorMessage(error instanceof Error ? error.message : "Knowledge integrations could not be loaded.");
    }
  }, [activeWorkspaceId, organizationId]);

  useEffect(() => {
    void loadKnowledgeIntegrations();
  }, [loadKnowledgeIntegrations]);

  useEffect(() => {
    setSourceForm((current) => ({ ...current, workspaceId: activeWorkspaceId }));
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (sourceForm.providerId.length === 0 && knowledgeProviders.length > 0) {
      setSourceForm((current) => ({ ...current, providerId: knowledgeProviders[0]!.id }));
    }
  }, [knowledgeProviders, sourceForm.providerId.length]);

  const providerConnections = integrationConnections.filter((connection) => connection.provider === sourceForm.providerId);

  useEffect(() => {
    if (
      sourceForm.sourceType === "provider_import"
      && sourceForm.providerId.length > 0
      && providerConnections.every((connection) => connection.id !== sourceForm.integrationConnectionId)
    ) {
      setSourceForm((current) => ({
        ...current,
        integrationConnectionId: providerConnections[0]?.id ?? "",
      }));
    }
  }, [providerConnections, sourceForm.integrationConnectionId, sourceForm.providerId, sourceForm.sourceType]);

  const activeMemories = memoryExport?.memories.filter((memory) => memory.status === "active") ?? [];
  const pendingDrafts = memoryExport?.drafts.filter((draft) => draft.status === "draft") ?? [];
  const knowledge = memoryExport?.knowledge ?? [];
  const ingestions = memoryExport?.ingestions ?? [];
  const knowledgeSources = memoryExport?.knowledgeSources ?? [];
  const knowledgeReviewDrafts =
    memoryExport?.knowledgeReviewDrafts?.filter((draft) =>
      draft.status === "draft"
    ) ?? [];
  const sourceNeedsText = sourceForm.sourceType !== "website_crawl" && sourceForm.sourceType !== "provider_import";
  const sourceNeedsUri =
    sourceForm.sourceType === "single_url"
    || sourceForm.sourceType === "pdf"
    || sourceForm.sourceType === "website_crawl";
  const providerSourceSelectionCopy = getProviderSourceSelectionCopy(sourceForm.providerId);
  const crawlLimit = parseCrawlLimit(sourceForm.crawlLimitText);
  const sourceCanSubmit =
    sourceForm.title.trim().length > 0
    && (!sourceNeedsText || sourceForm.text.trim().length > 0)
    && sourceForm.workspaceId.trim().length > 0
    && (!sourceNeedsUri || sourceForm.uri.trim().length > 0)
    && (sourceForm.sourceType !== "website_crawl" || crawlLimit !== undefined)
    && (
      sourceForm.sourceType !== "provider_import"
      || (
        sourceForm.providerId.trim().length > 0
        && sourceForm.integrationConnectionId.trim().length > 0
        && sourceForm.externalId.trim().length > 0
      )
    );

  const addKnowledgeSource = async () => {
    if (!sourceCanSubmit) {
      return;
    }

    setSourceSubmitting(true);

    try {
      const workflowIds = parseWorkflowIds(sourceForm.workflowIdsText);
      const sourceInput: CreateKnowledgeSourceRequest = {
        actorUserId: activeActorUserId,
        sourceType: sourceForm.sourceType,
        workspaceId: sourceForm.workspaceId.trim(),
        title: sourceForm.title.trim(),
      };
      const syncMode = getSyncMode(sourceForm.syncSelection);
      sourceInput.syncMode = syncMode;
      sourceInput.syncCadence = getSyncCadence(sourceForm.syncSelection);

      if (sourceForm.text.trim().length > 0) {
        sourceInput.text = sourceForm.text.trim();
      }
      if (workflowIds !== undefined) {
        sourceInput.workflowIds = workflowIds;
      }
      if (sourceForm.uri.trim().length > 0) {
        sourceInput.uri = sourceForm.uri.trim();
      }
      if (sourceForm.sourceType === "manual_text") {
        sourceInput.recordType = sourceForm.recordType;
      }
      if (sourceForm.sourceType === "pdf") {
        sourceInput.contentType = "application/pdf";
      }
      if (sourceForm.sourceType === "website_crawl") {
        if (crawlLimit !== undefined) {
          sourceInput.crawlLimit = crawlLimit;
        }
        const excludePaths = parseExcludePaths(sourceForm.excludePathsText);
        if (excludePaths !== undefined) {
          sourceInput.excludePaths = excludePaths;
        }
      }
      if (sourceForm.sourceType === "provider_import") {
        if (sourceForm.providerId.trim().length > 0) {
          sourceInput.providerId = sourceForm.providerId.trim();
        }
        if (sourceForm.integrationConnectionId.trim().length > 0) {
          sourceInput.integrationConnectionId = sourceForm.integrationConnectionId.trim();
        }
        if (sourceForm.externalId.trim().length > 0) {
          sourceInput.externalId = sourceForm.externalId.trim();
        }
      }

      await createKnowledgeSource(organizationId, sourceInput);
      showToast("Knowledge source added.");
      setSourceForm(createInitialSourceForm(activeWorkspaceId));
      await loadMemory();
    } finally {
      setSourceSubmitting(false);
    }
  };

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

  const approveKnowledgeDraft = async (draft: KnowledgeReviewDraft) => {
    const recordType = reviewRecordTypes[draft.id] ?? draft.suggestedKind;
    const needsHighRiskConfirmation = doesDraftRequireHighRiskConfirmation(draft, recordType);
    const approvalInput: Parameters<typeof approveKnowledgeReviewDraft>[2] = {
      approverUserId: activeActorUserId,
      approverRole: activeTenantRole,
      workspaceId: draft.workspaceId,
      reason: buildKnowledgeApprovalReason(draft, recordType),
      recordType,
    };

    if (needsHighRiskConfirmation) {
      approvalInput.confirmHighRiskKind = true;
    }

    await approveKnowledgeReviewDraft(organizationId, draft.id, approvalInput);
    showToast("Knowledge draft approved.");
    await loadMemory();
  };

  return (
    <div className="tenant-feature-page">
      <TenantSummaryGrid
        items={[
          { label: "Approved memory", value: String(activeMemories.length), detail: "Callable facts" },
          { label: "Pending drafts", value: String(pendingDrafts.length), detail: "Need approval" },
          { label: "Knowledge", value: String(knowledge.length), detail: "Approved records" },
          { label: "Sources", value: String(knowledgeSources.length), detail: "Snapshot imports" },
          { label: "Review drafts", value: String(knowledgeReviewDrafts.length), detail: "Record-level checks" },
        ]}
      />

      {errorMessage === null ? null : <TenantStatusBanner tone="danger">{errorMessage}</TenantStatusBanner>}
      {loading ? <TenantStatusBanner tone="neutral">Loading memory.</TenantStatusBanner> : null}
      {sourceForm.sourceType === "provider_import" && integrationErrorMessage !== null ? (
        <TenantStatusBanner tone="danger">{integrationErrorMessage}</TenantStatusBanner>
      ) : null}

      <section className="tenant-page-grid">
        <div className="surface-card overflow-hidden">
          <TenantSectionHeader eyebrow="Add source" title="Knowledge source" />
          <form
            className="tenant-row tenant-row-stack workflow-form"
            onSubmit={(event) => {
              event.preventDefault();
              void addKnowledgeSource();
            }}
          >
            <div className="tenant-form-grid">
              <label>
                Knowledge source type
                <select
                  value={sourceForm.sourceType}
                  onChange={(event) =>
                    setSourceForm((current) => ({
                      ...current,
                      sourceType: event.target.value as KnowledgeSourceType,
                      syncSelection:
                        event.target.value === "website_crawl" && current.syncSelection === "snapshot"
                          ? "manual"
                          : current.syncSelection,
                      providerId: event.target.value === "provider_import"
                        ? current.providerId || knowledgeProviders[0]?.id || ""
                        : current.providerId,
                    }))
                  }
                >
                  {sourceTypes.map((sourceType) => (
                    <option key={sourceType} value={sourceType}>
                      {formatSourceType(sourceType)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Sync mode
                <select
                  value={sourceForm.syncSelection}
                  onChange={(event) =>
                    setSourceForm((current) => ({
                      ...current,
                      syncSelection: event.target.value as KnowledgeSourceFormState["syncSelection"],
                    }))
                  }
                >
                  {sourceForm.sourceType === "website_crawl" ? null : <option value="snapshot">Snapshot</option>}
                  <option value="manual">Manual refresh</option>
                  <option value="daily">Daily sync</option>
                </select>
              </label>
              <label>
                Source title
                <input
                  value={sourceForm.title}
                  onChange={(event) => setSourceForm((current) => ({ ...current, title: event.target.value }))}
                />
              </label>
              <label>
                Workspace ID
                <input
                  value={sourceForm.workspaceId}
                  onChange={(event) => setSourceForm((current) => ({ ...current, workspaceId: event.target.value }))}
                />
              </label>
              <label>
                Workflow IDs
                <input
                  placeholder="workflow-a, workflow-b"
                  value={sourceForm.workflowIdsText}
                  onChange={(event) => setSourceForm((current) => ({ ...current, workflowIdsText: event.target.value }))}
                />
              </label>
              {sourceForm.sourceType === "manual_text" ? (
                <label>
                  Record type
                  <select
                    value={sourceForm.recordType}
                    onChange={(event) =>
                      setSourceForm((current) => ({
                        ...current,
                        recordType: event.target.value as KnowledgeRecordType,
                      }))
                    }
                  >
                    {knowledgeRecordTypes.map((recordType) => (
                      <option key={recordType} value={recordType}>
                        {formatRecordType(recordType)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label>
                {sourceForm.sourceType === "website_crawl" ? "Website root URL" : "Source URI"}
                <input
                  value={sourceForm.uri}
                  disabled={sourceForm.sourceType === "manual_text"}
                  onChange={(event) => setSourceForm((current) => ({ ...current, uri: event.target.value }))}
                />
              </label>
              {sourceForm.sourceType === "website_crawl" ? (
                <>
                  <label>
                    Crawl limit
                    <input
                      inputMode="numeric"
                      min={1}
                      type="number"
                      value={sourceForm.crawlLimitText}
                      onChange={(event) =>
                        setSourceForm((current) => ({ ...current, crawlLimitText: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Exclude paths
                    <textarea
                      rows={2}
                      value={sourceForm.excludePathsText}
                      onChange={(event) =>
                        setSourceForm((current) => ({ ...current, excludePathsText: event.target.value }))
                      }
                    />
                  </label>
                </>
              ) : null}
              {sourceForm.sourceType === "provider_import" ? (
                <>
                  <label>
                    Provider
                    <select
                      value={sourceForm.providerId}
                      onChange={(event) =>
                        setSourceForm((current) => ({
                          ...current,
                          providerId: event.target.value as IntegrationProvider,
                          integrationConnectionId: "",
                          externalId: "",
                        }))
                      }
                    >
                      {knowledgeProviders.length === 0 ? (
                        <option value="">No knowledge providers</option>
                      ) : null}
                      {knowledgeProviders.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Connection
                    <select
                      value={sourceForm.integrationConnectionId}
                      onChange={(event) =>
                        setSourceForm((current) => ({ ...current, integrationConnectionId: event.target.value }))
                      }
                    >
                      {providerConnections.length === 0 ? (
                        <option value="">No connected account</option>
                      ) : null}
                      {providerConnections.map((connection) => (
                        <option key={connection.id} value={connection.id}>
                          {connection.accountLabel ?? connection.credentialReference.preview}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {providerSourceSelectionCopy.label}
                    <input
                      placeholder={providerSourceSelectionCopy.placeholder}
                      value={sourceForm.externalId}
                      onChange={(event) => setSourceForm((current) => ({ ...current, externalId: event.target.value }))}
                    />
                  </label>
                </>
              ) : null}
            </div>
            {sourceNeedsText ? (
              <label>
                Source text
                <textarea
                  rows={4}
                  value={sourceForm.text}
                  onChange={(event) => setSourceForm((current) => ({ ...current, text: event.target.value }))}
                />
              </label>
            ) : null}
            <div className="tenant-action-bar">
              <button className="workflow-button workflow-button-primary" type="submit" disabled={!sourceCanSubmit || sourceSubmitting}>
                Add knowledge source
              </button>
              <span className="panel-meta">
                {sourceForm.sourceType === "manual_text" ? "Manual entries activate with the selected type." : "Imports create review drafts first."}
              </span>
            </div>
          </form>
        </div>

        <div className="surface-card overflow-hidden">
          <TenantSectionHeader eyebrow="Approved" title="Durable memory" />
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
          <TenantSectionHeader eyebrow="Approval" title="Drafts" />
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
          <TenantSectionHeader eyebrow="Knowledge" title="Policies and ingestion" />
          <div className="tenant-list">
            {knowledge.map((record) => (
              <article key={record.id} className="tenant-row">
                <div>
                  <div className="panel-title">{record.text}</div>
                  <div className="panel-meta">
                    {record.title} - {formatStatus(record.conflictState)}
                    {record.sensitivityLabels?.length ? ` - ${record.sensitivityLabels.map(formatSensitivityLabel).join(", ")}` : ""}
                  </div>
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
          <TenantSectionHeader eyebrow="Snapshots" title="Source snapshots" />
          <div className="tenant-list">
            {knowledgeSources.map((source) => (
              <article key={source.id} className="tenant-row">
                <div>
                  <div className="panel-title">{source.title}</div>
                  <div className="panel-meta">
                    {formatSourceType(source.sourceType)} - {source.workspaceId}
                    {source.workflowIds?.length ? ` - ${source.workflowIds.length} workflows` : ""}
                    {source.uri !== undefined ? ` - ${source.uri}` : ""}
                    {source.crawl !== undefined ? ` - ${formatCrawlPageSummary(source.crawl.pages)}` : ""}
                    {source.syncMode === "recurring" ? ` - ${formatSyncCadence(source.syncCadence)}` : " - Snapshot"}
                    {source.nextSyncAt !== undefined ? ` - next ${formatTimestamp(source.nextSyncAt)}` : ""}
                    {source.degradedReason !== undefined ? ` - ${formatStatus(source.degradedReason)}` : ""}
                  </div>
                </div>
                <span className="table-status">
                  {formatStatus(source.syncStatus ?? source.status)}
                </span>
              </article>
            ))}
            {knowledgeSources.length === 0 ? (
              <article className="tenant-row">
                <div>
                  <div className="panel-title">No source snapshots</div>
                  <div className="panel-meta">Add manual text, URL, PDF, or provider source text to create one.</div>
                </div>
                <FileClock size={16} />
              </article>
            ) : null}
          </div>
        </div>

        <div className="surface-card overflow-hidden">
          <TenantSectionHeader eyebrow="Review" title="Knowledge drafts" />
          <div className="tenant-list">
            {knowledgeReviewDrafts.map((draft) => {
              const selectedRecordType = reviewRecordTypes[draft.id] ?? draft.suggestedKind;
              const needsHighRiskConfirmation = doesDraftRequireHighRiskConfirmation(draft, selectedRecordType);
              const highRiskConfirmed = highRiskConfirmations[draft.id] === true;

              return (
                <article key={draft.id} className="tenant-row tenant-row-stack">
                  <div>
                    <div className="panel-title">{draft.title}</div>
                    <div className="panel-meta">
                      {formatDraftChangeType(draft.changeType)} - {draft.text} - {formatRecordType(selectedRecordType)}
                      {draft.sensitivityLabels?.length ? ` - ${draft.sensitivityLabels.map(formatSensitivityLabel).join(", ")}` : ""}
                      {draft.activationBlockers?.length ? " - Blocked" : ""}
                    </div>
                  </div>
                  <div className="tenant-row-actions tenant-capability-actions">
                    <label className="workflow-form-field">
                      Review record type
                      <select
                        value={selectedRecordType}
                        onChange={(event) =>
                          setReviewRecordTypes((current) => ({
                            ...current,
                            [draft.id]: event.target.value as KnowledgeRecordType,
                          }))
                        }
                      >
                        {knowledgeRecordTypes.map((recordType) => (
                          <option key={recordType} value={recordType}>
                            {formatRecordType(recordType)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {needsHighRiskConfirmation ? (
                      <label className="tenant-checkbox-field">
                        <input
                          type="checkbox"
                          aria-label={`Confirm high-risk knowledge draft ${draft.id}`}
                          checked={highRiskConfirmed}
                          onChange={(event) =>
                            setHighRiskConfirmations((current) => ({
                              ...current,
                              [draft.id]: event.target.checked,
                            }))
                          }
                        />
                        <span>High-risk confirmation</span>
                      </label>
                    ) : null}
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`Approve knowledge draft ${draft.id}`}
                      disabled={(needsHighRiskConfirmation && !highRiskConfirmed) || Boolean(draft.activationBlockers?.length)}
                      title={draft.activationBlockers?.[0]?.message}
                      onClick={() => void approveKnowledgeDraft(draft)}
                    >
                      <CheckCircle2 size={15} />
                    </button>
                  </div>
                </article>
              );
            })}
            {knowledgeReviewDrafts.length === 0 ? (
              <article className="tenant-row">
                <div>
                  <div className="panel-title">No knowledge drafts</div>
                  <div className="panel-meta">Imported records appear here before activation.</div>
                </div>
                <CheckCircle2 size={16} />
              </article>
            ) : null}
          </div>
        </div>

        <div className="surface-card overflow-hidden">
          <TenantSectionHeader eyebrow="Privacy" title="Audit and retention" />
          <div className="tenant-list">
            <article className="tenant-row">
              <div>
                <div className="panel-title">Export package</div>
                <div className="panel-meta">Includes memory, drafts, knowledge, source snapshots, review drafts, and embedding metadata without raw vectors.</div>
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

function createInitialSourceForm(activeWorkspaceId: string): KnowledgeSourceFormState {
  return {
    sourceType: "manual_text",
    syncSelection: "snapshot",
    workspaceId: activeWorkspaceId,
    workflowIdsText: "",
    title: "",
    text: "",
    uri: "",
    crawlLimitText: "25",
    excludePathsText: "",
    recordType: "general_reference",
    providerId: "",
    integrationConnectionId: "",
    externalId: "",
  };
}

function getSyncMode(syncSelection: KnowledgeSourceFormState["syncSelection"]): KnowledgeSourceSyncMode {
  return syncSelection === "snapshot" ? "snapshot" : "recurring";
}

function getSyncCadence(syncSelection: KnowledgeSourceFormState["syncSelection"]): KnowledgeSourceSyncCadence {
  return syncSelection === "daily" ? "daily" : "manual";
}

function parseWorkflowIds(value: string) {
  const workflowIds = value
    .split(",")
    .map((workflowId) => workflowId.trim())
    .filter((workflowId) => workflowId.length > 0);

  return workflowIds.length === 0 ? undefined : workflowIds;
}

function parseCrawlLimit(value: string) {
  const crawlLimit = Number(value);

  return Number.isInteger(crawlLimit) && crawlLimit > 0 ? crawlLimit : undefined;
}

function parseExcludePaths(value: string) {
  const excludePaths = value
    .split(/[\n,]/)
    .map((excludePath) => excludePath.trim())
    .filter((excludePath) => excludePath.length > 0);

  return excludePaths.length === 0 ? undefined : excludePaths;
}

function doesDraftRequireHighRiskConfirmation(draft: KnowledgeReviewDraft, recordType: KnowledgeRecordType) {
  return draft.requiresKindConfirmation === true
    || highRiskRecordTypes.has(recordType);
}

function buildKnowledgeApprovalReason(draft: KnowledgeReviewDraft, recordType: KnowledgeRecordType) {
  return `${formatDraftChangeType(draft.changeType)} approved as ${formatRecordType(recordType)}.`;
}

function getProviderSourceSelectionCopy(providerId: string) {
  switch (providerId) {
    case "confluence":
      return {
        label: "Confluence spaces/pages",
        placeholder: "space:SUPPORT or page:123456",
      };
    case "sharepoint":
      return {
        label: "SharePoint sites/pages/folders",
        placeholder: "site:contoso-support:drive:documents:item:folder-support",
      };
    case "freshdesk":
      return {
        label: "Freshdesk categories/folders/articles",
        placeholder: "category:42, folder:99, or article:123",
      };
    case "salesforce-knowledge":
      return {
        label: "Salesforce Knowledge articles/categories",
        placeholder: "article:ka0... or category:Products:Returns",
      };
    default:
      return {
        label: "Provider source IDs",
        placeholder: "Selected source identifiers",
      };
  }
}

function formatDraftChangeType(changeType: KnowledgeReviewDraft["changeType"]) {
  switch (changeType) {
    case "update":
      return "Update";
    case "deletion":
      return "Deletion";
    case "new":
    case undefined:
      return "New record";
  }
}

function formatSyncCadence(syncCadence: KnowledgeSourceSyncCadence | undefined) {
  return syncCadence === "daily" ? "Daily sync" : "Manual refresh";
}

function formatSensitivityLabel(label: string) {
  return label.split("_").join(" ");
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatCrawlPageSummary(
  pages: NonNullable<NonNullable<TenantMemoryExport["knowledgeSources"]>[number]["crawl"]>["pages"],
) {
  const succeeded = pages.filter((page) => page.status === "succeeded").length;
  const skipped = pages.filter((page) => page.status === "skipped").length;
  const failed = pages.filter((page) => page.status === "failed").length;

  return `${succeeded} crawled, ${skipped} skipped, ${failed} failed`;
}

function formatSourceType(sourceType: KnowledgeSourceType) {
  switch (sourceType) {
    case "manual_text":
      return "Manual text";
    case "single_url":
      return "Single URL";
    case "pdf":
      return "PDF";
    case "provider_import":
      return "Provider import";
    case "website_crawl":
      return "Website crawl";
  }
}

function formatRecordType(recordType: KnowledgeRecordType) {
  switch (recordType) {
    case "faq":
      return "FAQ";
    case "policy":
      return "Policy";
    case "procedure":
      return "Procedure";
    case "troubleshooting":
      return "Troubleshooting";
    case "pricing":
      return "Pricing";
    case "escalation":
      return "Escalation";
    case "legal_compliance":
      return "Legal/compliance";
    case "general_reference":
      return "General reference";
  }
}
