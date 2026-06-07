import { describe, expect, it } from "vitest";

import {
  classifyLiveSandboxToolExecutionFailure,
  isLiveSandboxSideEffectTool,
} from "./sandbox-live-tool-failures";

describe("live sandbox tool failure classification", () => {
  it.each([
    [
      Object.assign(new Error("Integration connection has been revoked token=raw-secret"), {
        code: "integration_connection_revoked",
      }),
      "tool_execution.auth_revoked",
      "Tool 'Billing lookup' cannot run because credentials were revoked.",
    ],
    [
      Object.assign(new Error("Provider returned HTTP 403 missing scope"), { statusCode: 403 }),
      "tool_execution.permission_denied",
      "Tool 'Billing lookup' cannot run because permission was denied.",
    ],
    [
      Object.assign(new Error("Provider returned HTTP 404"), { statusCode: 404 }),
      "tool_execution.not_found",
      "Tool 'Billing lookup' could not find the requested record.",
    ],
    [
      Object.assign(new Error("HTTP 429 rate limit"), { statusCode: 429 }),
      "tool_execution.rate_limited",
      "Tool 'Billing lookup' was rate limited.",
    ],
    [
      Object.assign(new Error("Provider service unavailable"), { statusCode: 503 }),
      "tool_execution.provider_unavailable",
      "Tool 'Billing lookup' provider is unavailable.",
    ],
    [
      Object.assign(new Error("Request timed out"), { statusCode: 504 }),
      "tool_execution.timeout",
      "Tool 'Billing lookup' timed out.",
    ],
    [
      Object.assign(new Error("Validation failed for provider payload"), { statusCode: 400 }),
      "tool_execution.validation_error",
      "Tool 'Billing lookup' received invalid input or provider payload.",
    ],
  ])("maps provider failures to safe runtime code %s", (error, code, summary) => {
    const failure = classifyLiveSandboxToolExecutionFailure(error, "Billing lookup");

    expect(failure).toMatchObject({
      code,
      summary,
    });
    expect(failure.message).not.toContain("raw-secret");
  });

  it("marks post-send write timeouts as unknown outcomes", () => {
    const error = Object.assign(new Error("Zendesk timeout after request send"), {
      sideEffectRequestSent: true,
    });

    expect(classifyLiveSandboxToolExecutionFailure(error, "Create ticket")).toMatchObject({
      code: "tool_execution.side_effect_unknown",
      summary: "Tool 'Create ticket' has an unknown provider write outcome.",
      message: "The provider write may have completed before the request timed out.",
    });
  });

  it("limits side-effect ledger detection to write-like tool ids", () => {
    expect(isLiveSandboxSideEffectTool("zendesk.tickets.create")).toBe(true);
    expect(isLiveSandboxSideEffectTool("hubspot.notes.create")).toBe(true);
    expect(isLiveSandboxSideEffectTool("google.calendar.events.create")).toBe(true);
    expect(isLiveSandboxSideEffectTool("microsoft365.calendar.events.create")).toBe(true);
    expect(isLiveSandboxSideEffectTool("salesforce.tasks.create")).toBe(true);
    expect(isLiveSandboxSideEffectTool("salesforce.cases.create")).toBe(true);
    expect(isLiveSandboxSideEffectTool("salesforce.call_notes.create")).toBe(true);
    expect(isLiveSandboxSideEffectTool("slack.escalations.post")).toBe(true);
    expect(isLiveSandboxSideEffectTool("slack.alerts.post")).toBe(true);
    expect(isLiveSandboxSideEffectTool("slack.call_summaries.post")).toBe(true);
    expect(isLiveSandboxSideEffectTool("zendesk.tickets.search")).toBe(false);
    expect(isLiveSandboxSideEffectTool("hubspot.contacts.lookup")).toBe(false);
    expect(isLiveSandboxSideEffectTool("microsoft365.calendar.availability.read")).toBe(false);
    expect(isLiveSandboxSideEffectTool("salesforce.accounts.lookup")).toBe(false);
    expect(isLiveSandboxSideEffectTool("slack.channels.history")).toBe(false);
  });
});
