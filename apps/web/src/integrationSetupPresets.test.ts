import { describe, expect, it } from "vitest";
import { getIntegrationProviderCatalog } from "@zara/core";

import {
  createCopyableIntegrationSetupTemplate,
  createIntegrationSetupCopyPreview,
  createIntegrationSetupPresetPreviews,
} from "./integrationSetupPresets";

describe("integration setup presets", () => {
  it("previews support, sales, and ecommerce setup presets before saving", () => {
    const previews = createIntegrationSetupPresetPreviews(getIntegrationProviderCatalog());

    expect(previews.map((preview) => preview.id)).toEqual(["support", "sales", "ecommerce"]);

    const support = previews.find((preview) => preview.id === "support");
    const sales = previews.find((preview) => preview.id === "sales");
    const ecommerce = previews.find((preview) => preview.id === "ecommerce");

    expect(support?.capabilityIntents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "agent-tool",
          providerId: "zendesk",
          toolId: "zendesk.tickets.create",
          approvalRequired: true,
        }),
        expect.objectContaining({
          capability: "knowledge-source",
          providerId: "zendesk",
          modes: ["snapshot-import", "recurring-sync"],
        }),
        expect.objectContaining({
          capability: "post-call-sync",
          providerId: "hubspot",
          approvalRequired: true,
        }),
      ]),
    );
    expect(sales?.capabilityIntents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "agent-tool",
          providerId: "hubspot",
          toolId: "hubspot.pipeline.update",
          approvalRequired: true,
        }),
        expect.objectContaining({
          capability: "post-call-sync",
          providerId: "hubspot",
          approvalRequired: true,
        }),
      ]),
    );
    expect(ecommerce?.capabilityIntents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "agent-tool",
          providerId: "zendesk",
          toolId: "zendesk.tickets.search",
          approvalRequired: false,
        }),
        expect.objectContaining({
          capability: "knowledge-source",
          providerId: "notion",
        }),
        expect.objectContaining({
          capability: "post-call-sync",
          providerId: "hubspot",
          approvalRequired: true,
        }),
      ]),
    );
  });

  it("does not preview post-call sync for providers without a catalog capability", () => {
    const catalogWithoutHubspotSync = getIntegrationProviderCatalog().map((provider) =>
      provider.id === "hubspot"
        ? {
            ...provider,
            capabilities: provider.capabilities.filter((capability) => capability !== "post-call-sync"),
          }
        : provider,
    );

    const previews = createIntegrationSetupPresetPreviews(catalogWithoutHubspotSync);

    for (const preview of previews) {
      expect(preview.capabilityIntents).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            capability: "post-call-sync",
            providerId: "hubspot",
          }),
        ]),
      );
    }
  });

  it("creates copyable templates without credentials, OAuth grants, or workspace-owned source access", () => {
    const support = createIntegrationSetupPresetPreviews(getIntegrationProviderCatalog()).find(
      (preview) => preview.id === "support",
    );

    if (support === undefined) {
      throw new Error("Expected support setup preset to be previewable.");
    }

    const template = createCopyableIntegrationSetupTemplate(support);

    expect(template).toMatchObject({
      presetId: "support",
      requiredTargetSelections: [
        "target-workspace",
        "provider-connection",
        "capability-grant",
        "knowledge-source-category",
        "risky-write-confirmation",
      ],
    });
    expect(template.capabilityIntents).toEqual(support.capabilityIntents);

    const serializedTemplate = JSON.stringify(template);
    expect(serializedTemplate).not.toMatch(
      /credential|oauth|token|secret|integrationConnectionId|connectionId|grantId|sourceId|sourceWorkspaceId|workspaceOwnedSourceAccess/i,
    );
  });

  it("creates a display-ready setup copy preview without cloning sensitive setup references", () => {
    const support = createIntegrationSetupPresetPreviews(getIntegrationProviderCatalog()).find(
      (preview) => preview.id === "support",
    );

    if (support === undefined) {
      throw new Error("Expected support setup preset to be previewable.");
    }

    const unsafeTemplate = {
      ...createCopyableIntegrationSetupTemplate(support),
      credentialReference: "credential-ref-should-not-copy",
      oauthGrantId: "oauth-grant-should-not-copy",
      connectionId: "connection-should-not-copy",
      grantId: "grant-should-not-copy",
      sourceId: "source-should-not-copy",
      workspaceOwnedSourceAccess: "workspace-source-access-should-not-copy",
    };

    const copyPreview = createIntegrationSetupCopyPreview(unsafeTemplate, getIntegrationProviderCatalog());

    expect(copyPreview).toMatchObject({
      presetId: "support",
      title: "Copy Support agent setup",
      recommendedConnectionScopeLabel: "Use only in this workspace",
      requiredSelections: [
        { id: "target-workspace", label: "Choose target workspace" },
        { id: "provider-connection", label: "Select provider connection" },
        { id: "capability-grant", label: "Review capability grants" },
        { id: "knowledge-source-category", label: "Choose source categories" },
        { id: "risky-write-confirmation", label: "Confirm risky write tools" },
      ],
      notClonedItems: [
        "Credentials",
        "OAuth grants",
        "Connection IDs",
        "Grant IDs",
        "Source IDs",
        "Workspace-owned source access",
      ],
    });
    expect(copyPreview.capabilityRows).toEqual(
      expect.arrayContaining([
        {
          title: "Zendesk - Create ticket",
          detail: "Agent tool",
          approvalLabel: "Approval required",
        },
        {
          title: "Zendesk knowledge source",
          detail: "Snapshot import and recurring sync",
          approvalLabel: "Approval required",
        },
        {
          title: "HubSpot call summary sync",
          detail: "Post-call sync",
          approvalLabel: "Approval required",
        },
      ]),
    );

    expect(JSON.stringify(copyPreview)).not.toContain("credential-ref-should-not-copy");
    expect(JSON.stringify(copyPreview)).not.toContain("oauth-grant-should-not-copy");
    expect(JSON.stringify(copyPreview)).not.toContain("connection-should-not-copy");
    expect(JSON.stringify(copyPreview)).not.toContain("grant-should-not-copy");
    expect(JSON.stringify(copyPreview)).not.toContain("source-should-not-copy");
    expect(JSON.stringify(copyPreview)).not.toContain("workspace-source-access-should-not-copy");
  });
});
