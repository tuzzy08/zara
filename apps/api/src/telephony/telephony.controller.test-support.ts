import { expect } from "vitest";
import { Test } from "@nestjs/testing";
import { type INestApplication } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { type AvailableTwilioPhoneNumber } from "@zara/core";
import { BILLING_POLAR_CLIENT, type BillingPolarClient } from "../billing/polar-billing.client.js";
import { ALLOW_LEGACY_BILLING_USAGE_TEST_FIXTURE } from "../billing/billing.controller.js";
import { BILLING_STATE_REPOSITORY, FileBillingStateRepository } from "../billing/billing-state.repository.js";
import { BILLING_READ_MODEL_REPOSITORY } from "../billing/billing-read-model.repository.js";
import { BILLING_LEDGER_REPOSITORY } from "../billing/postgres-billing-ledger.repository.js";
import { TrustedBillingUsageProducer } from "../billing/trusted-billing-usage-producer.js";
import { BillingService } from "../billing/billing.service.js";
import { ComplianceModule } from "../compliance/compliance.module.js";
import { AUDIT_LOG_REPOSITORY, FileAuditLogRepository } from "../compliance/audit-log.repository.js";
import { configureCors } from "../config/cors.js";
import { installTestTenantAuth, withTestTenantAuth } from "../testing/tenant-auth-request.js";
import { FileTelephonyStateRepository, TELEPHONY_STATE_REPOSITORY } from "./telephony-state.repository.js";
import { TELEPHONY_INCREMENTAL_REPOSITORY } from "./telephony-incremental.repository.js";
import { InMemoryTelephonyIncrementalRepository } from "./telephony-incremental.repository.test-helper.js";
import { PremiumPstnDispatchSnapshotResolver } from "./premium-pstn-dispatch-snapshot-resolver.js";
import { PSTN_PREMIUM_WORKER_AVAILABILITY, type PstnPremiumWorkerAvailability } from "../realtime-worker/pstn-premium-worker-availability.js";
import { defaultPremiumRealtimeConversationPolicy } from "../premium-realtime-policy/premium-realtime-conversation-policy.models.js";
import { TWILIO_NUMBER_INVENTORY_PROVIDER, type TwilioNumberInventoryProvider } from "./twilio-number-inventory.provider.js";
import { TWILIO_NUMBER_ROUTING_PROVIDER, type TwilioCallDiagnosticDetail, type TwilioIncomingNumberRouteConfiguration, type TwilioMonitorAlertDiagnostic, type TwilioNumberRoutingProvider, type TwilioRecentCallDiagnostic } from "./twilio-number-routing.provider.js";
import { TrustedPaygTelephonyCallStartService } from "./trusted-payg-telephony-call-start.service.js";
import { BillingPaygEligibilityService } from "../billing/billing-payg-eligibility.service.js";
import { PostgresTenantStatusRepository } from "../persistence/tenant-status.repository.js";
import { TrustedCallCommercialModeResolver } from "../billing/trusted-call-commercial-mode-resolver.js";
import { TrustedSubscriptionCallLifecycleService } from "../billing/trusted-subscription-call-lifecycle.service.js";
import { TrustedPaygTerminalFinalizationService } from "../billing/trusted-payg-terminal-finalization.service.js";
import { TrustedTerminalBillingRecoveryService } from "../billing/trusted-terminal-billing-recovery.service.js";

