import { describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import type { TypeSafeClient } from "../ai-judgements/typesafe-client";
import { InMemoryMemoryStateRepository } from "./memory-state.repository";
import { MemoryService } from "./memory.service";
import { MemoryModule } from "./memory.module";

const callerIdentity = { kind: "phone" as const, value: "+2348011112222" };

function serviceWithAnswer(answer: unknown) {
  const evaluate = vi.fn().mockResolvedValue({
    answers: { candidate_0: answer },
    model: "jev-test",
    usage: { inputTokens: 5, outputTokens: 2 },
    latencyMs: 4,
  });
  return {
    service: new MemoryService(new InMemoryMemoryStateRepository(), undefined, undefined, undefined, {
      client: { evaluate } as unknown as TypeSafeClient,
      memoryMode: "enabled",
      knowledgeMode: "off",
    }),
    evaluate,
  };
}

describe("TypeSafe memory drafts", () => {
  it("copies a supported caller fact with its source ID and assessment", async () => {
    const { service, evaluate } = serviceWithAnswer({
      type: "choice",
      choice: "caller",
      confidence: 0.92,
      probabilities: { caller: 0.92, account: 0.03, none: 0.05 },
    });
    const result = await service.extractMemoryDrafts("tenant-a", {
      actorUserId: "operator",
      callSessionId: "call-1",
      transcriptId: "transcript-1",
      callerIdentity,
      accountId: "account-1",
      optIn: true,
      transcript: [{ id: "turn-1", speaker: "caller", text: "I am vegetarian." }],
    });

    expect(result.drafts).toEqual([expect.objectContaining({
      scope: "caller",
      text: "I am vegetarian.",
      confidence: 0.92,
      assessment: expect.objectContaining({ choice: "caller", model: "jev-test",
        inputTokens: 5, outputTokens: 2, latencyMs: 4 }),
      source: expect.objectContaining({ transcriptEventIds: ["turn-1"] }),
    })]);
    expect(evaluate).toHaveBeenCalledOnce();
    expect(evaluate.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      state: expect.objectContaining({ transcript: [expect.objectContaining({ id: "turn-1" })] }),
    }));
  });

  it("does not send sensitive text or an opted-out transcript", async () => {
    const { service, evaluate } = serviceWithAnswer({
      type: "choice", choice: "caller", confidence: 0.99,
      probabilities: { caller: 0.99, account: 0, none: 0.01 },
    });
    const input = {
      actorUserId: "operator", callSessionId: "call-1", transcriptId: "transcript-1",
      callerIdentity, optIn: true,
      transcript: [{ id: "turn-1", speaker: "caller" as const, text: "My password is sunset." }],
    };
    const result = await service.extractMemoryDrafts("tenant-a", input);
    expect(result.drafts).toEqual([]);
    expect(result.filtered).toEqual([{ transcriptEventId: "turn-1", reason: "sensitive_data" }]);
    expect(evaluate).not.toHaveBeenCalled();
    await expect(service.extractMemoryDrafts("tenant-a", { ...input, optIn: false })).rejects.toThrow("opt-in");
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("rejects a mixed caller fact with an email and redacts an agent email", async () => {
    const { service, evaluate } = serviceWithAnswer({
      type: "choice", choice: "caller", confidence: 0.95,
      probabilities: { caller: 0.95, none: 0.05 },
    });
    const result = await service.extractMemoryDrafts("tenant-a", {
      actorUserId: "operator", callSessionId: "call-1", transcriptId: "transcript-1",
      callerIdentity, optIn: true,
      transcript: [
        { id: "turn-1", speaker: "caller", text: "I prefer email at ada@example.com." },
        { id: "turn-2", speaker: "caller", text: "I am vegetarian." },
        { id: "turn-3", speaker: "agent", text: "Send details to agent@example.com." },
      ],
    });
    expect(result.filtered).toContainEqual({ transcriptEventId: "turn-1", reason: "sensitive_data" });
    expect(result.drafts[0]?.text).toBe("I am vegetarian.");
    expect(JSON.stringify(evaluate.mock.calls[0]?.[0])).not.toContain("example.com");
  });

  it("keeps legacy drafts in shadow mode when the judgement is uncertain", async () => {
    const evaluate = vi.fn().mockResolvedValue({
      answers: { candidate_0: { type: "choice", choice: "caller", confidence: 0.4,
        probabilities: { caller: 0.4, none: 0.6 } } },
      model: "jev-test", usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1,
    });
    const service = new MemoryService(new InMemoryMemoryStateRepository(), undefined, undefined, undefined, {
      client: { evaluate } as unknown as TypeSafeClient,
      memoryMode: "shadow", knowledgeMode: "off",
    });
    const result = await service.extractMemoryDrafts("tenant-a", {
      actorUserId: "operator", callSessionId: "call-1", transcriptId: "transcript-1",
      callerIdentity, optIn: true,
      transcript: [{ id: "turn-1", speaker: "caller", text: "I prefer email." }],
    });
    expect(result.drafts).toEqual([expect.objectContaining({ text: "I prefer email.", confidence: 0.82 })]);
    expect(result.shadowAssessments).toEqual([expect.objectContaining({ transcriptEventId: "turn-1", choice: "caller" })]);
  });

  it("sends all safe turns once so a later correction is visible", async () => {
    const { service, evaluate } = serviceWithAnswer({
      type: "choice", choice: "none", confidence: 0.95,
      probabilities: { none: 0.95, caller: 0.05, account: 0 },
    });
    const transcript = [
      { id: "turn-1", speaker: "caller" as const, text: "I prefer SMS." },
      { id: "turn-2", speaker: "agent" as const, text: "I can note that." },
      { id: "turn-3", speaker: "agent" as const, text: "Is that correct?" },
      { id: "turn-4", speaker: "agent" as const, text: "Please confirm." },
      { id: "turn-5", speaker: "caller" as const, text: "Correction: use email instead." },
    ];
    await service.extractMemoryDrafts("tenant-a", {
      actorUserId: "operator", callSessionId: "call-1", transcriptId: "transcript-1",
      callerIdentity, optIn: true, transcript,
    });
    expect(evaluate).toHaveBeenCalledOnce();
    expect(evaluate.mock.calls[0]?.[0].state.transcript).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "turn-5", text: "Correction: use email instead." }),
    ]));
  });
});

