import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createTestingApp, activateRouteWithOverride } from "./telephony.controller.test-support";

describe("TelephonyController operations-isolation", () => {
  afterEach(() => {
      vi.restoreAllMocks();
    });

  it("supports provider heartbeats, loopback test calls, and credential rotation for telephony operations", async () => {
      const app = await createTestingApp();

      const twilioConnectResponse = await request(app.getHttpServer())
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

      const connectionId = twilioConnectResponse.body.connection.id as string;

      await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/import-twilio-numbers`)
        .send({});

      const importedNumber = (
        await request(app.getHttpServer()).get("/organizations/tenant-west-africa/telephony/state")
      ).body.phoneNumbers[0] as { id: string; phoneNumber: string };

      await request(app.getHttpServer())
        .patch(`/organizations/tenant-west-africa/telephony/numbers/${importedNumber.id}/routing`)
        .send({
          publishedVersionId: "workflow-support-v1",
          workflowLabel: "Support triage",
          workspaceId: "workspace-customer-success",
        });

      const heartbeatResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/heartbeat`)
        .send({
          scheduled: false,
        });

      expect(heartbeatResponse.status).toBe(201);
      expect(heartbeatResponse.body.heartbeat).toMatchObject({
        status: "healthy",
        scheduled: false,
        connectionId,
      });
      expect(heartbeatResponse.body.heartbeat.diagnostics.join(" ")).toContain("Twilio");

      await activateRouteWithOverride({
        app,
        phoneNumberId: importedNumber.id,
        now: "2026-05-20T12:01:00.000Z",
      });

      const testCallResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/test-call`)
        .send({
          phoneNumberId: importedNumber.id,
          fromPhoneNumber: "+233201110001",
          callSid: "CA-test-call-1",
        });

      expect(testCallResponse.status).toBe(201);
      expect(testCallResponse.body.dispatch).toMatchObject({
        disposition: "routed",
        publishedVersionId: "workflow-support-v1",
      });
      expect(testCallResponse.body.session).toMatchObject({
        callSessionId: "CA-test-call-1:telephony",
        status: "ringing",
        testCall: true,
      });

      const rotationResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/telephony/credentials/rotate")
        .send({});

      expect(rotationResponse.status).toBe(201);
      expect(rotationResponse.body.rotatedConnectionCount).toBe(1);

      await app.close();
    }, 30_000);

  it("does not expose telephony connections numbers or call sessions across tenants", async () => {
      const app = await createTestingApp();

      const connectResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/telephony/connections")
        .send({
          actorUserId: "user-ops-lead",
          label: "West tenant edge",
          ownershipMode: "platform_managed",
          provider: "twilio",
          region: "eu-west-1",
          blockRoutingOnHealthFailure: true,
        });
      const connectionId = connectResponse.body.connection.id as string;

      const numberResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/register-number`)
        .send({
          actorUserId: "user-ops-lead",
          phoneNumber: "+14155550110",
          friendlyName: "West support",
        });
      const phoneNumberId = numberResponse.body.phoneNumber.id as string;

      await request(app.getHttpServer())
        .patch(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/routing`)
        .send({
          publishedVersionId: "workflow-west-v1",
          workflowLabel: "West support",
          workspaceId: "workspace-west",
        });

      const dispatchResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/telephony/dispatch/inbound")
        .send({
          toPhoneNumber: "+14155550110",
          fromPhoneNumber: "+233201110001",
          callSid: "CA-west-isolation-1",
        });
      const callSessionId = dispatchResponse.body.dispatch.callSessionId as string;
      const dispatchId = dispatchResponse.body.dispatch.id as string;

      const crossTenantValidateResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-east-africa/telephony/connections/${connectionId}/validate`)
        .send({});
      const crossTenantRouteResponse = await request(app.getHttpServer())
        .patch(`/organizations/tenant-east-africa/telephony/numbers/${phoneNumberId}/routing`)
        .send({
          publishedVersionId: "workflow-east-v1",
          workflowLabel: "East support",
          workspaceId: "workspace-east",
        });
      const crossTenantCallEventResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-east-africa/telephony/calls/${encodeURIComponent(callSessionId)}/events`)
        .send({
          dispatchId,
          eventType: "dtmf.received",
          digit: "1",
        });
      const crossTenantHumanFallbackResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-east-africa/telephony/calls/${encodeURIComponent(callSessionId)}/human-fallback`)
        .send({
          dispatchId,
          actorUserId: "user-ops-lead",
          transferTarget: "+14155550888",
          callbackNumber: "+233201110001",
        });
      const eastStateResponse = await request(app.getHttpServer()).get(
        "/organizations/tenant-east-africa/telephony/state",
      );
      const westStateResponse = await request(app.getHttpServer()).get(
        "/organizations/tenant-west-africa/telephony/state",
      );

      expect(crossTenantValidateResponse.status).toBe(404);
      expect(crossTenantRouteResponse.status).toBe(404);
      expect(crossTenantCallEventResponse.status).toBe(404);
      expect(crossTenantHumanFallbackResponse.status).toBe(404);
      expect(eastStateResponse.status).toBe(200);
      expect(eastStateResponse.body.connections).toEqual([]);
      expect(eastStateResponse.body.phoneNumbers).toEqual([]);
      expect(eastStateResponse.body.dispatches).toEqual([]);
      expect(westStateResponse.body.dispatches).toHaveLength(1);
      expect(JSON.stringify(eastStateResponse.body)).not.toContain("CA-west-isolation-1");

      await app.close();
    }, 30_000);
});
