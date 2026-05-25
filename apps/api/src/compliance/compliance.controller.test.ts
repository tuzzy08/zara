import { describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";

import { MemoryModule } from "../memory/memory.module";
import { TelephonyModule } from "../telephony/telephony.module";
import {
  FileTelephonyStateRepository,
  TELEPHONY_STATE_REPOSITORY,
} from "../telephony/telephony-state.repository";
import { ComplianceModule } from "./compliance.module";

describe("ComplianceController", () => {
  it("exposes general SaaS compliance readiness without regulated-data claims", async () => {
    const app = await createTestingApp();

    const readinessResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/compliance/readiness",
    );

    expect(readinessResponse.status).toBe(200);
    expect(readinessResponse.body.readiness).toMatchObject({
      organizationId: "tenant-west-africa",
      posture: "general_saas",
      claims: {
        hipaa: false,
        pci: false,
      },
    });
    expect(readinessResponse.body.readiness.checklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ control: "encryption", status: "ready" }),
        expect.objectContaining({ control: "audit", status: "ready" }),
        expect.objectContaining({ control: "retention", status: "ready" }),
        expect.objectContaining({ control: "consent", status: "ready" }),
        expect.objectContaining({ control: "access_control", status: "ready" }),
      ]),
    );
    expect(readinessResponse.body.readiness.knownGaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "regulated-data-baa" }),
        expect.objectContaining({ id: "data-residency-controls" }),
      ]),
    );

    await app.close();
  }, 30_000);

  it("records immutable security audit logs including system actors and failed actions", async () => {
    const app = await createTestingApp();

    const connectionResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/telephony/connections")
      .send({
        actorUserId: "user-security-admin",
        label: "Tenant Twilio account",
        ownershipMode: "byo_provider_account",
        provider: "twilio",
        region: "us-east-1",
        blockRoutingOnHealthFailure: true,
        accountSid: "AC1234567890abcdef1234567890abcd",
        authToken: "twilio-auth-token-1234567890",
      });

    expect(connectionResponse.status).toBe(201);

    const rotateResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/telephony/credentials/rotate")
      .send({});

    expect(rotateResponse.status).toBe(201);
    expect(rotateResponse.body.rotatedConnectionCount).toBe(1);

    const legalHoldResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/compliance/retention-jobs")
      .send({
        retainAfter: "2026-05-01T00:00:00.000Z",
        legalHold: true,
        now: "2026-05-24T12:00:00.000Z",
      });

    expect(legalHoldResponse.status).toBe(409);

    const auditResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/compliance/audit-logs",
    );

    expect(auditResponse.status).toBe(200);
    expect(auditResponse.body.auditLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tenantId: "tenant-west-africa",
          actor: {
            type: "system",
          },
          action: "telephony.credentials_rotated",
          target: {
            type: "telephony_credentials",
            id: "tenant-west-africa",
          },
          outcome: "succeeded",
          previousHash: null,
          hash: expect.any(String),
        }),
        expect.objectContaining({
          tenantId: "tenant-west-africa",
          actor: {
            type: "system",
          },
          action: "retention.deletion_blocked_legal_hold",
          target: {
            type: "retention_job",
            id: "tenant-west-africa",
          },
          outcome: "failed",
          hash: expect.any(String),
        }),
      ]),
    );
    expect(auditResponse.body.auditLogs[1].previousHash).toBe(auditResponse.body.auditLogs[0].hash);

    await app.close();
  }, 30_000);

  it("queues recording notices before call bridge commands and records consent state", async () => {
    const app = await createTestingApp();

    const route = await createTwoPartyRecordingRoute(app);

    const dispatchResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/telephony/dispatch/inbound")
      .send({
        toPhoneNumber: route.phoneNumber,
        fromPhoneNumber: "+233201110001",
        callSid: "CA-consent-notice-1",
      });

    expect(dispatchResponse.status).toBe(201);
    expect(dispatchResponse.body.dispatch.recordingConsent).toMatchObject({
      state: "notice_queued",
      noticeRequired: true,
      consentMode: "two-party",
      message: "Please note this call is being recorded.",
    });
    expect(dispatchResponse.body.session.recordingConsent).toMatchObject({
      state: "notice_queued",
      noticeRequired: true,
    });

    const callSessionId = dispatchResponse.body.dispatch.callSessionId as string;
    const commandsForCall = dispatchResponse.body.state.executionCommands.filter(
      (command: { callSessionId: string }) => command.callSessionId === callSessionId,
    );

    expect(commandsForCall.map((command: { action: string }) => command.action)).toEqual([
      "telephony.recording.play-notice",
      "platform.edge.accept-call",
    ]);
    expect(commandsForCall[0].payload).toMatchObject({
      consentMessage: "Please note this call is being recorded.",
      recordingConsentState: "notice_queued",
    });

    await app.close();
  }, 30_000);

  it("applies retention deletion jobs to calls, transcripts, memory, and recordings with auditable retries", async () => {
    const app = await createTestingApp();

    const route = await createTwoPartyRecordingRoute(app);
    const dispatchResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/telephony/dispatch/inbound")
      .send({
        toPhoneNumber: route.phoneNumber,
        fromPhoneNumber: "+233201110001",
        callSid: "CA-retention-1",
      });
    const callSessionId = dispatchResponse.body.dispatch.callSessionId as string;

    await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/calls/${encodeURIComponent(callSessionId)}/events`)
      .send({
        dispatchId: dispatchResponse.body.dispatch.id,
        eventType: "dtmf.received",
        digit: "4",
      });

    const memoryResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory")
      .send({
        actorUserId: "user-memory-admin",
        scope: "caller",
        callerIdentity: {
          kind: "phone",
          value: "+233201110001",
        },
        text: "Caller prefers billing callbacks in the morning.",
        optIn: true,
        source: {
          kind: "call_summary",
          callSessionId,
        },
        now: "2026-04-01T10:00:00.000Z",
      });

    expect(memoryResponse.status).toBe(201);

    const retryScheduledResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/compliance/retention-jobs")
      .send({
        actorUserId: "user-compliance-admin",
        retainAfter: "2999-01-01T00:00:00.000Z",
        recordingObjects: [
          {
            objectKey: "recordings/CA-retention-1.wav",
            failDelete: true,
          },
        ],
        now: "2026-05-24T12:00:00.000Z",
      });

    expect(retryScheduledResponse.status).toBe(201);
    expect(retryScheduledResponse.body.job).toMatchObject({
      tenantId: "tenant-west-africa",
      status: "retry_scheduled",
      deletedCounts: {
        calls: 1,
        transcripts: 1,
        memory: 1,
        recordings: 0,
      },
      failures: [
        {
          target: "recordings/CA-retention-1.wav",
          willRetry: true,
        },
      ],
    });
    expect(retryScheduledResponse.body.job.nextRetryAt).toBe("2026-05-24T12:05:00.000Z");

    const retryResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/compliance/retention-jobs")
      .send({
        actorUserId: "user-compliance-admin",
        retainAfter: "2999-01-01T00:00:00.000Z",
        retryOfJobId: retryScheduledResponse.body.job.id,
        recordingObjects: [
          {
            objectKey: "recordings/CA-retention-1.wav",
          },
        ],
        now: "2026-05-24T12:05:00.000Z",
      });

    expect(retryResponse.status).toBe(201);
    expect(retryResponse.body.job).toMatchObject({
      status: "completed",
      deletedCounts: {
        calls: 0,
        transcripts: 0,
        memory: 0,
        recordings: 1,
      },
      retryOfJobId: retryScheduledResponse.body.job.id,
    });

    const auditResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/compliance/audit-logs",
    );
    expect(auditResponse.body.auditLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "retention.deletion_job_retry_scheduled",
          outcome: "failed",
        }),
        expect.objectContaining({
          action: "retention.deletion_job_completed",
          outcome: "succeeded",
        }),
      ]),
    );

    await app.close();
  }, 30_000);
});

async function createTestingApp(): Promise<INestApplication> {
  const stateRoot = join(tmpdir(), `zara-compliance-test-${randomUUID()}`);
  process.env.ZARA_MEMORY_STATE_DIR = join(stateRoot, "memory");
  process.env.ZARA_AUDIT_LOG_STATE_DIR = join(stateRoot, "audit");

  const moduleRef = await Test.createTestingModule({
    imports: [MemoryModule, TelephonyModule, ComplianceModule],
  })
    .overrideProvider(TELEPHONY_STATE_REPOSITORY)
    .useValue(new FileTelephonyStateRepository(join(stateRoot, "telephony")))
    .compile();

  const app = moduleRef.createNestApplication();
  await app.init();

  return app;
}

async function createTwoPartyRecordingRoute(app: INestApplication) {
  const connectionResponse = await request(app.getHttpServer())
    .post("/organizations/tenant-west-africa/telephony/connections")
    .send({
      actorUserId: "user-ops-lead",
      label: "Zara Edge West",
      ownershipMode: "platform_managed",
      provider: "twilio",
      region: "unknown",
      blockRoutingOnHealthFailure: true,
      recordingPolicy: {
        enabled: true,
        consentMode: "two-party",
        consentMessage: "Please note this call is being recorded.",
      },
    });

  const connectionId = connectionResponse.body.connection.id as string;
  const numberResponse = await request(app.getHttpServer())
    .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/register-number`)
    .send({
      actorUserId: "user-ops-lead",
      phoneNumber: "+14155550110",
      friendlyName: "Premium support",
    });

  const phoneNumberId = numberResponse.body.phoneNumber.id as string;
  await request(app.getHttpServer())
    .patch(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/routing`)
    .send({
      publishedVersionId: "workflow-vip-v1",
      workflowLabel: "VIP reception",
      workspaceId: "workspace-vip",
    });

  return {
    phoneNumber: numberResponse.body.phoneNumber.phoneNumber as string,
  };
}