describe("TypeSafe knowledge drafts", () => {
  it("classifies an imported refund procedure and keeps the safety review", async () => {
    const evaluate = vi.fn().mockResolvedValue({
      answers: { kind_0: { type: "choice", choice: "procedure", confidence: 0.9,
        probabilities: { procedure: 0.9, pricing: 0.05, no_clear_type: 0.05 } } },
      model: "jev-test", usage: { inputTokens: 10, outputTokens: 2 }, latencyMs: 5,
    });
    const service = new MemoryService(new InMemoryMemoryStateRepository(), undefined, undefined, undefined, {
      client: { evaluate } as unknown as TypeSafeClient,
      memoryMode: "off", knowledgeMode: "enabled",
    });
    const result = await service.createKnowledgeSource("tenant-a", {
      actorUserId: "operator", sourceType: "pdf", workspaceId: "workspace-a",
      title: "Refund process", text: "Step 1. Confirm eligibility. Step 2. Issue the refund.",
    });
    expect(result.reviewDrafts).toEqual([expect.objectContaining({
      suggestedKind: "procedure", status: "draft",
      kindAssessment: expect.objectContaining({ choice: "procedure", model: "jev-test",
        inputTokens: 10, outputTokens: 2, latencyMs: 5 }),
      requiresKindConfirmation: true,
    })]);
    expect(evaluate).toHaveBeenCalledOnce();
    await expect(service.approveKnowledgeReviewDraft("tenant-a", result.reviewDrafts[0]!.id, {
      approverUserId: "operator", approverRole: "operator", workspaceId: "workspace-a",
      reason: "Reviewed", confirmHighRiskKind: true,
    })).rejects.toThrow("owner or admin");
  });

  it("keeps a secret-bearing import out of the provider request", async () => {
    const evaluate = vi.fn();
    const service = new MemoryService(new InMemoryMemoryStateRepository(), undefined, undefined, undefined, {
      client: { evaluate } as unknown as TypeSafeClient,
      memoryMode: "off", knowledgeMode: "enabled",
    });
    const result = await service.createKnowledgeSource("tenant-a", {
      actorUserId: "operator", sourceType: "pdf", workspaceId: "workspace-a",
      title: "Support notes", text: "API key: secret-value-123",
    });
    expect(evaluate).not.toHaveBeenCalled();
    expect(result.reviewDrafts[0]).toEqual(expect.objectContaining({
      status: "draft", kindUncertain: true,
      activationBlockers: [expect.objectContaining({ code: "credentials_or_secrets_detected" })],
    }));
  });

  it("does not send an email in an imported source title", async () => {
    const evaluate = vi.fn();
    const service = new MemoryService(new InMemoryMemoryStateRepository(), undefined, undefined, undefined, {
      client: { evaluate } as unknown as TypeSafeClient,
      memoryMode: "off", knowledgeMode: "enabled",
    });
    const result = await service.createKnowledgeSource("tenant-a", {
      actorUserId: "operator", sourceType: "pdf", workspaceId: "workspace-a",
      title: "Notes for ada@example.com", text: "General support notes.",
    });
    expect(evaluate).not.toHaveBeenCalled();
    expect(result.reviewDrafts[0]?.kindUncertain).toBe(true);
  });

  it("does not save an older refresh result after a newer source revision", async () => {
    const repository = new InMemoryMemoryStateRepository();
    const base = new MemoryService(repository);
    const created = await base.createKnowledgeSource("tenant-a", {
      actorUserId: "operator", sourceType: "pdf", syncMode: "recurring",
      workspaceId: "workspace-a", title: "Help", text: "Initial text.",
    });
    let releaseOld!: (value: unknown) => void;
    const old = new Promise((resolve) => { releaseOld = resolve; });
    const reply = (choice: string) => ({ answers: { kind_0: { type: "choice", choice, confidence: 0.9,
      probabilities: { [choice]: 0.9, no_clear_type: 0.1 } } }, model: "jev-test",
      usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1 });
    const evaluate = vi.fn().mockImplementation(({ state }) =>
      state.documents[0].content === "Older text." ? old : Promise.resolve(reply("faq")));
    const service = new MemoryService(repository, undefined, undefined, undefined, {
      client: { evaluate } as unknown as TypeSafeClient,
      memoryMode: "off", knowledgeMode: "enabled",
    });
    const older = service.refreshKnowledgeSource("tenant-a", created.source.id, {
      actorUserId: "operator", trigger: "manual", text: "Older text.",
    });
    await vi.waitFor(() => expect(evaluate).toHaveBeenCalledOnce());
    const newer = await service.refreshKnowledgeSource("tenant-a", created.source.id, {
      actorUserId: "operator", trigger: "manual", text: "Newer text.",
    });
    releaseOld(reply("policy"));
    await expect(older).rejects.toThrow("changed");
    expect(newer.reviewDrafts[0]?.text).toBe("Newer text.");
    const stored = repository.load("tenant-a")!;
    expect(stored.knowledgeSources[0]?.textPreview).toBe("Newer text.");
    expect(stored.knowledgeReviewDrafts.filter((draft) => draft.text === "Older text.")).toEqual([]);
  });

  it("does not save an initial draft after its source refreshes", async () => {
    const repository = new InMemoryMemoryStateRepository();
    let releaseInitial!: (value: unknown) => void;
    const initial = new Promise((resolve) => { releaseInitial = resolve; });
    const reply = { answers: { kind_0: { type: "choice", choice: "faq", confidence: 0.95,
      probabilities: { faq: 0.95, no_clear_type: 0.05 } } }, model: "jev-test",
      usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1 };
    const evaluate = vi.fn().mockImplementation(({ state }) =>
      state.documents[0].content === "Initial text." ? initial : Promise.resolve(reply));
    const service = new MemoryService(repository, undefined, undefined, undefined, {
      client: { evaluate } as unknown as TypeSafeClient,
      memoryMode: "off", knowledgeMode: "enabled",
    });
    const creating = service.createKnowledgeSource("tenant-a", {
      actorUserId: "operator", sourceType: "pdf", syncMode: "recurring",
      workspaceId: "workspace-a", title: "Help", text: "Initial text.",
    });
    await vi.waitFor(() => expect(evaluate).toHaveBeenCalledOnce());
    const sourceId = (await service.exportTenantMemory("tenant-a")).knowledgeSources[0]!.id;
    await service.refreshKnowledgeSource("tenant-a", sourceId, {
      actorUserId: "operator", trigger: "manual", text: "Newer text.",
    });
    releaseInitial(reply);
    await expect(creating).rejects.toThrow("changed");
    expect(repository.load("tenant-a")!.knowledgeReviewDrafts.map((draft) => draft.text)).toEqual(["Newer text."]);
  });

  it("rejects approval of an older draft after the source changes", async () => {
    const service = new MemoryService(new InMemoryMemoryStateRepository());
    const created = await service.createKnowledgeSource("tenant-a", {
      actorUserId: "operator", sourceType: "pdf", syncMode: "recurring",
      workspaceId: "workspace-a", title: "Help FAQ", text: "Question: where is the office? Answer: Lagos.",
    });
    await service.refreshKnowledgeSource("tenant-a", created.source.id, {
      actorUserId: "operator", trigger: "manual", text: "Question: where is the office? Answer: Abuja.",
    });
    await expect(service.approveKnowledgeReviewDraft("tenant-a", created.reviewDrafts[0]!.id, {
      approverUserId: "operator", recordType: "faq",
    })).rejects.toThrow("changed");
  });

  it("keeps a different page draft available for review", async () => {
    const repository = new InMemoryMemoryStateRepository();
    const base = new MemoryService(repository);
    const created = await base.createKnowledgeSource("tenant-a", {
      actorUserId: "operator", sourceType: "pdf", workspaceId: "workspace-a",
      title: "Help FAQ", text: "Question: where is the office? Answer: Lagos.",
    });
    const state = repository.load("tenant-a")!;
    state.knowledgeReviewDrafts.unshift({ ...state.knowledgeReviewDrafts[0]!,
      id: "newer-page-b", title: "Another page", text: "Another page." });
    repository.save(state);
    const service = new MemoryService(repository);
    const approved = await service.approveKnowledgeReviewDraft("tenant-a", created.reviewDrafts[0]!.id, {
      approverUserId: "operator", recordType: "faq",
    });
    expect(approved.reviewDraft.status).toBe("approved");
  });

  it("keeps a legal risk signal when the document has no clear primary type", async () => {
    const evaluate = vi.fn().mockResolvedValue({
      answers: { kind_0: { type: "choice", choice: "no_clear_type", confidence: 0.95,
        probabilities: { no_clear_type: 0.95, legal_compliance: 0.05 } } },
      model: "jev-test", usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1,
    });
    const service = new MemoryService(new InMemoryMemoryStateRepository(), undefined, undefined, undefined, {
      client: { evaluate } as unknown as TypeSafeClient,
      memoryMode: "off", knowledgeMode: "enabled",
    });
    const result = await service.createKnowledgeSource("tenant-a", {
      actorUserId: "operator", sourceType: "pdf", workspaceId: "workspace-a",
      title: "Contract background", text: "This page gives company background.",
    });
    expect(result.reviewDrafts[0]).toEqual(expect.objectContaining({
      suggestedKind: "general_reference", kindUncertain: true, requiresKindConfirmation: true,
    }));
  });

  it("keeps an approved record type when changed content adds high risk", async () => {
    const repository = new InMemoryMemoryStateRepository();
    const base = new MemoryService(repository);
    const created = await base.createKnowledgeSource("tenant-a", {
      actorUserId: "operator", sourceType: "pdf", syncMode: "recurring",
      workspaceId: "workspace-a", title: "Help FAQ", text: "Question: where is the office? Answer: Lagos.",
    });
    await base.approveKnowledgeReviewDraft("tenant-a", created.reviewDrafts[0]!.id, {
      approverUserId: "operator", recordType: "faq",
    });
    const evaluate = vi.fn().mockResolvedValue({
      answers: { kind_0: { type: "choice", choice: "policy", confidence: 0.95,
        probabilities: { policy: 0.95, faq: 0.05 } } },
      model: "jev-test", usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1,
    });
    const service = new MemoryService(repository, undefined, undefined, undefined, {
      client: { evaluate } as unknown as TypeSafeClient,
      memoryMode: "off", knowledgeMode: "enabled",
    });
    const refreshed = await service.refreshKnowledgeSource("tenant-a", created.source.id, {
      actorUserId: "operator", trigger: "manual", text: "Every caller must confirm identity first.",
    });
    expect(refreshed.reviewDrafts[0]).toEqual(expect.objectContaining({
      suggestedKind: "faq", requiresKindConfirmation: true,
      kindAssessment: expect.objectContaining({ choice: "policy" }),
    }));
  });

  it("keeps an independent high-risk signal when the primary type is low risk", async () => {
    const evaluate = vi.fn().mockResolvedValue({
      answers: {
        kind_0: { type: "choice", choice: "procedure", confidence: 0.95,
          probabilities: { procedure: 0.95, escalation: 0.05 } },
        risk_0: { type: "noul", noul: 0.95 },
      }, model: "jev-test", usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1,
    });
    const service = new MemoryService(new InMemoryMemoryStateRepository(), undefined, undefined, undefined, {
      client: { evaluate } as unknown as TypeSafeClient,
      memoryMode: "off", knowledgeMode: "enabled",
    });
    const result = await service.createKnowledgeSource("tenant-a", {
      actorUserId: "operator", sourceType: "pdf", workspaceId: "workspace-a",
      title: "Support steps", text: "When the first agent cannot finish, send the request to a team lead.",
    });
    expect(result.reviewDrafts[0]).toEqual(expect.objectContaining({
      suggestedKind: "procedure", requiresKindConfirmation: true,
    }));
  });
});

it("rejects enabled memory mode without server credentials", async () => {
  vi.stubEnv("TYPESAFE_MEMORY_MODE", "enabled");
  vi.stubEnv("TYPESAFE_API_KEY", "");
  vi.stubEnv("TYPESAFE_MODEL", "");
  try {
    await expect(Test.createTestingModule({ imports: [MemoryModule] }).compile()).rejects.toThrow("TypeSafe");
  } finally {
    vi.unstubAllEnvs();
  }
});

it("starts with both draft modes off when TypeSafe credentials are partial", async () => {
  vi.stubEnv("TYPESAFE_MEMORY_MODE", "off");
  vi.stubEnv("TYPESAFE_KNOWLEDGE_MODE", "off");
  vi.stubEnv("TYPESAFE_API_KEY", "partial-key");
  vi.stubEnv("TYPESAFE_MODEL", "");
  try {
    const module = await Test.createTestingModule({ imports: [MemoryModule] }).compile();
    await module.close();
  } finally {
    vi.unstubAllEnvs();
  }
});
