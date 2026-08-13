import { createHash } from "node:crypto";

import type { BillingPriceCatalog } from "./postgres-billing-ledger.repository";
import type {
  BillingProviderEvidenceReport,
  BillingProviderEvidenceSource,
} from "./billing-production-reconciliation-evidence";
import type { BillingCycleEvidenceInput } from "./billing-usage-reconciliation.service";
import type { TelephonyStateRepository } from "../telephony/telephony-state.repository";
import type { TelephonySecretVault } from "../telephony/telephony-secret-vault";

export interface TwilioBillingCallRecord {
  sid: string;
  accountSid: string;
  status: string;
  direction: string;
  durationSeconds?: number | undefined;
  price?: string | null | undefined;
  priceUnit?: string | null | undefined;
  startedAt?: string | null | undefined;
  endedAt?: string | null | undefined;
}

export interface TwilioBillingCallClient {
  listCalls(input: {
    accountSid: string;
    authToken: string;
    cycleStartsAt: string;
    cycleEndsAt: string;
    direction: "inbound" | "outbound";
    phoneNumber: string;
  }): Promise<TwilioBillingCallRecord[]>;
}

type CatalogReader = {
  getPriceCatalog(id: string): Promise<BillingPriceCatalog | null>;
};

export class TwilioBillingEvidenceSource implements BillingProviderEvidenceSource {
  constructor(
    private readonly states: Pick<TelephonyStateRepository, "load">,
    private readonly vault: Pick<TelephonySecretVault, "open">,
    private readonly catalogs: CatalogReader,
    private readonly calls: TwilioBillingCallClient,
  ) {}

  async collectCycle(input: BillingCycleEvidenceInput): Promise<BillingProviderEvidenceReport | null> {
    const state = await this.states.load(input.organizationId);
    if (state === null) return null;
    const catalog = await this.catalogs.getPriceCatalog(input.catalogId);
    if (catalog === null) throw evidenceError("price catalog is unavailable");

    const sessions = (state.executionSessions ?? []).filter((session) =>
      session.tenantId === input.organizationId
      && session.provider === "twilio"
      && session.ownershipMode === "platform_managed"
      && !session.testCall
      && inCycle(session.createdAt, input));
    const connections = state.connections.filter((connection) =>
      connection.tenantId === input.organizationId
      && connection.provider === "twilio"
      && connection.ownershipMode === "platform_managed");
    if (connections.length === 0) return null;

    const sessionsByConnectionAndCall = new Map<string, typeof sessions[number]>();
    for (const session of sessions) {
      const callSid = twilioCallSid(session.callSessionId);
      if (!callSid) throw evidenceError("linked call identity is incomplete");
      sessionsByConnectionAndCall.set(`${session.connectionId}:${callSid}`, session);
    }
    const providerCallKeys = new Set<string>();
    const facts = [];
    let customerChargeMinor = 0;
    for (const connection of connections) {
      const credential = state.credentials.find((item) => item.connectionId === connection.id);
      const secrets = this.vault.open(credential?.envelope);
      const accountSid = (connection?.externalReference ?? secrets.accountSid)?.trim();
      const authToken = secrets.authToken?.trim();
      if (!accountSid || !authToken) throw evidenceError("connection credentials are incomplete");
      const phoneNumbers = state.phoneNumbers.filter((number) =>
        number.tenantId === input.organizationId
        && number.connectionId === connection.id
        && number.provider === "twilio"
        && number.phoneNumber.trim() !== "");
      if (phoneNumbers.length === 0) {
        throw evidenceError(`connection ${connection.id} has no tenant-owned phone number`);
      }
      for (const { phoneNumber } of phoneNumbers) for (const direction of ["inbound", "outbound"] as const) {
        const providerCalls = await this.calls.listCalls({
          accountSid,
          authToken,
          cycleStartsAt: input.cycleStartsAt,
          cycleEndsAt: input.cycleEndsAt,
          direction,
          phoneNumber,
        });
        for (const call of providerCalls) {
        if (!call.startedAt || !inCycle(call.startedAt, input)) continue;
        const key = `${connection.id}:${call.sid}`;
        const session = sessionsByConnectionAndCall.get(key);
        if (session === undefined) {
          throw evidenceError(`provider call ${call.sid} has no linked tenant session`);
        }
        assertCall(call, { accountSid, callSid: call.sid, direction: session.direction, input });
        if (providerCallKeys.has(key)) continue;
        providerCallKeys.add(key);
        const route = resolveRoute(catalog, session.direction, call.startedAt!);
        const callChargeMinor = Math.ceil(call.durationSeconds! / 60) * route.rate;
        customerChargeMinor += callChargeMinor;
        facts.push({
          id: call.sid,
          callSid: call.sid,
          connectionId: session.connectionId,
          durationSeconds: call.durationSeconds!,
          supplierCostMinor: Math.ceil(Math.abs(Number(call.price)) * 100),
          price: call.price!,
          priceUnit: call.priceUnit!,
          startedAt: call.startedAt!,
          endedAt: call.endedAt!,
          customerChargeMinor: callChargeMinor,
          routeRateId: route.id,
        });
        }
      }
    }
    for (const [key, session] of sessionsByConnectionAndCall) {
      if (!providerCallKeys.has(key)) {
        throw evidenceError(`tenant call ${twilioCallSid(session.callSessionId)} is missing from the provider cycle`);
      }
    }
    facts.sort((left, right) => left.callSid.localeCompare(right.callSid));
    const reportDigest = createHash("sha256").update(JSON.stringify({
      organizationId: input.organizationId,
      cycleStartsAt: input.cycleStartsAt,
      cycleEndsAt: input.cycleEndsAt,
      accounts: connections.map((connection) => connection.externalReference ?? connection.id).sort(),
      callSids: facts.map((fact) => fact.callSid),
    })).digest("hex");
    return {
      provider: "twilio",
      evidenceKind: "telephony_usage",
      sourceReportId: `twilio-calls:${reportDigest}`,
      payload: {
        quantities: { platform_telephony_charge_minor: customerChargeMinor },
        facts,
      },
    };
  }
}