export async function createTestingApp(input: {
  installTenantAuth?: boolean | undefined;
  skipTestBillingPlan?: boolean | undefined;
  twilioRouting?: TwilioNumberRoutingProvider | undefined;
  workerAvailability?: PstnPremiumWorkerAvailability | undefined;
  paygCallStart?: Pick<TrustedPaygTelephonyCallStartService, "start"> | undefined;
  paygEligibility?: Pick<BillingPaygEligibilityService, "getEligibility"> | undefined;
  billingService?: Pick<BillingService, "getBillingState"> | undefined;
  tenantStatusRepository?: Pick<PostgresTenantStatusRepository, "getStatus"> | undefined;
  commercialModeResolver?: Pick<TrustedCallCommercialModeResolver, "resolve"> | undefined;
} = {}) {
  process.env.PAYG_MAXIMUM_CALL_SECONDS ??= "300";
  process.env.PAYG_RESERVATION_TTL_SECONDS ??= "360";
  const incrementalRepository = new InMemoryTelephonyIncrementalRepository();
  const stateRepository = new FileTelephonyStateRepository(
    join(tmpdir(), "zara-telephony-tests", randomUUID()),
  );
  const moduleBuilder = Test.createTestingModule({
    imports: [ComplianceModule],
  })
    .overrideProvider(TELEPHONY_STATE_REPOSITORY)
    .useValue({
      listOrganizationIds: () => stateRepository.listOrganizationIds(),
      load: (organizationId: string) => stateRepository.load(organizationId),
      save: (record: Parameters<FileTelephonyStateRepository["save"]>[0]) => {
        stateRepository.save(record);
        incrementalRepository.loadConnections(
          record.organizationId,
          record.connections.map(({ id }) => id),
        );
        incrementalRepository.loadPhoneNumberProjections(
          record.organizationId,
          record.phoneNumbers,
        );
      },
    })
    .overrideProvider(TELEPHONY_INCREMENTAL_REPOSITORY)
    .useValue(incrementalRepository)
    .overrideProvider(PremiumPstnDispatchSnapshotResolver)
    .useValue({
      async resolve(snapshotInput: {
        organizationId: string;
        workspaceId: string;
        publishedVersionId: string;
      }) {
        return createPremiumSnapshotResolution(snapshotInput);
      },
    })
    .overrideProvider(BILLING_STATE_REPOSITORY)
    .useValue(
      new FileBillingStateRepository(
        join(tmpdir(), "zara-telephony-billing-tests", randomUUID()),
      ),
    )
    .overrideProvider(BILLING_READ_MODEL_REPOSITORY)
    .useValue({
      async getSubscriptionProductId(planSlug: string) {
        return `polar-catalog-${planSlug}-test`;
      },
      async getPaygProductId() {
        return "polar-catalog-payg-test";
      },
      async load() {
        return null;
      },
    })
    .overrideProvider(BILLING_LEDGER_REPOSITORY)
    .useValue(createTestBillingLedgerRepository())
    .overrideProvider(AUDIT_LOG_REPOSITORY)
    .useValue(
      new FileAuditLogRepository(
        join(tmpdir(), "zara-telephony-audit-tests", randomUUID()),
      ),
    )
    .overrideProvider(TWILIO_NUMBER_INVENTORY_PROVIDER)
    .useValue(createGeneratedTwilioInventoryProvider())
    .overrideProvider(TWILIO_NUMBER_ROUTING_PROVIDER)
    .useValue(input.twilioRouting ?? createCapturingTwilioRoutingProvider())
    .overrideProvider(PSTN_PREMIUM_WORKER_AVAILABILITY)
    .useValue(input.workerAvailability ?? {
      async select(
        providers: readonly ("openai-realtime" | "gemini-live")[],
      ) {
        return {
          status: "available" as const,
          providers,
          worker: {
            workerId: "test-premium-worker",
            releaseId: "test-release",
            mediaStreamBaseUrl:
              "wss://realtime.zara.test/telephony/twilio/media-streams",
            availableSlots: 20,
            activeCalls: 0,
            startingCalls: 0,
          },
        };
      },
    })
    .overrideProvider(BILLING_POLAR_CLIENT)
    .useValue(createPolarClient())
    .overrideProvider(ALLOW_LEGACY_BILLING_USAGE_TEST_FIXTURE)
    .useValue(true)
    .overrideProvider(TrustedBillingUsageProducer)
    .useValue({
      async recordTerminalCall() {},
      async recordRuntimeSession() {},
    })
    .overrideProvider(TrustedPaygTelephonyCallStartService)
    .useValue(input.paygCallStart)
    .overrideProvider(BillingPaygEligibilityService)
    .useValue(input.paygEligibility)
    .overrideProvider(PostgresTenantStatusRepository)
    .useValue(input.tenantStatusRepository ?? {
      async getStatus() { return { outcome: "found" as const, status: "active" as const }; },
    })
    .overrideProvider(TrustedCallCommercialModeResolver)
    .useValue(input.commercialModeResolver ?? {
      async resolve() {
        return { mode: "subscription" as const, subscriptionId: "test-subscription",
          catalogId: "test-catalog", planSlug: "growth", premiumAllowed: true,
          available: true, availableIncludedSeconds: 300,
          availablePaygMinor: 0, availableOverageMinor: 0 };
      },
    })
    .overrideProvider(TrustedSubscriptionCallLifecycleService)
    .useValue({
      async start() { return { outcome: "reserved" as const, duplicate: false }; },
      async releaseByReservationKey() { return { outcome: "released" as const, duplicate: false }; },
      async getReservationByKey() {
        return { planSlug: "growth", meterClass: "standard", billingMode: "byo",
          provider: "twilio", direction: "inbound" };
      },
      async finalizeByReservationKey() {
        return { outcome: "finalized" as const, duplicate: false, paygAppliedMinor: 0 };
      },
    })
    .overrideProvider(TrustedPaygTerminalFinalizationService)
    .useValue({
      async resolveCallBillingMode() { return "subscription" as const; },
      async getPinnedCallChargeContext() { return null; },
    })
    .overrideProvider(TrustedTerminalBillingRecoveryService)
    .useValue({ async submit() { return { status: "completed" as const }; } });
  if (input.billingService !== undefined) {
    moduleBuilder.overrideProvider(BillingService).useValue(input.billingService);
  }
  const moduleRef = await moduleBuilder.compile();

  const app: INestApplication = moduleRef.createNestApplication({ rawBody: true });
  configureCors(app);
  if (input.installTenantAuth !== false) {
    installTestTenantAuth(app);
  }
  await app.init();
  if (input.installTenantAuth !== false && input.skipTestBillingPlan !== true) {
    await ensureTestBillingPlan(app, "tenant-west-africa");
  }

  return app;
}

