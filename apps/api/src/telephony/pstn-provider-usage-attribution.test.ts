import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { ProviderUsageRecordingRepository } from "../billing/provider-usage-recording.repository";
import { usageRecordingTestPool } from "../billing/provider-usage-recording.test-support";
import { ToolPermissionGrantsService } from "../integrations/tool-permission-grants.service";
import { RuntimeAgentToolExecutorService } from "../sandbox-live-sessions/runtime-agent-tool-executor.service";
import { DefaultLiveSandboxToolRegistry } from "../sandbox-live-sessions/sandbox-live-sessions.providers";
import { PremiumRealtimeToolLoopService } from "../runtime-sessions/premium-realtime-tool-loop.service";
import { WsPremiumRealtimeProviderTransport } from "../runtime-sessions/premium-realtime-provider-transport";
import { RuntimeSessionsService } from "../runtime-sessions/runtime-sessions.service";
import { buildRoutePolicyManifest, openAiHandoffMessage } from "../runtime-sessions/runtime-sessions.service.test-support";
import { InMemoryTelephonyIncrementalRepository } from "./telephony-incremental.repository.test-helper";
import { createPremiumDispatchSnapshot } from "./pstn-premium-call-execution.test-support";
import { PstnPremiumCallExecution } from "./pstn-premium-call-execution";
import { TelephonyService } from "./telephony.service";
import { PstnAdmissionCoordinator } from "./pstn-admission-coordinator";
import { InMemoryPstnCallAdmission } from "./in-memory-pstn-call-admission";
import { resolvePstnAdmissionConfig } from "./pstn-admission-config";
import { TrustedPaygActiveCallFundingService } from "../billing/trusted-payg-active-call-funding.service";
import { BillingChargeReservationRepository } from "../billing/billing-charge-reservation.repository";
import { TrustedSubscriptionCallLifecycleService } from "../billing/trusted-subscription-call-lifecycle.service";
import { PostgresTenantStatusRepository } from "../persistence/tenant-status.repository";

