import type { ImportedTelephonyPhoneNumber, PublishedWorkflowVersion } from "@zara/core";

import type { TelephonyStateResponse } from "./telephonyApi";

export interface TelephonySelectOption {
  id: string;
  value: string;
  label: string;
}

export interface CallSessionControlOption {
  callSessionId: string;
  dispatchId: string;
  label: string;
}

export function getTenantPublishedWorkflowOptions(input: {
  tenantId: string;
  versions: PublishedWorkflowVersion[];
}): PublishedWorkflowVersion[] {
  return input.versions.filter((version) => version.tenantId === input.tenantId);
}

export function getCallablePhoneNumberOptions(
  phoneNumbers: ImportedTelephonyPhoneNumber[],
): TelephonySelectOption[] {
  return phoneNumbers
    .filter((phoneNumber) => phoneNumber.status !== "disabled" && phoneNumber.voiceCapable)
    .map(toPhoneNumberOption);
}

export function getCallerIdPhoneNumberOptions(
  phoneNumbers: ImportedTelephonyPhoneNumber[],
): TelephonySelectOption[] {
  return phoneNumbers
    .filter(
      (phoneNumber) =>
        phoneNumber.status !== "disabled" &&
        phoneNumber.voiceCapable &&
        phoneNumber.callerIdEligible,
    )
    .map(toPhoneNumberOption);
}

export function getCallSessionControlOptions(
  state: Pick<TelephonyStateResponse, "dispatches" | "executionSessions">,
): CallSessionControlOption[] {
  const options: CallSessionControlOption[] = [];
  const seenCallSessions = new Set<string>();

  for (const dispatch of state.dispatches) {
    if (dispatch.callSessionId === undefined) {
      continue;
    }

    options.push({
      callSessionId: dispatch.callSessionId,
      dispatchId: dispatch.id,
      label: `${dispatch.direction} - ${dispatch.callSessionId}`,
    });
    seenCallSessions.add(dispatch.callSessionId);
  }

  for (const session of state.executionSessions ?? []) {
    if (session.callSessionId === undefined || seenCallSessions.has(session.callSessionId)) {
      continue;
    }

    options.push({
      callSessionId: session.callSessionId,
      dispatchId: session.dispatchId,
      label: `${session.direction} - ${session.callSessionId}`,
    });
    seenCallSessions.add(session.callSessionId);
  }

  return options;
}

function toPhoneNumberOption(phoneNumber: ImportedTelephonyPhoneNumber): TelephonySelectOption {
  return {
    id: phoneNumber.id,
    value: phoneNumber.phoneNumber,
    label: phoneNumber.phoneNumber,
  };
}
