import { describe, expect, it } from "vitest";
import { compareOpenAiTranscriptionUsage, type OpenAiTranscriptionSnapshot } from "./openai-transcription-usage-comparison";

const cycle = { cycleStartsAt: "2026-08-01T00:00:00.000Z", cycleEndsAt: "2026-08-02T00:00:00.000Z" };
const fact = { projectId: "proj-shared", model: "gpt-realtime-whisper", bucketStartsAt: cycle.cycleStartsAt,
  bucketEndsAt: cycle.cycleEndsAt, seconds: 3, requestCount: 2 };
function snapshot(): OpenAiTranscriptionSnapshot {
  return { ...cycle, complete: true, unresolvedRequestCount: 0, observations: [
    { id: "one", organizationId: "tuzzy-test", projectId: "proj-shared", model: "gpt-realtime-whisper",
      occurredAt: "2026-08-01T01:00:00.000Z", usage: { type: "duration", seconds: 1 } },
    { id: "two", organizationId: "zara-ai-test", projectId: "proj-shared", model: "gpt-realtime-whisper",
      occurredAt: "2026-08-01T02:00:00.000Z", usage: { type: "duration", seconds: 2 } },
  ] };
}
describe("shared OpenAI transcription comparison", () => {
  it.each(["model", "day"])("detects offsetting %s errors even when cycle totals agree", dimension => {
    const observed = snapshot();
    observed.cycleEndsAt = "2026-08-03T00:00:00.000Z";
    const second = { ...fact, seconds: 1, requestCount: 1 };
    if (dimension === "model") {
      observed.observations[1]!.model = "other-transcription-model";
      second.model = "other-transcription-model";
    } else {
      observed.observations[1]!.occurredAt = "2026-08-02T00:00:00.000Z";
      second.bucketStartsAt = cycle.cycleEndsAt;
      second.bucketEndsAt = observed.cycleEndsAt;
    }
    const result = compareOpenAiTranscriptionUsage({ ...cycle, cycleEndsAt: observed.cycleEndsAt,
      projectId: "proj-shared", facts: [{ ...fact, seconds: 2, requestCount: 1 }, second] }, observed);
    expect(result).toMatchObject({ status: "mismatch", issues: ["quantity_mismatch"],
      groups: [{ providerSeconds: "2", observedSeconds: "1" }, { providerSeconds: "1", observedSeconds: "2" }] });
  });
  it("retains very small decimal seconds expressed with an exponent", () => {
    const observed = snapshot();
    observed.observations[0]!.usage = { type: "duration", seconds: 1e-7 };
    observed.observations[1]!.usage = { type: "duration", seconds: 2e-7 };
    expect(compareOpenAiTranscriptionUsage({ ...cycle, projectId: "proj-shared", facts: [{ ...fact, seconds: 3e-7 }] }, observed))
      .toMatchObject({ status: "matched", groups: [{ providerSeconds: "0.0000003", observedSeconds: "0.0000003" }] });
  });
  it.each([
    [{ projectId: "other" }, "provider_scope_mismatch"],
    [{ model: null }, "provider_model_missing"],
    [{ model: " " }, "provider_model_missing"],
    [{ bucketStartsAt: "2026-08-01T12:00:00.000Z" }, "provider_period_mismatch"],
    [{ bucketEndsAt: "2026-08-03T00:00:00.000Z" }, "provider_period_mismatch"],
    [{ seconds: NaN }, "provider_quantity_invalid"],
    [{ seconds: -1 }, "provider_quantity_invalid"],
    [{ requestCount: 1.5 }, "provider_quantity_invalid"],
  ] as const)("rejects unsafe provider facts: %j", (override, issue) => {
    expect(compareOpenAiTranscriptionUsage({ ...cycle, projectId: "proj-shared", facts: [{ ...fact, ...override }] }, snapshot()))
      .toMatchObject({ status: "incomplete", issues: expect.arrayContaining([issue]) });
  });
  it.each([
    [{ projectId: "other" }, "observation_scope_mismatch"],
    [{ id: "" }, "observation_identity_missing"],
    [{ organizationId: " " }, "observation_identity_missing"],
    [{ model: " " }, "observation_identity_missing"],
    [{ occurredAt: "invalid" }, "observation_period_mismatch"],
    [{ occurredAt: cycle.cycleEndsAt }, "observation_period_mismatch"],
    [{ usage: { type: "duration", seconds: Infinity } }, "observation_quantity_invalid"],
  ] as const)("rejects unsafe stored observations: %j", (override, issue) => {
    const observed = snapshot();
    observed.observations[0] = { ...observed.observations[0]!, ...override };
    expect(compareOpenAiTranscriptionUsage({ ...cycle, projectId: "proj-shared", facts: [fact] }, observed))
      .toMatchObject({ status: "incomplete", issues: expect.arrayContaining([issue]) });
  });
  it("rejects duplicate provider buckets and stored identities even when totals agree", () => {
    const observed = snapshot();
    observed.observations.push(...observed.observations);
    expect(compareOpenAiTranscriptionUsage({ ...cycle, projectId: "proj-shared", facts: [fact, fact] }, observed))
      .toMatchObject({ status: "incomplete", issues: expect.arrayContaining(["provider_fact_duplicate", "observation_duplicate"]) });
  });
  it.each(["invalid", "2026-08-01T12:00:00.000Z", cycle.cycleEndsAt])("rejects an invalid comparison start: %s", cycleStartsAt => {
    expect(compareOpenAiTranscriptionUsage({ ...cycle, cycleStartsAt, projectId: "proj-shared", facts: [fact] }, snapshot()))
      .toMatchObject({ status: "incomplete", issues: expect.arrayContaining(["comparison_period_invalid"]) });
  });
  it.each([null, { ...snapshot(), complete: false }, { ...snapshot(), cycleEndsAt: "2026-08-03T00:00:00.000Z" }])(
    "does not qualify absent, partial, or wrong-period observation coverage", observed => {
      expect(compareOpenAiTranscriptionUsage({ ...cycle, projectId: "proj-shared", facts: [fact] }, observed))
        .toMatchObject({ status: "incomplete", issues: expect.arrayContaining(["observation_coverage_missing"]) });
    });
  it("does not treat token-only transcription as zero seconds", () => {
    const observed = snapshot();
    observed.observations[0]!.usage = { type: "tokens", input_tokens: 2, output_tokens: 1, total_tokens: 3 };
    expect(compareOpenAiTranscriptionUsage({ ...cycle, projectId: "proj-shared", facts: [{ ...fact, seconds: 2 }] }, observed))
      .toMatchObject({ status: "incomplete", issues: ["transcription_unit_unsupported"],
        groups: [{ observedSeconds: null, observedRequests: 2 }] });
  });
  it("keeps absent observations unknown rather than zero", () => {
    expect(compareOpenAiTranscriptionUsage({ ...cycle, projectId: "proj-shared", facts: [fact] }, null))
      .toMatchObject({ status: "incomplete", issues: ["observation_coverage_missing"],
        groups: [{ observedSeconds: null, observedRequests: null }] });
  });
  it("does not qualify a snapshot that contains unresolved provider requests", () => {
    expect(compareOpenAiTranscriptionUsage({ ...cycle, projectId: "proj-shared", facts: [fact] }, { ...snapshot(), unresolvedRequestCount: 1 }))
      .toMatchObject({ status: "incomplete", issues: expect.arrayContaining(["observation_unresolved"]) });
  });
  it("does not qualify empty provider facts as a zero-usage match", () => {
    expect(compareOpenAiTranscriptionUsage({ ...cycle, projectId: "proj-shared", facts: [] }, { ...snapshot(), observations: [] }))
      .toMatchObject({ status: "incomplete", issues: ["provider_facts_missing"] });
  });
  it("adds fractional native seconds exactly without rounding or token conversion", () => {
    const observed = snapshot();
    observed.observations[0]!.usage = { type: "duration", seconds: 0.1 };
    observed.observations[1]!.usage = { type: "duration", seconds: 0.2 };
    const result = compareOpenAiTranscriptionUsage({ ...cycle, projectId: "proj-shared", facts: [{ ...fact, seconds: 0.3 }] }, observed);
    expect(result).toMatchObject({ status: "matched", groups: [{ providerSeconds: "0.3", observedSeconds: "0.3" }] });
  });
  it("compares native seconds and requests across tenants without creating customer charges", () => {
    expect(compareOpenAiTranscriptionUsage({ ...cycle, projectId: "proj-shared", facts: [fact] }, snapshot()))
      .toEqual({ scope: "platform", provider: "openai", sourceKind: "audio_transcriptions", projectId: "proj-shared",
        status: "matched", issues: [], groups: [{ model: "gpt-realtime-whisper", bucketStartsAt: cycle.cycleStartsAt,
          providerSeconds: "3", observedSeconds: "3", providerRequests: 2, observedRequests: 2 }] });
  });
});