describe("PSTN provider usage attribution", () => {
  it("keeps the verified call identity on initial and replacement provider connections", async () => {
    const pool = usageRecordingTestPool();
    const usage = new ProviderUsageRecordingRepository(pool);
    const telephonyStore = new InMemoryTelephonyIncrementalRepository();
    const manifest = buildRoutePolicyManifest();
    const snapshot = createPremiumDispatchSnapshot(manifest);
    const callSessionId = snapshot.callSessionId;
    const tenantId = snapshot.tenantId;
    const at = "2026-09-08T10:00:00.000Z";
    await telephonyStore.createCallSetup({
      premiumDispatchSnapshot: snapshot,
      dispatch: {
        id: snapshot.dispatchId, tenantId, callSessionId, direction: "inbound", disposition: "routed",
        reason: "Verified test dispatch.", routeMode: "live_route", phoneNumberId: "number-1", connectionId: "carrier-1",
        publishedVersionId: manifest.publishedVersionId, workspaceId: manifest.workspaceId!, workflowLabel: "Test",
        runtimeProfile: "premium-realtime", runtimePath: "pstn-premium-realtime",
        recording: { enabled: false, consentMode: "disabled", consentMessage: "" },
        recordingConsent: { state: "not_required", noticeRequired: false, consentMode: "disabled",
          message: "", recordedAt: at, reason: "Recording is disabled." },
        toPhoneNumber: "+15550001000", fromPhoneNumber: "+15550002000", createdAt: at, source: "webhook",
      },
      executionSession: {
        id: "execution-1", tenantId, dispatchId: snapshot.dispatchId, callSessionId, connectionId: "carrier-1",
        provider: "twilio", ownershipMode: "byo_provider_account", direction: "inbound", status: "ringing",
        lifecycleState: { stage: "media-connected", observedAt: at },
        toPhoneNumber: "+15550001000", fromPhoneNumber: "+15550002000", workflowLabel: "Test",
        workspaceId: manifest.workspaceId!, testCall: false, bridgeKind: "twilio-programmable-voice",
        bridgeTarget: "+15550001000", mediaPath: "provider-native", diagnostics: [], createdAt: at, updatedAt: at,
      },
      executionCommands: [],
      mediaToken: { tenantId, callSessionId, dispatchId: snapshot.dispatchId, connectionId: "carrier-1",
        tokenHash: "test-only", expiresAt: "2099-09-08T10:00:00.000Z", createdAt: at },
    });
    const ownership = { workerId: "worker-test", ownerEpoch: 1 };
    telephonyStore.premiumOwners.set(`${tenantId}:${callSessionId}`, { ...ownership, leaseExpiresAtMs: Date.parse("2099-09-08T10:00:00.000Z") });
    const admission = new PstnAdmissionCoordinator(new InMemoryPstnCallAdmission(), resolvePstnAdmissionConfig({ NODE_ENV: "test" }));
    const billingDatabase = {
      async query(sql: string, parameters: unknown[]) {
        if (parameters[0] !== tenantId) return { rows: [] };
        if (sql.includes("from tenants")) return { rows: [{ status: "active" }] };
        if (sql.includes("from billing_charge_reservations")) return { rows: [] };
        if (sql.includes("from billing_subscription_call_reservations") && parameters[1] === callSessionId) {
          return { rows: [{ id: "reservation-test", tenant_id: tenantId, reservation_key: callSessionId,
            subscription_id: "subscription-test", cycle_id: "cycle-test", catalog_id: "catalog-test", plan_slug: "starter",
            meter_class: "premium", billing_mode: "byo", provider: "twilio", direction: "inbound", status: "active",
            reserved_seconds: 300, reserved_included_seconds: 300, reserved_overage_minor: 0, reserved_telephony_minor: 0,
            expires_at: "2099-09-08T10:00:00.000Z", created_at: at, updated_at: at }] };
        }
        throw new Error("Unexpected test database query.");
      },
      async connect() { return { query: this.query, release() {} }; },
    };
    const funding = new TrustedPaygActiveCallFundingService(undefined!,
      new BillingChargeReservationRepository(billingDatabase as never),
      new TrustedSubscriptionCallLifecycleService(billingDatabase as never));
    // Configuration, carrier setup, and connector grants are outside this execution path.
    // Leave unused dependencies absent; all invoked domain services remain real.
    const telephony = new TelephonyService({ load: () => null, save() {}, listOrganizationIds: () => [] },
      undefined!, undefined!, undefined!, telephonyStore, admission, undefined!,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, funding, undefined,
      new PostgresTenantStatusRepository(billingDatabase as never));
    const runtime = new RuntimeSessionsService(new PremiumRealtimeToolLoopService(
      new RuntimeAgentToolExecutorService(new DefaultLiveSandboxToolRegistry(), new ToolPermissionGrantsService(undefined!))));
    const sockets: UsageSocket[] = [];
    const transport = new WsPremiumRealtimeProviderTransport(() => {
      const socket = new UsageSocket(); sockets.push(socket); return socket;
    }, { OPENAI_API_KEY: "test-key", OPENAI_PROJECT_ID: "proj-shared" }, usage);
    const execution = new PstnPremiumCallExecution(telephony, telephonyStore, runtime, transport);
    const marks: string[] = [];
    let callerClosed = false;
    try {
      await execution.start({ organizationId: tenantId, dispatchId: snapshot.dispatchId, callSessionId, ownership,
        streamSid: "MZ-test", output: { sendMedia() {}, sendMark(name) { marks.push(name); }, clearAudio() {},
          close() { callerClosed = true; } } });
      const first = sockets[0]!;
      first.receive({ type: "session.created", session: { id: "provider-first" } });
      first.receive({ type: "session.updated" });
      await expect.poll(() => usage.listTenantConnections(tenantId)).toMatchObject([{ callSessionId }]);
      const sourceResponse = JSON.parse(openAiHandoffMessage({ providerCallId: "handoff-1", responseId: "response-source",
        announcementAlreadySpoken: true }));
      sourceResponse.response.usage = { input_tokens: 1, output_tokens: 2, total_tokens: 3 };
      first.receive({ type: "response.created", response: { id: "response-source", status: "in_progress" } });
      first.receive({ type: "response.output_audio.delta", response_id: "response-source", item_id: "item-source",
        content_index: 0, delta: Buffer.alloc(160, 0xff).toString("base64") });
      first.receive({ type: "response.output_audio.done", response_id: "response-source" });
      first.receive(sourceResponse);
      await expect.poll(() => marks.length).toBe(2);
      for (const name of marks) execution.acknowledgePlaybackMark({ callSessionId, name });
      await expect.poll(() => sockets.length).toBe(2);
      const second = sockets[1]!;
      second.receive({ type: "session.created", session: { id: "provider-second" } });
      second.receive({ type: "session.updated" });
      await expect.poll(() => second.sent.some(message => message.type === "response.create")).toBe(true);
      expect(first.readyState).toBe(3);
      expect(callerClosed).toBe(false);
      second.receive({ type: "response.done", response: { id: "response-target", status: "completed", output: [],
        usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 } } });
      await expect.poll(() => usage.listTenantRequests(tenantId)).toMatchObject([
        { callSessionId, connectionId: expect.any(String), result: { providerRequestId: "response-source" } },
        { callSessionId, connectionId: expect.any(String), result: { providerRequestId: "response-target" } },
      ]);
      const connections = await usage.listTenantConnections(tenantId);
      const requests = await usage.listTenantRequests(tenantId);
      expect(connections).toHaveLength(2);
      expect(new Set(requests.map(row => row.connectionId)).size).toBe(2);
      expect(new Set(requests.map(row => row.sessionId)).size).toBe(1);
      expect(await usage.listTenantRequests("other-tenant")).toEqual([]);
    } finally {
      // Dispose the in-memory telephony database before cleanup. Terminal billing is a separate test seam.
      telephonyStore.callSetups.length = 0;
      await execution.stop({ callSessionId }).catch(() => undefined);
      await expect.poll(async () => (await usage.listTenantConnections(tenantId)).every(row => row.result !== null)).toBe(true);
      await pool.end();
    }
  });
});

class UsageSocket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  readonly sent: Record<string, unknown>[] = [];
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close(code = 1000, reason = "") { this.readyState = 3; this.emit("close", code, Buffer.from(reason)); }
  receive(message: unknown) { this.emit("message", JSON.stringify(message)); }
}
