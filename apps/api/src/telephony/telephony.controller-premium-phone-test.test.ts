import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { computeTwilioWebhookSignature } from "@zara/core";
import { TELEPHONY_INCREMENTAL_REPOSITORY } from "./telephony-incremental.repository";
import { InMemoryTelephonyIncrementalRepository } from "./telephony-incremental.repository.test-helper";
import { PstnAdmissionCoordinator } from "./pstn-admission-coordinator";
import {
  activateRouteWithOverride,
  createTestingApp,
  ensureTestBillingPlan,
  resolveActivationBlocks,
} from "./telephony.controller.test-support";

describe("TelephonyController premium-phone-test", () => {
  afterEach(() => {
      vi.restoreAllMocks();
    });

  it("creates premium realtime PSTN test routes and carries the premium runtime path into Twilio media", async () => {
      const selectedWorker = {
        workerId: "test-premium-worker",
        releaseId: "test-release",
        mediaStreamBaseUrl:
          "wss://realtime.zara.test/telephony/twilio/media-streams",
        availableSlots: 20,
        activeCalls: 0,
        startingCalls: 0,
      };
      const select = vi.fn(async (
        providers: readonly ("openai-realtime" | "gemini-live")[],
      ) => ({
        status: "available" as const,
        providers,
        worker: selectedWorker,
      }));
      const app = await createTestingApp({
        workerAvailability: { select },
      });

      try {
        const connectResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/telephony/connections")
        .send({
          actorUserId: "user-ops-lead",
          label: "Tenant Twilio account",
          ownershipMode: "byo_provider_account",
          provider: "twilio",
          region: "us-east-1",
          blockRoutingOnHealthFailure: true,
          accountSid: "AC1234567890abcdef1234567890abcd",
          authToken: "twilio-auth-token-1234567890",
        });
      const connectionId = connectResponse.body.state.connections[0].id as string;

      const importResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/import-twilio-numbers`)
        .send({});
      const phoneNumberId = importResponse.body.state.phoneNumbers[0].id as string;
      const phoneNumber = importResponse.body.state.phoneNumbers[0].phoneNumber as string;

      const premiumTestRouteResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/pstn-test-route`)
        .send({
          publishedVersionId: "workflow-premium-test-v1",
          workflowLabel: "Premium realtime phone test",
          workspaceId: "workspace-premium",
          runtimeProfile: "premium-realtime",
          allowedCallerNumbers: ["+233201110001"],
          expiresAt: "2099-05-14T16:30:00.000Z",
          now: "2026-05-14T16:00:00.000Z",
        });

      expect(premiumTestRouteResponse.status).toBe(201);
      expect(premiumTestRouteResponse.body.phoneNumber.testRoute).toMatchObject({
        mode: "test_route",
        runtimeProfile: "premium-realtime",
      });

      const webhookPayload = {
        AccountSid: "AC1234567890abcdef1234567890abcd",
        CallSid: "CA-premium-phone-test",
        EventSid: "EVT-premium-phone-test",
        EventType: "incoming.call",
        To: phoneNumber,
        From: "+233201110001",
      };
      const signature = computeTwilioWebhookSignature({
        url: "http://127.0.0.1/telephony/webhooks/twilio",
        parameters: webhookPayload,
        authToken: "twilio-auth-token-1234567890",
      });

      const webhookResponse = await request(app.getHttpServer())
        .post("/telephony/webhooks/twilio")
        .set("x-twilio-signature", signature)
        .send(webhookPayload);

      expect(webhookResponse.status).toBe(200);
      expect(webhookResponse.text).toContain("<Connect>");
      expect(webhookResponse.text).toContain(
        '<Parameter name="zaraRuntimePath" value="pstn-premium-realtime" />',
      );
      expect(webhookResponse.text).toContain(
        '<Parameter name="zaraWorkerId" value="test-premium-worker" />',
      );
      expect(webhookResponse.text).toMatch(
        /<Stream url="wss:\/\/realtime\.zara\.test\/telephony\/twilio\/media-streams\/CA-premium-phone-test%3Atelephony">/,
      );
      expect(webhookResponse.text).not.toContain(
        "wss://127.0.0.1/telephony/twilio/media-streams",
      );
      expect(webhookResponse.body.dispatch).toBeUndefined();
      const premiumCallSetup = app
        .get<InMemoryTelephonyIncrementalRepository>(
          TELEPHONY_INCREMENTAL_REPOSITORY,
        )
        .callSetups.find(
          (setup) =>
            setup.executionSession.callSessionId
            === "CA-premium-phone-test:telephony",
        );
      expect(premiumCallSetup?.premiumDispatchSnapshot).toMatchObject({
        schemaVersion: 1,
        tenantId: "tenant-west-africa",
        workspaceId: "workspace-premium",
        callSessionId: "CA-premium-phone-test:telephony",
        publishedVersionId: "workflow-premium-test-v1",
        workerTarget: {
          workerId: "test-premium-worker",
          releaseId: "test-release",
          mediaStreamBaseUrl:
            "wss://realtime.zara.test/telephony/twilio/media-streams",
        },
        checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
      });

      expect(select).toHaveBeenCalledTimes(1);

      const stateResponse = await request(app.getHttpServer()).get(
        "/organizations/tenant-west-africa/telephony/state",
      );
      expect(stateResponse.body.dispatches[0]).toMatchObject({
        disposition: "routed",
        routeMode: "test_route",
        runtimeProfile: "premium-realtime",
        runtimePath: "pstn-premium-realtime",
        policyChecks: {
          premiumRealtime: {
            status: "passed",
          },
        },
      });

      } finally {
        await app.close();
      }
    }, 30_000);

  it("reselects another premium worker when admission races on worker capacity", async () => {
      const workers = {
        primary: {
          workerId: "test-premium-worker-primary",
          releaseId: "test-release-primary",
          mediaStreamBaseUrl:
            "wss://realtime-primary.zara.test/telephony/twilio/media-streams",
          availableSlots: 20,
          activeCalls: 0,
          startingCalls: 0,
        },
        secondary: {
          workerId: "test-premium-worker-secondary",
          releaseId: "test-release-secondary",
          mediaStreamBaseUrl:
            "wss://realtime-secondary.zara.test/telephony/twilio/media-streams",
          availableSlots: 10,
          activeCalls: 0,
          startingCalls: 0,
        },
      };
      const select = vi.fn(async (
        providers: readonly ("openai-realtime" | "gemini-live")[],
        excludedWorkerIds: readonly string[] = [],
      ) => ({
        status: "available" as const,
        providers,
        worker: excludedWorkerIds.includes(workers.primary.workerId)
          ? workers.secondary
          : workers.primary,
      }));
      const app = await createTestingApp({
        workerAvailability: { select },
      });

      try {
        const reserve = vi.spyOn(
          app.get(PstnAdmissionCoordinator),
          "reserve",
        );
        reserve
          .mockResolvedValueOnce({
            outcome: "denied",
            reasonCode: "worker_concurrency_limit",
            limitingDimension: "worker_concurrency",
            remainingCapacity: 0,
          })
          .mockResolvedValueOnce({
            outcome: "admitted",
            disposition: "created",
            leaseExpiresAt: "2099-05-14T16:02:00.000Z",
            limitingDimension: "worker_concurrency",
            remainingCapacity: 9,
          });
        const connectResponse = await request(app.getHttpServer())
          .post("/organizations/tenant-west-africa/telephony/connections")
          .send({
            actorUserId: "user-ops-lead",
            label: "Tenant Twilio account",
            ownershipMode: "byo_provider_account",
            provider: "twilio",
            region: "us-east-1",
            blockRoutingOnHealthFailure: true,
            accountSid: "AC1234567890abcdef1234567890abcd",
            authToken: "twilio-auth-token-1234567890",
          });
        const connectionId =
          connectResponse.body.state.connections[0].id as string;
        const importResponse = await request(app.getHttpServer())
          .post(
            `/organizations/tenant-west-africa/telephony/connections/${connectionId}/import-twilio-numbers`,
          )
          .send({});
        const phoneNumberId =
          importResponse.body.state.phoneNumbers[0].id as string;
        const phoneNumber =
          importResponse.body.state.phoneNumbers[0].phoneNumber as string;
        await request(app.getHttpServer())
          .post(
            `/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/pstn-test-route`,
          )
          .send({
            publishedVersionId: "workflow-premium-reselection-v1",
            workflowLabel: "Premium worker reselection",
            workspaceId: "workspace-premium",
            runtimeProfile: "premium-realtime",
            allowedCallerNumbers: ["+233201110001"],
            expiresAt: "2099-05-14T16:30:00.000Z",
            now: "2026-05-14T16:00:00.000Z",
          });
        select
          .mockReset()
          .mockResolvedValue({
            status: "available",
            providers: ["openai-realtime"],
            worker: workers.primary,
          });
        reserve
          .mockReset()
          .mockResolvedValueOnce({
            outcome: "denied",
            reasonCode: "worker_concurrency_limit",
            limitingDimension: "worker_concurrency",
            remainingCapacity: 0,
          })
          .mockResolvedValueOnce({
            outcome: "admitted",
            disposition: "created",
            leaseExpiresAt: "2099-05-14T16:02:00.000Z",
            limitingDimension: "worker_concurrency",
            remainingCapacity: 9,
          });
        const repeatedWorkerPayload = {
          AccountSid: "AC1234567890abcdef1234567890abcd",
          CallSid: "CA-premium-worker-reselection-repeated",
          EventSid: "EVT-premium-worker-reselection-repeated",
          EventType: "incoming.call",
          To: phoneNumber,
          From: "+233201110001",
        };
        const repeatedWorkerSignature = computeTwilioWebhookSignature({
          url: "http://127.0.0.1/telephony/webhooks/twilio",
          parameters: repeatedWorkerPayload,
          authToken: "twilio-auth-token-1234567890",
        });

        const repeatedWorkerResponse = await request(app.getHttpServer())
          .post("/telephony/webhooks/twilio")
          .set("x-twilio-signature", repeatedWorkerSignature)
          .send(repeatedWorkerPayload);

        expect(repeatedWorkerResponse.status).toBe(200);
        expect(repeatedWorkerResponse.text).not.toContain("<Connect>");
        expect(select).toHaveBeenCalledTimes(2);
        expect(reserve).toHaveBeenCalledTimes(1);

        select
          .mockReset()
          .mockImplementation(async (
            providers: readonly ("openai-realtime" | "gemini-live")[],
            excludedWorkerIds: readonly string[] = [],
          ) => ({
            status: "available",
            providers,
            worker: excludedWorkerIds.includes(workers.primary.workerId)
              ? workers.secondary
              : workers.primary,
          }));
        reserve
          .mockReset()
          .mockResolvedValueOnce({
            outcome: "denied",
            reasonCode: "worker_concurrency_limit",
            limitingDimension: "worker_concurrency",
            remainingCapacity: 0,
          })
          .mockResolvedValueOnce({
            outcome: "admitted",
            disposition: "created",
            leaseExpiresAt: "2099-05-14T16:02:00.000Z",
            limitingDimension: "worker_concurrency",
            remainingCapacity: 9,
          });
        const webhookPayload = {
          AccountSid: "AC1234567890abcdef1234567890abcd",
          CallSid: "CA-premium-worker-reselection",
          EventSid: "EVT-premium-worker-reselection",
          EventType: "incoming.call",
          To: phoneNumber,
          From: "+233201110001",
        };
        const signature = computeTwilioWebhookSignature({
          url: "http://127.0.0.1/telephony/webhooks/twilio",
          parameters: webhookPayload,
          authToken: "twilio-auth-token-1234567890",
        });

        const response = await request(app.getHttpServer())
          .post("/telephony/webhooks/twilio")
          .set("x-twilio-signature", signature)
          .send(webhookPayload);

        expect(response.status).toBe(200);
        expect(response.text).toContain("<Connect>");
        expect(response.text).toContain(
          '<Parameter name="zaraWorkerId" value="test-premium-worker-secondary" />',
        );
        expect(response.text).toContain(
          '<Parameter name="zaraWorkerReleaseId" value="test-release-secondary" />',
        );
        expect(select).toHaveBeenNthCalledWith(
          1,
          ["openai-realtime"],
        );
        expect(select).toHaveBeenNthCalledWith(
          2,
          ["openai-realtime"],
          ["test-premium-worker-primary"],
        );
        expect(reserve).toHaveBeenCalledTimes(2);
      } finally {
        await app.close();
      }
    }, 30_000);

  it("fails premium Twilio answering closed when no compatible realtime worker is ready", async () => {
      const select = vi.fn(async (
        providers: readonly ("openai-realtime" | "gemini-live")[],
      ) => ({
        status: "unavailable" as const,
        providers,
        reason: "no_ready_worker" as const,
      }));
      const app = await createTestingApp({
        workerAvailability: { select },
      });
      const connectResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/telephony/connections")
        .send({
          actorUserId: "user-ops-lead",
          label: "Tenant Twilio account",
          ownershipMode: "byo_provider_account",
          provider: "twilio",
          region: "us-east-1",
          blockRoutingOnHealthFailure: true,
          accountSid: "AC1234567890abcdef1234567890abcd",
          authToken: "twilio-auth-token-1234567890",
        });
      const connectionId = connectResponse.body.state.connections[0].id as string;
      const importResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/import-twilio-numbers`)
        .send({});
      const phoneNumber = importResponse.body.state.phoneNumbers[0].phoneNumber as string;
      const phoneNumberId = importResponse.body.state.phoneNumbers[0].id as string;
      await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/pstn-test-route`)
        .send({
          publishedVersionId: "workflow-premium-no-worker-v1",
          workflowLabel: "Premium worker admission",
          workspaceId: "workspace-premium",
          runtimeProfile: "premium-realtime",
          allowedCallerNumbers: ["+233201110001"],
          expiresAt: "2099-05-14T16:30:00.000Z",
          now: "2026-05-14T16:00:00.000Z",
        });
      const webhookPayload = {
        AccountSid: "AC1234567890abcdef1234567890abcd",
        CallSid: "CA-premium-no-worker",
        EventSid: "EVT-premium-no-worker",
        EventType: "incoming.call",
        To: phoneNumber,
        From: "+233201110001",
      };
      const signature = computeTwilioWebhookSignature({
        url: "http://127.0.0.1/telephony/webhooks/twilio",
        parameters: webhookPayload,
        authToken: "twilio-auth-token-1234567890",
      });

      const response = await request(app.getHttpServer())
        .post("/telephony/webhooks/twilio")
        .set("x-twilio-signature", signature)
        .send(webhookPayload);

      expect(response.status).toBe(200);
      expect(response.text).not.toContain("<Connect>");
      expect(response.text).toContain("temporarily unavailable");
      expect(select).toHaveBeenCalledWith(["openai-realtime"]);
      expect(
        app.get<InMemoryTelephonyIncrementalRepository>(
          TELEPHONY_INCREMENTAL_REPOSITORY,
        ).callSetups,
      ).toHaveLength(0);
      await app.close();
    }, 30_000);

  it("creates a protected PSTN test route without replacing the live route", async () => {
      const app = await createTestingApp();

      const connectResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/telephony/connections")
        .send({
          actorUserId: "user-ops-lead",
          label: "Tenant Twilio account",
          ownershipMode: "byo_provider_account",
          provider: "twilio",
          region: "us-east-1",
          blockRoutingOnHealthFailure: true,
          accountSid: "AC1234567890abcdef1234567890abcd",
          authToken: "twilio-auth-token-1234567890",
        });
      const connectionId = connectResponse.body.state.connections[0].id as string;

      const importResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/import-twilio-numbers`)
        .send({});
      const phoneNumberId = importResponse.body.state.phoneNumbers[0].id as string;
      const phoneNumber = importResponse.body.state.phoneNumbers[0].phoneNumber as string;
      const secondPhoneNumberId = importResponse.body.state.phoneNumbers[1].id as string;
      const secondPhoneNumber = importResponse.body.state.phoneNumbers[1].phoneNumber as string;

      const liveRouteResponse = await request(app.getHttpServer())
        .patch(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/routing`)
        .send({
          publishedVersionId: "workflow-live-v1",
          workflowLabel: "Live reception",
          workspaceId: "workspace-live",
          runtimeProfile: "balanced",
        });

      expect(liveRouteResponse.status).toBe(200);

      const testRouteResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/pstn-test-route`)
        .send({
          publishedVersionId: "workflow-test-v2",
          workflowLabel: "Phone test",
          workspaceId: "workspace-test",
          runtimeProfile: "cost-optimized",
          allowedCallerNumbers: ["+233201110001"],
          expiresAt: "2026-05-14T16:30:00.000Z",
          now: "2026-05-14T16:00:00.000Z",
        });

      expect(testRouteResponse.status).toBe(201);
      expect(testRouteResponse.body.phoneNumber.liveRoute).toMatchObject({
        mode: "live_route",
        publishedVersionId: "workflow-live-v1",
        runtimeProfile: "balanced",
      });
      expect(testRouteResponse.body.phoneNumber.testRoute).toMatchObject({
        mode: "test_route",
        publishedVersionId: "workflow-test-v2",
        runtimeProfile: "cost-optimized",
        allowedCallerNumbers: ["+233201110001"],
        waitingSession: {
          status: "waiting",
          expiresAt: "2026-05-14T16:30:00.000Z",
        },
      });

      const duplicateTestRouteResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/pstn-test-route`)
        .send({
          publishedVersionId: "workflow-test-v3",
          workflowLabel: "Second phone test",
          workspaceId: "workspace-test",
          runtimeProfile: "balanced",
          allowedCallerNumbers: ["+233201110002"],
          expiresAt: "2026-05-14T16:45:00.000Z",
          now: "2026-05-14T16:05:00.000Z",
        });

      expect(duplicateTestRouteResponse.status).toBe(409);

      const crossTenantTestRouteResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-east-africa/telephony/numbers/${phoneNumberId}/pstn-test-route`)
        .send({
          publishedVersionId: "workflow-test-v2",
          workflowLabel: "Cross tenant test",
          workspaceId: "workspace-test",
          runtimeProfile: "cost-optimized",
          allowedCallerNumbers: ["+233201110001"],
          expiresAt: "2026-05-14T16:45:00.000Z",
          now: "2026-05-14T16:05:00.000Z",
        });

      expect(crossTenantTestRouteResponse.status).toBe(404);

      const allowedDispatchResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/telephony/dispatch/inbound")
        .send({
          toPhoneNumber: phoneNumber,
          fromPhoneNumber: "+233201110001",
          callSid: "CA-phone-test",
          now: "2026-05-14T16:05:00.000Z",
        });

      expect(allowedDispatchResponse.status).toBe(201);
      expect(allowedDispatchResponse.body.dispatch).toMatchObject({
        disposition: "routed",
        routeMode: "test_route",
        publishedVersionId: "workflow-test-v2",
        workspaceId: "workspace-test",
        runtimeProfile: "cost-optimized",
      });

      const liveDispatchResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/telephony/dispatch/inbound")
        .send({
          toPhoneNumber: phoneNumber,
          fromPhoneNumber: "+233201110009",
          callSid: "CA-live",
          now: "2026-05-14T16:05:00.000Z",
        });

      expect(liveDispatchResponse.status).toBe(201);
      expect(liveDispatchResponse.body.dispatch).toMatchObject({
        disposition: "blocked",
        routeMode: "live_route",
        publishedVersionId: "workflow-live-v1",
        workspaceId: "workspace-live",
        runtimeProfile: "balanced",
      });
      expect(liveDispatchResponse.body.dispatch.reason).toContain("not active");

      const secondRouteResponse = await request(app.getHttpServer())
        .patch(`/organizations/tenant-west-africa/telephony/numbers/${secondPhoneNumberId}/routing`)
        .send({
          publishedVersionId: "workflow-success-v1",
          workflowLabel: "Successful phone test",
          workspaceId: "workspace-success",
          runtimeProfile: "cost-optimized",
        });
      expect(secondRouteResponse.status).toBe(200);

      const successRouteResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/numbers/${secondPhoneNumberId}/pstn-test-route`)
        .send({
          publishedVersionId: "workflow-success-v1",
          workflowLabel: "Successful phone test",
          workspaceId: "workspace-success",
          runtimeProfile: "cost-optimized",
          allowedCallerNumbers: ["+233201110001"],
          expiresAt: "2099-05-14T17:30:00.000Z",
          now: "2026-05-14T17:00:00.000Z",
        });

      expect(successRouteResponse.status).toBe(201);

      const webhookPayload = {
        AccountSid: "AC1234567890abcdef1234567890abcd",
        CallSid: "CA-phone-test-success",
        EventSid: "EVT-phone-test-success",
        EventType: "incoming.call",
        To: secondPhoneNumber,
        From: "+233201110001",
      };
      const signature = computeTwilioWebhookSignature({
        url: "http://127.0.0.1/telephony/webhooks/twilio",
        parameters: webhookPayload,
        authToken: "twilio-auth-token-1234567890",
      });
      const webhookResponse = await request(app.getHttpServer())
        .post("/telephony/webhooks/twilio")
        .set("x-twilio-signature", signature)
        .send(webhookPayload);

      expect(webhookResponse.status).toBe(200);
      expect(webhookResponse.text).toContain("<Connect>");

      const callSessionId = "CA-phone-test-success:telephony";
      let checkpointResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/calls/${encodeURIComponent(callSessionId)}/pstn-test-checkpoints`)
        .send({ checkpoint: "mediaWebSocketConnected", at: "2026-05-14T17:00:01.000Z" });
      expect(checkpointResponse.status).toBe(201);
      expect(checkpointResponse.body).toEqual({ outcome: "inserted" });

      for (const checkpoint of [
        "inboundFrameReceived",
        "transcriptCreated",
        "agentResponseGenerated",
        "outboundAudioSent",
        "cleanEnd",
        "noFatalError",
      ] as const) {
        checkpointResponse = await request(app.getHttpServer())
          .post(`/organizations/tenant-west-africa/telephony/calls/${encodeURIComponent(callSessionId)}/pstn-test-checkpoints`)
          .send({ checkpoint, at: "2026-05-14T17:00:02.000Z" });
        expect(checkpointResponse.status).toBe(201);
        expect(checkpointResponse.body).toEqual({ outcome: "inserted" });
      }

      const successfulTestResultId =
        `${successRouteResponse.body.phoneNumber.testRoute.waitingSession.id}:passed`;

      const activationResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/numbers/${secondPhoneNumberId}/live-route/activate`)
        .send({
          actorUserId: "user-ops-lead",
          now: "2026-05-14T17:05:00.000Z",
        });
      expect(activationResponse.status).toBe(201);
      expect(activationResponse.body.activation.summary).toMatchObject({
        number: secondPhoneNumber,
        workflowName: "Successful phone test",
        publishedVersionId: "workflow-success-v1",
        runtimeProfile: "cost-optimized",
        subscriptionPosture: {
          status: "active",
        },
        budgetPosture: {
          action: "allow",
        },
      });
      expect(activationResponse.body.phoneNumber.liveRoute).toMatchObject({
        activationStatus: "active",
        activationTestResultId: successfulTestResultId,
      });

      const crossTenantActivationResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-east-africa/telephony/numbers/${secondPhoneNumberId}/live-route/activate`)
        .send({
          actorUserId: "user-ops-lead",
          now: "2026-05-14T17:05:30.000Z",
        });
      expect(crossTenantActivationResponse.status).toBe(404);

      const activatedDispatchResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/telephony/dispatch/inbound")
        .send({
          toPhoneNumber: secondPhoneNumber,
          fromPhoneNumber: "+233201110002",
          callSid: "CA-live-activated",
          now: "2026-05-14T17:06:00.000Z",
        });
      expect(activatedDispatchResponse.status).toBe(201);
      expect(activatedDispatchResponse.body.dispatch).toMatchObject({
        disposition: "routed",
        routeMode: "live_route",
        publishedVersionId: "workflow-success-v1",
        workspaceId: "workspace-success",
      });

      const auditResponse = await request(app.getHttpServer()).get(
        "/organizations/tenant-west-africa/compliance/audit-logs",
      );
      expect(auditResponse.body.auditLogs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: "telephony.live_route_activated",
            target: {
              type: "telephony_number",
              id: secondPhoneNumberId,
            },
            outcome: "succeeded",
          }),
        ]),
      );

      const unauthorizedRouteResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/numbers/${secondPhoneNumberId}/pstn-test-route`)
        .send({
          publishedVersionId: "workflow-unauthorized-v1",
          workflowLabel: "Unauthorized caller test",
          workspaceId: "workspace-success",
          runtimeProfile: "cost-optimized",
          allowedCallerNumbers: ["+233201110777"],
          expiresAt: "2099-05-14T18:30:00.000Z",
          now: "2026-05-14T18:00:00.000Z",
        });
      expect(unauthorizedRouteResponse.status).toBe(201);

      const unauthorizedDispatchResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/telephony/dispatch/inbound")
        .send({
          toPhoneNumber: secondPhoneNumber,
          fromPhoneNumber: "+233201110999",
          callSid: "CA-phone-test-unauthorized",
          now: "2026-05-14T18:05:00.000Z",
        });
      expect(unauthorizedDispatchResponse.status).toBe(201);
      expect(unauthorizedDispatchResponse.body.dispatch).toMatchObject({
        disposition: "routed",
        routeMode: "live_route",
        publishedVersionId: "workflow-success-v1",
      });
      const unauthorizedNumber = unauthorizedDispatchResponse.body.state.phoneNumbers.find(
        (candidate: { id: string }) => candidate.id === secondPhoneNumberId,
      );
      expect(unauthorizedNumber.phoneTestResults[0]).toMatchObject({
        status: "unauthorized_caller",
        reason: "Caller number did not match the PSTN phone test allow list.",
      });

      const expiringRouteResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/numbers/${secondPhoneNumberId}/pstn-test-route`)
        .send({
          publishedVersionId: "workflow-expired-v1",
          workflowLabel: "Expired phone test",
          workspaceId: "workspace-success",
          runtimeProfile: "cost-optimized",
          allowedCallerNumbers: ["+233201110001"],
          expiresAt: "2026-05-14T18:10:00.000Z",
          now: "2026-05-14T18:00:00.000Z",
        });
      expect(expiringRouteResponse.status).toBe(201);

      const expiredDispatchResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/telephony/dispatch/inbound")
        .send({
          toPhoneNumber: secondPhoneNumber,
          fromPhoneNumber: "+233201110001",
          callSid: "CA-phone-test-expired",
          now: "2026-05-14T18:11:00.000Z",
        });
      expect(expiredDispatchResponse.status).toBe(201);
      expect(expiredDispatchResponse.body.dispatch).toMatchObject({
        disposition: "routed",
        routeMode: "live_route",
        publishedVersionId: "workflow-success-v1",
      });
      const expiredNumber = expiredDispatchResponse.body.state.phoneNumbers.find(
        (candidate: { id: string }) => candidate.id === secondPhoneNumberId,
      );
      expect(expiredNumber.phoneTestResults[0]).toMatchObject({
        status: "expired",
        reason: "PSTN phone test expired before a matching caller connected.",
      });

      await app.close();
    }, 30_000);

  it("stores a manually ended protected PSTN phone-test result", async () => {
      const app = await createTestingApp();

      const connectResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/telephony/connections")
        .send({
          actorUserId: "user-ops-lead",
          label: "Tenant Twilio account",
          ownershipMode: "byo_provider_account",
          provider: "twilio",
          region: "us-east-1",
          blockRoutingOnHealthFailure: true,
          accountSid: "AC1234567890abcdef1234567890abcd",
          authToken: "twilio-auth-token-1234567890",
        });
      const connectionId = connectResponse.body.state.connections[0].id as string;

      const importResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/import-twilio-numbers`)
        .send({});
      const phoneNumberId = importResponse.body.state.phoneNumbers[0].id as string;

      const testRouteResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/pstn-test-route`)
        .send({
          publishedVersionId: "workflow-test-v2",
          workflowLabel: "Phone test",
          workspaceId: "workspace-test",
          runtimeProfile: "cost-optimized",
          allowedCallerNumbers: ["+233201110001"],
          expiresAt: "2026-05-14T16:30:00.000Z",
          now: "2026-05-14T16:00:00.000Z",
        });
      const sessionId = testRouteResponse.body.phoneNumber.testRoute.waitingSession.id as string;

      const completeResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/pstn-test-route/${encodeURIComponent(sessionId)}/complete`)
        .send({
          status: "manually_ended",
          reason: "Operator ended the sandbox test. raw payload auth_token=abc123",
          at: "2026-05-14T16:06:00.000Z",
        });

      expect(completeResponse.status).toBe(201);
      const completedNumber = completeResponse.body.state.phoneNumbers.find(
        (candidate: { id: string }) => candidate.id === phoneNumberId,
      );
      expect(completedNumber.testRoute.waitingSession.status).toBe("manually_ended");
      expect(completedNumber.phoneTestResults[0]).toMatchObject({
        status: "manually_ended",
        reason: "Operator ended the sandbox test.",
        publishedVersionId: "workflow-test-v2",
        runtimeProfile: "cost-optimized",
        completedAt: "2026-05-14T16:06:00.000Z",
      });
      expect(JSON.stringify(completedNumber.phoneTestResults[0])).not.toContain("abc123");

      const crossTenantCompleteResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-east-africa/telephony/numbers/${phoneNumberId}/pstn-test-route/${encodeURIComponent(sessionId)}/complete`)
        .send({
          status: "manually_ended",
          reason: "Cross tenant attempt.",
          at: "2026-05-14T16:07:00.000Z",
        });
      expect(crossTenantCompleteResponse.status).toBe(404);

      await app.close();
    }, 30_000);

  it("does not expose tenant-authoritative mid-call runtime policy", async () => {
      const app = await createTestingApp();
      await ensureTestBillingPlan(app, "tenant-west-africa");
      await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/billing/runtime-cost-events")
        .send({
          actorUserId: "user-ops-lead",
          actorRole: "admin",
          runtimeEventId: "telephony-budget-runtime-cost",
          sessionId: "telephony-budget-session",
          occurredAt: "2026-05-20T09:59:00.000Z",
          modelTier: "standard",
          rateVersion: "runtime-rates-2026-05",
          providers: { stt: "assemblyai-streaming" },
          usage: { sttMinutes: 500_000 },
        });

      const connectionResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/telephony/connections")
        .send({
          actorUserId: "user-ops-lead",
          label: "Zara Edge West",
          ownershipMode: "platform_managed",
          provider: "twilio",
          region: "eu-west-1",
          blockRoutingOnHealthFailure: true,
        });
      const connectionId = connectionResponse.body.connection.id as string;
      const numberResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/register-number`)
        .send({
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

      const budgetBlockPolicyResponse = await request(app.getHttpServer())
        .patch("/organizations/tenant-west-africa/billing/budget-policy")
        .send({
          actorUserId: "billing-admin",
          actorRole: "owner",
          monthlyBudgetUsd: 100,
          callMinuteLimit: 10000,
          premiumRuntimeMinuteLimit: 10000,
          overBudgetBehavior: "block",
        });
      expect(budgetBlockPolicyResponse.status).toBe(200);

      const budgetBlockedActivation = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/live-route/activate`)
        .send({
          actorUserId: "user-ops-lead",
          now: "2026-05-20T10:00:00.000Z",
          override: {
            actorUserId: "user-ops-lead",
            approvedByUserId: "platform-admin-1",
            reason: "Emergency activation override request.",
          },
      });
      expect(budgetBlockedActivation.status).toBe(409);
      expect(resolveActivationBlocks(budgetBlockedActivation.body)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "budget_hard_block",
          }),
        ]),
      );

      await request(app.getHttpServer())
        .patch("/organizations/tenant-west-africa/billing/budget-policy")
        .send({
          actorUserId: "billing-admin",
          actorRole: "owner",
          monthlyBudgetUsd: 2000,
          callMinuteLimit: 10000,
          premiumRuntimeMinuteLimit: 10000,
          overBudgetBehavior: "block",
        });

      const canceledSubscriptionWebhook = await request(app.getHttpServer())
        .post("/billing/polar/webhooks")
        .set("polar-webhook-id", "evt-subscription-canceled")
        .set("polar-webhook-signature", "test-signature")
        .send({
          type: "customer.state_changed",
          data: {
            customer: {
              id: "polar_customer_1",
              externalId: "tenant-west-africa",
            },
            activeSubscriptions: [
              {
                id: "polar_subscription_1",
                productId: "polar_product_growth",
                status: "canceled",
              },
            ],
            grantedBenefits: [],
          },
        });
      expect(canceledSubscriptionWebhook.status).toBe(201);

      const subscriptionBlockedActivation = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/live-route/activate`)
        .send({
          actorUserId: "user-ops-lead",
          now: "2026-05-20T10:02:00.000Z",
          override: {
            actorUserId: "user-ops-lead",
            approvedByUserId: "platform-admin-1",
            reason: "Emergency activation override request.",
          },
      });
      expect(subscriptionBlockedActivation.status).toBe(409);
      expect(resolveActivationBlocks(subscriptionBlockedActivation.body)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "inactive_subscription",
          }),
        ]),
      );

      const suspendedActivation = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/live-route/activate`)
        .send({
          actorUserId: "user-ops-lead",
          tenantStatus: "suspended",
          now: "2026-05-20T10:03:00.000Z",
          override: {
            actorUserId: "user-ops-lead",
            approvedByUserId: "platform-admin-1",
            reason: "Emergency activation override request.",
          },
      });
      expect(suspendedActivation.status).toBe(409);
      expect(resolveActivationBlocks(suspendedActivation.body)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "tenant_suspended",
          }),
        ]),
      );

      await request(app.getHttpServer())
        .post("/billing/polar/webhooks")
        .set("polar-webhook-id", "evt-subscription-active")
        .set("polar-webhook-signature", "test-signature")
        .send({
          type: "customer.state_changed",
          data: {
            customer: {
              id: "polar_customer_1",
              externalId: "tenant-west-africa",
            },
            activeSubscriptions: [
              {
                id: "polar_subscription_1",
                productId: "polar_product_growth",
                status: "active",
                currentPeriodEnd: "2026-06-22T00:00:00.000Z",
                cancelAtPeriodEnd: false,
              },
            ],
          },
        });

      await activateRouteWithOverride({
        app,
        phoneNumberId,
        now: "2026-05-20T10:04:00.000Z",
      });

      const pausedResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/live-route/pause`)
        .send({
          actorUserId: "user-ops-lead",
          now: "2026-05-20T10:05:00.000Z",
        });
      expect(pausedResponse.status).toBe(201);
      expect(pausedResponse.body.phoneNumber.liveRoute).toMatchObject({
        activationStatus: "paused",
        pausedAt: "2026-05-20T10:05:00.000Z",
      });

      const pausedDispatch = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/telephony/dispatch/inbound")
        .send({
          toPhoneNumber: "+14155550110",
          fromPhoneNumber: "+233201110001",
          callSid: "CA-paused-live-route",
        });
      expect(pausedDispatch.body.dispatch).toMatchObject({
        disposition: "blocked",
        publishedVersionId: "workflow-vip-v1",
      });
      expect(pausedDispatch.body.dispatch.reason).toContain("paused");

      const resumedResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/live-route/resume`)
        .send({
          actorUserId: "user-ops-lead",
          now: "2026-05-20T10:06:00.000Z",
          override: {
            actorUserId: "user-ops-lead",
            approvedByUserId: "platform-admin-1",
            reason: "Resume from a previously authorized route setup.",
          },
        });
      expect(resumedResponse.status).toBe(201);
      expect(resumedResponse.body.phoneNumber.liveRoute.activationStatus).toBe("active");

      const liveDispatch = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/telephony/dispatch/inbound")
        .send({
          toPhoneNumber: "+14155550110",
          fromPhoneNumber: "+233201110001",
          callSid: "CA-live-runtime-policy",
        });
      const callSessionId = liveDispatch.body.dispatch.callSessionId as string;
      const stateBefore = await request(app.getHttpServer())
        .get("/organizations/tenant-west-africa/telephony/state");
      const sessionBefore = stateBefore.body.executionSessions.find(
        (session: { callSessionId: string }) => session.callSessionId === callSessionId,
      );

      const runtimePolicyResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/calls/${encodeURIComponent(callSessionId)}/runtime-policy`)
        .send({
          subscriptionStatus: "past_due",
          tenantStatus: "suspended",
          budgetAction: "block",
          budgetReasons: ["monthly_budget_exceeded"],
          now: "2026-05-20T10:07:00.000Z",
          graceUntil: "2026-05-20T10:37:00.000Z",
        });
      expect(runtimePolicyResponse.status).toBe(404);

      const stateAfter = await request(app.getHttpServer())
        .get("/organizations/tenant-west-africa/telephony/state");
      expect(stateAfter.body.executionSessions.find(
        (session: { callSessionId: string }) => session.callSessionId === callSessionId,
      )).toEqual(sessionBefore);

      await app.close();
    }, 30_000);
});