export function createPremiumSnapshotResolution(input: {
  organizationId: string;
  workspaceId: string;
  publishedVersionId: string;
}) {
  return {
    resolvedManifest: {
      schemaVersion: 1,
      tenantId: input.organizationId,
      workspaceId: input.workspaceId,
      workflowId: "workflow-test",
      publishedVersionId: input.publishedVersionId,
      publishedAt: "2026-05-14T15:59:00.000Z",
      runtimeProfile: "premium-realtime",
      entryNodeId: "agent-test",
      entryAgentId: "agent-test",
      graph: { nodes: [], edges: [] },
      routePolicies: [],
      agents: [],
      toolGrants: [],
      warnings: [],
    },
    resolvedConversationPolicy: structuredClone(
      defaultPremiumRealtimeConversationPolicy,
    ),
  };
}

export function createGeneratedTwilioInventoryProvider(): TwilioNumberInventoryProvider {
  const numbers: AvailableTwilioPhoneNumber[] = [
    {
      sid: "PN78901001",
      phoneNumber: "+14155557890",
      friendlyName: "Support line",
      capabilities: {
        voice: true,
        sms: true,
      },
    },
    {
      sid: "PN78902002",
      phoneNumber: "+14156667890",
      friendlyName: "Reception line",
      capabilities: {
        voice: true,
        sms: false,
      },
    },
    {
      sid: "PN78903003",
      phoneNumber: "+14157777890",
      friendlyName: "SMS campaigns",
      capabilities: {
        voice: false,
        sms: true,
      },
    },
  ];

  return {
    async listIncomingPhoneNumbers() {
      return numbers;
    },
  };
}

