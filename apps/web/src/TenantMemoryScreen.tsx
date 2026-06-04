import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, DatabaseZap, FileClock, Trash2, XCircle } from "lucide-react";

import {
  approveMemoryDraft,
  deleteMemoryRecord,
  disableMemoryRecord,
  fetchTenantMemoryExport,
  purgeMemoryRetention,
  rejectMemoryDraft,
  type TenantMemoryExport,
} from "./tenantMemoryApi";
import { formatStatus } from "./tenantPageFormatting";
import { TenantPageIntro } from "./TenantPageIntro";
import { TenantSectionHeader } from "./TenantSectionHeader";
import { TenantStatusBanner } from "./TenantStatusBanner";
import { TenantSummaryGrid } from "./TenantSummaryGrid";
import { type TenantPageProps } from "./tenantPageTypes";

export function TenantMemoryScreen({ organizationId, showToast }: TenantPageProps) {
  const [memoryExport, setMemoryExport] = useState<TenantMemoryExport | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
      <TenantPageIntro
        icon={DatabaseZap}
        eyebrow="Memory"
        title="Memory control room"
        body="Review approved facts, pending drafts, knowledge sources, ingestion health, and audit posture before the runtime can use tenant memory."
      />

      <TenantSummaryGrid
        items={[
          { label: "Approved memory", value: String(activeMemories.length), detail: "Callable facts" },
          { label: "Pending drafts", value: String(pendingDrafts.length), detail: "Need approval" },
          { label: "Knowledge", value: String(knowledge.length), detail: "Policies and FAQs" },
        ]}
      />

      {errorMessage === null ? null : <TenantStatusBanner tone="danger">{errorMessage}</TenantStatusBanner>}
      {loading ? <TenantStatusBanner tone="neutral">Loading memory.</TenantStatusBanner> : null}

      <section className="tenant-page-grid">
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
          <TenantSectionHeader eyebrow="Privacy" title="Audit and retention" />
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
