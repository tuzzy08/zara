import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

import type { BillingProviderEvidenceReport } from "./billing-production-reconciliation-evidence";
import { compareSharedProviderUsage } from "./shared-provider-usage-comparison";
import type { ProviderUsageRecordingRepository } from "./provider-usage-recording.repository";
import type { OpenAiOrganizationBillingClient } from "./openai-organization-billing.client";
import { compareOpenAiTranscriptionUsage } from "./openai-transcription-usage-comparison";

export interface SharedProviderBillingCycle {
  cycleStartsAt: string;
  cycleEndsAt: string;
  cartesiaApiKeyId: string;
  openAiProjectId: string;
}

export async function saveSharedProviderBillingEvidence(
  path: string,
  report: Awaited<ReturnType<typeof collectSharedProviderBillingEvidence>>,
) {
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}

interface SharedSource {
  collectSharedCycle(input: {
    externalScopeId: string;
    cycleStartsAt: string;
    cycleEndsAt: string;
  }): Promise<BillingProviderEvidenceReport | null>;
}

export async function collectSharedProviderBillingEvidence(
  input: SharedProviderBillingCycle,
  sources: { cartesia: SharedSource; openai: SharedSource; now(): string;
    openaiTranscription?: Pick<OpenAiOrganizationBillingClient, "getProjectTranscriptionCycleEvidence">;
    observations?: ProviderUsageRecordingRepository | undefined },
) {
  const start = Date.parse(input.cycleStartsAt);
  const end = Date.parse(input.cycleEndsAt);
  const fetchedAt = sources.now();
  const now = Date.parse(fetchedAt);
  const dayMs = 86_400_000;
  if (![start, end, now].every(Number.isFinite) || start >= end || end > now
    || start % dayMs !== 0 || end % dayMs !== 0
    || !input.cartesiaApiKeyId.trim() || !input.openAiProjectId.trim()) {
    throw new Error("Shared billing collection requires scope IDs and a completed full-UTC-day period.");
  }
  const reports = [];
  for (const [provider, externalScopeId] of [
    ["cartesia", input.cartesiaApiKeyId], ["openai", input.openAiProjectId],
  ] as const) {
    const report = await sources[provider].collectSharedCycle({
      externalScopeId,
      cycleStartsAt: input.cycleStartsAt,
      cycleEndsAt: input.cycleEndsAt,
    });
    if (report === null) throw new Error(`Shared ${provider} report is unavailable.`);
    if (report.payload.scope !== "platform" || report.provider !== provider
      || Object.keys(report.payload.quantities).length !== 0) {
      throw new Error("Shared provider reports must contain platform supplier facts only.");
    }
    const observations = await sources.observations?.loadSharedCycle({ provider, externalScopeId,
      cycleStartsAt: input.cycleStartsAt, cycleEndsAt: input.cycleEndsAt }) ?? null;
    const comparison = compareSharedProviderUsage({
      cycleStartsAt: input.cycleStartsAt, cycleEndsAt: input.cycleEndsAt, externalScopeId, report,
    }, observations);
    const connectionCoverage = await sources.observations?.loadSharedConnectionCycle({ provider, externalScopeId,
      cycleStartsAt: input.cycleStartsAt, cycleEndsAt: input.cycleEndsAt }) ?? null;
    const items = [...(connectionCoverage?.connections ?? []).filter(connection => connection.result?.outcome !== "closed")
      .map(connection => ({ kind: "connection" as const, id: connection.id,
        organizationId: connection.organizationId, sessionId: connection.sessionId, callSessionId: connection.callSessionId,
        providerSessionId: connection.result?.providerSessionId ?? null, model: connection.model, occurredAt: connection.startedAt,
        quantity: null, reason: connection.result === null ? "connection_unresolved" : "connection_failed",
        action: "obtain_original_provider_evidence" })),
      ...(observations?.unresolvedRequests ?? []).map(request => ({ kind: "request" as const, ...request,
        quantity: null, reason: "usage_result_missing", action: "obtain_original_provider_evidence" }))];
    const usageReview = observations?.unresolvedRequests === undefined || connectionCoverage === null
      ? { status: "unavailable" as const, complete: false as const, items: null }
      : { status: "review_required" as const, complete: false as const, items };
    reports.push({ externalScopeId, report, observations, comparison, connectionCoverage, usageReview });
  }
  const transcriptionInput = { projectId: input.openAiProjectId,
    cycleStartsAt: input.cycleStartsAt, cycleEndsAt: input.cycleEndsAt };
  const facts = await sources.openaiTranscription?.getProjectTranscriptionCycleEvidence(transcriptionInput) ?? [];
  const observations = await sources.observations?.loadSharedTranscriptionCycle({
    externalScopeId: input.openAiProjectId, cycleStartsAt: input.cycleStartsAt, cycleEndsAt: input.cycleEndsAt,
  }) ?? null;
  const transcription = {
    report: sources.openaiTranscription ? {
      scope: "platform" as const, sourceKind: "audio_transcriptions" as const, ...transcriptionInput,
      sourceReportId: `openai-transcriptions:${createHash("sha256").update(JSON.stringify({ ...transcriptionInput, facts })).digest("hex")}`,
      facts,
    } : null,
    observations,
    comparison: compareOpenAiTranscriptionUsage({ ...transcriptionInput, facts }, observations),
  };
  return {
    scope: "platform" as const,
    status: "awaiting_usage_comparison" as const,
    cycleStartsAt: input.cycleStartsAt,
    cycleEndsAt: input.cycleEndsAt,
    fetchedAt,
    reports,
    transcription,
  };
}
