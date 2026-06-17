import { describe, expect, it } from "vitest";
import type { ImportedTelephonyPhoneNumber, PublishedWorkflowVersion } from "@zara/core";

import {
  getCallablePhoneNumberOptions,
  getCallSessionControlOptions,
  getCallerIdPhoneNumberOptions,
  getTenantPublishedWorkflowOptions,
} from "./telephonyCallsPageModel";
import type { TelephonyStateResponse } from "./telephonyApi";

describe("calls page model helpers", () => {
  it("lists published tenant workflows across workspaces for number routing", () => {
    const options = getTenantPublishedWorkflowOptions({
      tenantId: "tenant-west-africa",
      versions: [
        createPublishedWorkflow("workflow-support-v2", "tenant-west-africa", "workspace-customer-success", "Support triage", 2),
        createPublishedWorkflow("workflow-sales-v1", "tenant-west-africa", "workspace-growth", "Sales follow-up", 1),
        createPublishedWorkflow("workflow-other-v1", "tenant-east-africa", "workspace-customer-success", "Other tenant", 1),
      ],
    });

    expect(options.map((option) => option.id)).toEqual([
      "workflow-support-v2",
      "workflow-sales-v1",
    ]);
  });

  it("uses imported voice-capable numbers for inbound tests and caller ID selection", () => {
    const phoneNumbers = [
      createPhoneNumber("+14155557890", "imported", true, true),
      createPhoneNumber("+14156667890", "routed", true, true),
      createPhoneNumber("+14157777890", "disabled", true, true),
      createPhoneNumber("+14158887890", "imported", false, true),
    ];

    expect(getCallablePhoneNumberOptions(phoneNumbers).map((option) => option.value)).toEqual([
      "+14155557890",
      "+14156667890",
    ]);
    expect(getCallerIdPhoneNumberOptions(phoneNumbers).map((option) => option.value)).toEqual([
      "+14155557890",
      "+14156667890",
    ]);
  });

  it("builds live-control sessions from dispatches and persisted execution sessions", () => {
    const state = {
      dispatches: [
        {
          id: "dispatch-inbound",
          direction: "inbound",
          callSessionId: "CA-inbound:telephony",
        },
      ],
      executionSessions: [
        {
          id: "CA-inbound:telephony:execution",
          dispatchId: "dispatch-inbound",
          direction: "inbound",
          callSessionId: "CA-inbound:telephony",
        },
        {
          id: "CA-outbound:telephony:execution",
          dispatchId: "dispatch-outbound",
          direction: "outbound",
          callSessionId: "CA-outbound:telephony",
        },
      ],
    } as TelephonyStateResponse;

    expect(getCallSessionControlOptions(state)).toEqual([
      {
        callSessionId: "CA-inbound:telephony",
        dispatchId: "dispatch-inbound",
        label: "inbound - CA-inbound:telephony",
      },
      {
        callSessionId: "CA-outbound:telephony",
        dispatchId: "dispatch-outbound",
        label: "outbound - CA-outbound:telephony",
      },
    ]);
  });
});

function createPublishedWorkflow(
  id: string,
  tenantId: string,
  workspaceId: string,
  name: string,
  version: number,
): PublishedWorkflowVersion {
  return {
    id,
    tenantId,
    workspaceId,
    version,
    graph: {
      id: id.replace(/-v\d+$/, ""),
      name,
      version: 1,
      nodes: [],
      edges: [],
    },
    manifestPreview: {
      workflowId: id.replace(/-v\d+$/, ""),
      runtimeProfile: "cost-optimized",
    },
  } as unknown as PublishedWorkflowVersion;
}

function createPhoneNumber(
  phoneNumber: string,
  status: ImportedTelephonyPhoneNumber["status"],
  voiceCapable: boolean,
  callerIdEligible: boolean,
): ImportedTelephonyPhoneNumber {
  return {
    id: `phone-${phoneNumber.replace(/\D+/g, "")}`,
    tenantId: "tenant-west-africa",
    connectionId: "connection-twilio",
    provider: "twilio",
    provisionSource: "provider-import",
    externalNumberId: `PN${phoneNumber.replace(/\D+/g, "")}`,
    phoneNumber,
    friendlyName: phoneNumber,
    voiceCapable,
    callerIdEligible,
    status,
    webhookStatus: "pending",
  };
}
