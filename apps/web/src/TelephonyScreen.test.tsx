/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAgentRoleNode,
  createWorkflowGraph,
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
  publishWorkflowVersion,
  type ImportedTelephonyPhoneNumber,
  type PublishedWorkflowVersion,
} from "@zara/core";

import { TelephonyScreen } from "./TelephonyScreen";
import { savePublishedWorkflowVersion } from "./workflowSandboxRegistry";
import type { TelephonyStateResponse } from "./telephonyApi";

const telephonyApiMock = vi.hoisted(() => ({
  activateTelephonyLiveRouteViaApi: vi.fn(),
  assignTelephonyRouteViaApi: vi.fn(),
  createPlatformManagedConnectionViaApi: vi.fn(),
  createSipConnectionViaApi: vi.fn(),
  createTwilioConnectionViaApi: vi.fn(),
  deleteTelephonyConnectionViaApi: vi.fn(),
  dispatchInboundTelephonyTestViaApi: vi.fn(),
  dispatchOutboundTelephonyCallViaApi: vi.fn(),
  fetchTelephonyState: vi.fn(),
  importTwilioNumbersViaApi: vi.fn(),
  pauseTelephonyLiveRouteViaApi: vi.fn(),
  recordTelephonyCallControlEventViaApi: vi.fn(),
  registerTelephonyNumberViaApi: vi.fn(),
  resumeTelephonyLiveRouteViaApi: vi.fn(),
  rotateTelephonyCredentialsViaApi: vi.fn(),
  runTelephonyHeartbeatViaApi: vi.fn(),
  runTelephonyLoopbackTestViaApi: vi.fn(),
  validateTelephonyConnectionViaApi: vi.fn(),
  validateTwilioCredentialsViaApi: vi.fn(),
}));

vi.mock("./telephonyApi", () => telephonyApiMock);