function twilioCallSid(sessionId: string) {
  if (!sessionId.endsWith(":telephony")) return undefined;
  const sid = sessionId.slice(0, -":telephony".length);
  return /^CA[A-Za-z0-9_-]+$/.test(sid) ? sid : undefined;
}

function inCycle(timestamp: string, input: BillingCycleEvidenceInput) {
  const value = Date.parse(timestamp);
  return value >= Date.parse(input.cycleStartsAt) && value < Date.parse(input.cycleEndsAt);
}

function assertCall(
  call: TwilioBillingCallRecord,
  expected: {
    accountSid: string;
    callSid: string;
    direction: "inbound" | "outbound";
    input: BillingCycleEvidenceInput;
  },
) {
  if (call.sid !== expected.callSid || call.accountSid !== expected.accountSid) {
    throw evidenceError("call identity does not match the tenant connection");
  }
  if (call.status !== "completed") throw evidenceError("call is not complete");
  if (!Number.isSafeInteger(call.durationSeconds) || call.durationSeconds! < 0) {
    throw evidenceError("call duration is invalid");
  }
  if (typeof call.price !== "string" || call.price.trim() === ""
    || !Number.isFinite(Number(call.price)) || Number(call.price) > 0) {
    throw evidenceError("call price is invalid");
  }
  const providerDirection = call.direction.toLowerCase();
  if ((expected.direction === "inbound" && providerDirection !== "inbound")
    || (expected.direction === "outbound" && !providerDirection.startsWith("outbound"))) {
    throw evidenceError("call direction does not match the tenant session");
  }
  if (call.priceUnit?.toUpperCase() !== "USD") throw evidenceError("call currency is not USD");
  if (!call.startedAt || !call.endedAt || !inCycle(call.startedAt, expected.input)) {
    throw evidenceError("call time is outside the requested cycle");
  }
  if (!Number.isFinite(Date.parse(call.endedAt)) || Date.parse(call.endedAt) < Date.parse(call.startedAt)) {
    throw evidenceError("call end time is invalid");
  }
}

function resolveRoute(catalog: BillingPriceCatalog, direction: "inbound" | "outbound", occurredAt: string) {
  const routes = catalog.document.telephonyRoutes;
  if (routes === null || typeof routes !== "object" || Array.isArray(routes)) {
    throw evidenceError("catalog telephony routes are unavailable");
  }
  const matches = Object.entries(routes as Record<string, unknown>).flatMap(([id, raw]) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return [];
    const route = raw as Record<string, unknown>;
    const effectiveFrom = Date.parse(String(route.effectiveFrom));
    const effectiveTo = route.effectiveTo === undefined ? Infinity : Date.parse(String(route.effectiveTo));
    if (route.provider !== "twilio" || route.direction !== direction
      || route.currency !== "usd" || route.rounding !== "next_full_minute"
      || Date.parse(occurredAt) < effectiveFrom || Date.parse(occurredAt) >= effectiveTo
      || !Number.isSafeInteger(route.customerRateMinorPerMinute)
      || Number(route.customerRateMinorPerMinute) < 0) return [];
    return [{ id, rate: Number(route.customerRateMinorPerMinute) }];
  });
  if (matches.length !== 1) throw evidenceError("catalog route is missing or ambiguous");
  return matches[0]!;
}

function evidenceError(reason: string) {
  return new Error(`Twilio billing evidence ${reason}.`);
}