export function createCapturingTwilioRoutingProvider(options: {
  callDetails?: TwilioCallDiagnosticDetail[] | undefined;
  configuration?: TwilioIncomingNumberRouteConfiguration | undefined;
  monitorAlerts?: TwilioMonitorAlertDiagnostic[] | undefined;
  recentCalls?: TwilioRecentCallDiagnostic[] | undefined;
} = {}): TwilioNumberRoutingProvider & {
  callDetailRequests: Array<{
    accountSid: string;
    authToken: string;
    callSid: string;
  }>;
  terminationRequests: Array<{
    accountSid: string;
    authToken: string;
    callSid: string;
  }>;
  requests: Array<{
    accountSid: string;
    authToken: string;
    phoneNumberSid: string;
    statusCallbackUrl?: string | undefined;
    voiceUrl: string;
  }>;
  inspections: Array<{
    accountSid: string;
    authToken: string;
    phoneNumberSid: string;
  }>;
  recentCallRequests: Array<{
    accountSid: string;
    authToken: string;
    phoneNumber: string;
    limit?: number | undefined;
  }>;
  monitorAlertRequests: Array<{
    accountSid: string;
    authToken: string;
    startDate?: string | undefined;
    endDate?: string | undefined;
    limit?: number | undefined;
  }>;
} {
  const requests: Array<{
    accountSid: string;
    authToken: string;
    phoneNumberSid: string;
    statusCallbackUrl?: string | undefined;
    voiceUrl: string;
  }> = [];
  const inspections: Array<{
    accountSid: string;
    authToken: string;
    phoneNumberSid: string;
  }> = [];
  const recentCallRequests: Array<{
    accountSid: string;
    authToken: string;
    phoneNumber: string;
    limit?: number | undefined;
  }> = [];
  const monitorAlertRequests: Array<{
    accountSid: string;
    authToken: string;
    startDate?: string | undefined;
    endDate?: string | undefined;
    limit?: number | undefined;
  }> = [];
  const callDetailRequests: Array<{
    accountSid: string;
    authToken: string;
    callSid: string;
  }> = [];
  const terminationRequests: Array<{
    accountSid: string;
    authToken: string;
    callSid: string;
  }> = [];

  return {
    callDetailRequests,
    inspections,
    monitorAlertRequests,
    recentCallRequests,
    requests,
    terminationRequests,
    async configureIncomingPhoneNumberWebhook(input) {
      requests.push(input);
      return {
        sid: input.phoneNumberSid,
        trunkSid: null,
        voiceApplicationSid: null,
        voiceMethod: "POST",
        statusCallback: input.statusCallbackUrl,
        voiceUrl: input.voiceUrl,
        ...options.configuration,
      };
    },
    async inspectIncomingPhoneNumber(input) {
      inspections.push(input);
      return {
        sid: input.phoneNumberSid,
        trunkSid: null,
        voiceApplicationSid: null,
        voiceMethod: "POST",
        ...options.configuration,
      };
    },
    async listRecentCallsForNumber(input) {
      recentCallRequests.push(input);
      return options.recentCalls ?? [];
    },
    async retrieveCall(input) {
      callDetailRequests.push(input);
      return options.callDetails?.find((call) => call.sid === input.callSid) ?? {
        sid: input.callSid,
      };
    },
    async terminateCall(input) {
      terminationRequests.push(input);
      return {
        sid: input.callSid,
        status: "completed",
      };
    },
    async listRecentMonitorAlerts(input) {
      monitorAlertRequests.push(input);
      return options.monitorAlerts ?? [];
    },
  };
}

export function createPolarClient(): BillingPolarClient {
  return {
    createdCheckouts: [],
    createdCustomerSessions: [],
    ingestedUsageEvents: [],
    async createCheckout(input) {
      this.createdCheckouts.push(input);
      return {
        providerCheckoutId: "polar_checkout_growth",
        checkoutUrl: "https://polar.sh/checkout/session_growth",
      };
    },
    async createCustomerPortal(input) {
      this.createdCustomerSessions.push(input);
      return {
        customerPortalUrl: "https://polar.sh/tuzzy/portal/session",
      };
    },
    async ingestUsageEvent(input) {
      this.ingestedUsageEvents.push(input);
      return {
        providerEventId: "polar_usage_event_1",
      };
    },
    async getCustomerState(input) {
      return {
        customerId: `polar-customer:${input.externalCustomerId}`,
        externalCustomerId: input.externalCustomerId,
        activeSubscriptions: [],
        grantedBenefits: [],
      };
    },
  };
}

