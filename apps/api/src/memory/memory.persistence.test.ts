import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileMemoryStateRepository } from "./memory-state.repository";
import { MemoryService } from "./memory.service";

let tempDirectory = "";

describe("memory persistence", () => {
  afterEach(() => {
    if (tempDirectory.length > 0) {
      rmSync(tempDirectory, { recursive: true, force: true });
      tempDirectory = "";
    }
  });

  it("persists opt-in caller and account memories across service instances", async () => {
    tempDirectory = mkdtempSync(join(tmpdir(), "zara-memory-"));
    const storePath = join(tempDirectory, "memory-store");
    const firstService = new MemoryService(new FileMemoryStateRepository(storePath));

    await firstService.createMemory("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      scope: "caller",
      callerIdentity: {
        kind: "phone",
        value: "+2348011112222",
      },
      text: "Caller wants renewal reminders by WhatsApp.",
      optIn: true,
      source: {
        kind: "call_summary",
        callSessionId: "call-001",
      },
      now: "2026-05-17T12:00:00.000Z",
    });
    await firstService.createMemory("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      scope: "account",
      callerIdentity: {
        kind: "phone",
        value: "+2348011112222",
      },
      accountId: "acct-lagos-77",
      text: "Account renewal is blocked by an invoice dispute.",
      optIn: true,
      source: {
        kind: "call_summary",
        callSessionId: "call-001",
      },
      now: "2026-05-17T12:01:00.000Z",
    });

    const restartedService = new MemoryService(new FileMemoryStateRepository(storePath));
    const memories = await restartedService.retrieveMemories({
      organizationId: "tenant-west-africa",
      callerIdentity: {
        kind: "phone",
        value: "+2348011112222",
      },
      accountId: "acct-lagos-77",
    });

    expect(memories.map((memory) => memory.text)).toEqual([
      "Account renewal is blocked by an invoice dispute.",
      "Caller wants renewal reminders by WhatsApp.",
    ]);
  });

  it("persists tenant knowledge records across service instances", async () => {
    tempDirectory = mkdtempSync(join(tmpdir(), "zara-memory-"));
    const storePath = join(tempDirectory, "memory-store");
    const firstService = new MemoryService(new FileMemoryStateRepository(storePath));

    await firstService.createTenantKnowledge("tenant-west-africa", {
      actorUserId: "user-knowledge-admin",
      kind: "policy",
      publishedWorkflowVersionIds: ["published-receptionist-v7"],
      title: "Refund routing policy",
      text: "Refund requests over 30 days route to retention.",
      source: {
        kind: "manual",
        title: "Operations handbook",
        uri: "https://docs.example.test/ops/refunds",
      },
      now: "2026-05-18T08:00:00.000Z",
    });

    const restartedService = new MemoryService(new FileMemoryStateRepository(storePath));
    const knowledge = await restartedService.retrieveTenantKnowledge({
      organizationId: "tenant-west-africa",
      publishedWorkflowVersionId: "published-receptionist-v7",
      now: "2026-05-18T09:00:00.000Z",
    });

    expect(knowledge).toHaveLength(1);
    expect(knowledge[0]).toMatchObject({
      organizationId: "tenant-west-africa",
      kind: "policy",
      title: "Refund routing policy",
      source: {
        kind: "manual",
        title: "Operations handbook",
        uri: "https://docs.example.test/ops/refunds",
      },
    });
  });

  it("persists approval drafts and audit history across service instances", async () => {
    tempDirectory = mkdtempSync(join(tmpdir(), "zara-memory-"));
    const storePath = join(tempDirectory, "memory-store");
    const firstService = new MemoryService(new FileMemoryStateRepository(storePath));

    const draft = await firstService.createMemory("tenant-west-africa", {
      actorUserId: "user-extractor",
      scope: "caller",
      callerIdentity: {
        kind: "phone",
        value: "+2348011112222",
      },
      text: "Caller wants delivery updates by WhatsApp.",
      optIn: true,
      approvalRequired: true,
      source: {
        kind: "call_summary",
        callSessionId: "call-approval-001",
        transcriptId: "transcript-approval-001",
        transcriptEventIds: ["turn-001"],
      },
      now: "2026-05-19T10:00:00.000Z",
    });

    expect(draft.status).toBe("draft");

    const restartedService = new MemoryService(new FileMemoryStateRepository(storePath));
    const approved = await restartedService.approveMemoryDraft("tenant-west-africa", draft.id, {
      approverUserId: "user-memory-approver",
      now: "2026-05-19T10:03:00.000Z",
    });

    expect(approved.draft.auditTrail.map((entry) => entry.action)).toEqual([
      "draft_created",
      "approved",
    ]);

    const memories = await restartedService.retrieveMemories({
      organizationId: "tenant-west-africa",
      callerIdentity: {
        kind: "phone",
        value: "+2348011112222",
      },
    });

    expect(memories).toHaveLength(1);
    expect(memories[0]).toMatchObject({
      text: "Caller wants delivery updates by WhatsApp.",
      approvalState: "approved",
      source: {
        callSessionId: "call-approval-001",
        transcriptId: "transcript-approval-001",
        transcriptEventIds: ["turn-001"],
      },
    });
  });
});