describe("TelephonyScreen", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads saved workflows for the active organization and saves imported-number routes there", async () => {
    const organizationId = "tenant-custom-voice";
    const workflow = seedPublishedWorkflow({
      organizationId,
      workspaceId: DEFAULT_WORKSPACE_ID,
      name: "Custom support workflow",
    });
    const phoneNumber = createImportedPhoneNumber(organizationId);
    const initialState = createTelephonyState(organizationId, [phoneNumber]);
    const routedState = createTelephonyState(organizationId, [
      {
        ...phoneNumber,
        status: "routed",
        webhookStatus: "configured",
        liveRoute: {
          mode: "live_route",
          publishedVersionId: workflow.id,
          workflowLabel: workflow.graph.name,
          workspaceId: DEFAULT_WORKSPACE_ID,
          runtimeProfile: "cost-optimized",
          createdAt: "2026-06-22T14:00:00.000Z",
          activationStatus: "pending_activation",
        },
      },
    ]);

    telephonyApiMock.fetchTelephonyState.mockResolvedValue(initialState);
    telephonyApiMock.assignTelephonyRouteViaApi.mockResolvedValue({ state: routedState });

    renderTelephonyScreen({ organizationId });

    const routeSelect = await screen.findByLabelText<HTMLSelectElement>("Workflow route for +14155557890");
    expect(Array.from(routeSelect.options).map((option) => option.textContent)).toContain("Custom support workflow");

    fireEvent.change(routeSelect, {
      target: { value: workflow.id },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save route for +14155557890" }));

    await waitFor(() =>
      expect(telephonyApiMock.assignTelephonyRouteViaApi).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId,
          numberId: phoneNumber.id,
          publishedVersionId: workflow.id,
          workflowLabel: "Custom support workflow",
          workspaceId: DEFAULT_WORKSPACE_ID,
          runtimeProfile: "cost-optimized",
        }),
      ),
    );
  });

  it("shows operation feedback while SIP provider changes are in flight", async () => {
    const organizationId = "tenant-custom-voice";
    telephonyApiMock.fetchTelephonyState.mockResolvedValue(createTelephonyState(organizationId, []));
    telephonyApiMock.createSipConnectionViaApi.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ state: createTelephonyState(organizationId, []) }), 25);
        }),
    );

    renderTelephonyScreen({ organizationId });

    await screen.findByText("Providers");
    fireEvent.click(screen.getByRole("button", { name: "Connect SIP" }));
    fireEvent.change(screen.getByLabelText("Secret"), {
      target: { value: "sip-secret-value" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit SIP connection" }));

    const busyButton = screen.getByRole<HTMLButtonElement>("button", { name: "Submit SIP connection" });
    expect(busyButton.disabled).toBe(true);
    expect(busyButton.getAttribute("aria-busy")).toBe("true");
  });

  it("renders the approved provider setup surface and opens the Twilio credential dialog", async () => {
    const organizationId = "tenant-custom-voice";
    telephonyApiMock.fetchTelephonyState.mockResolvedValue(createTelephonyState(organizationId, []));

    renderTelephonyScreen({ organizationId });

    expect(await screen.findByText("Providers")).toBeTruthy();
    expect(screen.getByText("Active connections")).toBeTruthy();
    expect(screen.getByText("Routed numbers")).toBeTruthy();
    expect(screen.getByText("Live routes")).toBeTruthy();
    expect(screen.getByText("Recent calls")).toBeTruthy();
    expect(screen.getByText("Twilio")).toBeTruthy();
    expect(screen.getByText("SIP")).toBeTruthy();
    expect(screen.queryByText("Platform edge")).toBeNull();
    expect(screen.queryByText("Provider posture")).toBeNull();
    expect(screen.queryByText("Outbound call")).toBeNull();

    const connectTwilioButton = screen.getByRole("button", { name: "Connect Twilio" });
    expect(connectTwilioButton.className).toContain("telephony-provider-connect-bordered");
    fireEvent.click(connectTwilioButton);

    expect(screen.getByRole("dialog", { name: "Connect Twilio" })).toBeTruthy();
    expect(screen.getByLabelText("Connection name")).toBeTruthy();
    expect(screen.getByLabelText("Account SID")).toBeTruthy();
    expect(screen.getByLabelText("Auth token")).toBeTruthy();
    expect(screen.getByLabelText("Region")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Validate and connect" })).toBeTruthy();
  });

  it("keeps heartbeat and number import actions on configured Twilio connections", async () => {
    const organizationId = "tenant-custom-voice";
    const state = createTelephonyState(organizationId, []);
    telephonyApiMock.fetchTelephonyState.mockResolvedValue({
      ...state,
      connections: [
        {
          id: "connection-twilio",
          tenantId: organizationId,
          label: "Tenant Twilio account",
          ownershipMode: "byo_provider_account",
          provider: "twilio",
          region: "us1",
          status: "active",
          healthStatus: "healthy",
          recordingPolicy: {
            enabled: true,
            consentMode: "single-party",
            consentMessage: "This call may be recorded for quality assurance.",
          },
          blockRoutingOnHealthFailure: true,
          credentialReference: {
            id: "connection-twilio:cred",
            provider: "twilio",
            keyVersion: 1,
            preview: "****oken",
          },
          externalReference: "test-account-sid",
          webhookBaseUrl: "https://api.zharaai.com/telephony/webhooks/twilio",
          webhookStatus: "configured",
          createdBy: "user-custom-ops",
        },
      ],
    });

    renderTelephonyScreen({ organizationId });

    expect(await screen.findByRole("button", { name: "Run heartbeat" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import phone numbers" })).toBeTruthy();
  });
});

function renderTelephonyScreen(input: { organizationId: string }) {
  return render(
    <MemoryRouter>
      <TelephonyScreen
        activeActorUserId="user-custom-ops"
        activeWorkspaceId={DEFAULT_WORKSPACE_ID}
        organizationId={input.organizationId}
        showToast={vi.fn()}
        workspaces={[
          {
            id: DEFAULT_WORKSPACE_ID,
            tenantId: input.organizationId,
            name: DEFAULT_WORKSPACE_NAME,
            slug: "default",
            status: "active",
            createdAt: "2026-06-22T12:00:00.000Z",
            createdBy: "user-custom-ops",
          },
        ]}
      />
    </MemoryRouter>,
  );
}

function seedPublishedWorkflow(input: {
  organizationId: string;
  workspaceId: string;
  name: string;
}): PublishedWorkflowVersion {
  const graph = createWorkflowGraph({
    id: "workflow-custom-support",
    name: input.name,
    nodes: [
      {
        id: "entry",
        kind: "entry",
        label: "Inbound call",
        position: { x: 0, y: 80 },
        config: { channel: "phone" },
      },
      createAgentRoleNode({
        id: "agent-support",
        label: "Support",
        position: { x: 240, y: 80 },
        role: {
          kind: "support",
          name: "Support",
          businessName: "Zara",
          instructions: "Help callers with support requests.",
          defaultModelTier: "cheap",
          languagePolicy: {
            defaultLanguage: "en",
            supportedLanguages: ["en"],
            allowMidCallSwitching: false,
          },
        },
      }),
    ],
    edges: [
      {
        id: "entry-to-support",
        sourceNodeId: "entry",
        targetNodeId: "agent-support",
      },
    ],
  });
  const publishedVersion = publishWorkflowVersion({
    workflowId: "workflow-custom-support",
    tenantId: input.organizationId,
    workspaceId: input.workspaceId,
    environment: "production",
    createdBy: "user-custom-ops",
    createdAt: "2026-06-22T12:30:00.000Z",
    graph,
    existingVersions: [],
    runtime: "sandwich-pipeline",
    runtimeProfile: "cost-optimized",
    telephonyProvider: "browser-webrtc",
    memory: {
      mode: "scoped",
      retrievalScopes: ["session"],
      approvalRequired: true,
    },
    budget: {
      monthlyCapUsd: 80,
      currentSpendUsd: 0,
      projectedCostPerMinuteUsd: 0.18,
      blockOnLimit: true,
    },
  });

  savePublishedWorkflowVersion(publishedVersion);
  return publishedVersion;
}

function createImportedPhoneNumber(organizationId: string): ImportedTelephonyPhoneNumber {
  return {
    id: "phone-number-pn-support-7890",
    tenantId: organizationId,
    connectionId: "connection-twilio",
    provider: "twilio",
    provisionSource: "provider-import",
    externalNumberId: "PN78901001",
    phoneNumber: "+14155557890",
    friendlyName: "Support line",
    voiceCapable: true,
    callerIdEligible: true,
    status: "imported",
    webhookStatus: "pending",
  };
}

function createTelephonyState(
  organizationId: string,
  phoneNumbers: ImportedTelephonyPhoneNumber[],
): TelephonyStateResponse {
  return {
    callControlEvents: [],
    connections: [],
    dispatches: [],
    executionCommands: [],
    executionSessions: [],
    healthChecks: [],
    organizationId,
    phoneNumbers,
    providerHeartbeats: [],
    webhookEvents: [],
  };
}