export function createTestBillingLedgerRepository() {
  const receipts = new Set<string>();
  return {
    async listSubscriptionProjections() { return []; },
    async upsertTenantAccount() {},
    async recordPolarWebhookReceipt(input: { eventId: string }) {
      const duplicate = receipts.has(input.eventId);
      receipts.add(input.eventId);
      return { duplicate };
    },
    async findPolarMappingByProviderId(providerId: string) {
      if (providerId === "polar-benefit-premium-runtime") {
        return {
          catalogId: "test-catalog",
          mappingType: "benefit",
          internalKey: "premium-realtime",
          providerId,
          environment: "sandbox",
        };
      }
      return {
        catalogId: "test-catalog",
        mappingType: "product",
        internalKey: providerId.includes("starter") ? "starter"
          : providerId.includes("scale") ? "scale" : "growth",
        providerId,
        environment: "sandbox",
      };
    },
    async applyPolarCustomerStateProjection() {},
    async upsertSubscriptionProjection() {},
    async applyPaidPaygOrder() {},
    async applyPaidInvoiceProjection() {},
    async applyPaygOrderRefund() {},
    async markPolarWebhookProcessed() {},
  };
}

export async function activateRouteWithOverride(input: {
  app: INestApplication;
  organizationId?: string | undefined;
  phoneNumberId: string;
  actorUserId?: string | undefined;
  now?: string | undefined;
  skipBillingPlan?: boolean | undefined;
}) {
  const organizationId = input.organizationId ?? "tenant-west-africa";
  const actorUserId = input.actorUserId ?? "user-ops-lead";
  if (input.skipBillingPlan !== true) {
    await ensureTestBillingPlan(input.app, organizationId, actorUserId);
  }
  const response = await withTestTenantAuth(
    request(input.app.getHttpServer())
      .post(`/organizations/${organizationId}/telephony/numbers/${input.phoneNumberId}/live-route/activate`),
    { organizationId, userId: actorUserId },
  ).send({
      actorUserId,
      now: input.now ?? "2026-05-14T12:12:00.000Z",
      override: {
        actorUserId,
        approvedByUserId: "platform-admin-1",
        reason: "Test fixture override for non-PSTN activation coverage.",
      },
    });

  expect(response.status).toBe(201);
  expect(response.body.activation.summary.override).toMatchObject({
    approvedByUserId: actorUserId,
  });

  return response;
}

export async function ensureTestBillingPlan(
  app: INestApplication,
  organizationId: string,
  actorUserId = "user-ops-lead",
) {
  const stateResponse = await withTestTenantAuth(
    request(app.getHttpServer()).get(`/organizations/${organizationId}/billing/state`),
    { organizationId, userId: actorUserId },
  );
  expect(stateResponse.status).toBe(200);
  if (stateResponse.body.billing.plan !== null) {
    return;
  }

  const checkoutResponse = await withTestTenantAuth(
    request(app.getHttpServer()).post(`/organizations/${organizationId}/billing/checkout`),
    { organizationId, userId: actorUserId },
  ).send({
    actorUserId,
    actorRole: "admin",
    planSlug: "growth",
    successUrl: "http://127.0.0.1:4173/billing/success",
  });
  expect(checkoutResponse.status).toBe(201);

  const webhookResponse = await request(app.getHttpServer())
    .post("/billing/polar/webhooks")
    .set("webhook-id", `test-subscription-active-${organizationId}`)
    .set("webhook-signature", "test-signature")
    .send({
      type: "customer.state_changed",
      data: {
        customer: {
          id: `polar-customer-${organizationId}`,
          externalId: organizationId,
        },
        activeSubscriptions: [
          {
            id: `polar-subscription-${organizationId}`,
            productId: "polar_product_growth",
            status: "active",
            currentPeriodEnd: "2026-09-09T00:00:00.000Z",
            cancelAtPeriodEnd: false,
          },
        ],
        grantedBenefits: [
          {
            id: "benefit-premium-runtime",
            benefitId: "polar-benefit-premium-runtime",
            type: "custom",
            properties: { key: "premium-realtime" },
          },
        ],
      },
  });
  expect(webhookResponse.status).toBe(201);

  const activeStateResponse = await withTestTenantAuth(
    request(app.getHttpServer()).get(`/organizations/${organizationId}/billing/state`),
    { organizationId, userId: actorUserId },
  );
  expect(activeStateResponse.body.billing.subscription.status).toBe("active");
}

export function resolveActivationBlocks(body: {
  blocks?: unknown;
  message?: { blocks?: unknown } | string;
}) {
  if (Array.isArray(body.blocks)) {
    return body.blocks;
  }

  if (typeof body.message === "object" && Array.isArray(body.message.blocks)) {
    return body.message.blocks;
  }

  return [];
}
