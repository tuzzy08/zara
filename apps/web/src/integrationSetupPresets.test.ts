import { describe, expect, it } from "vitest";
import { getIntegrationProviderCatalog } from "@zara/core";

import {
  createCopyableIntegrationSetupTemplate,
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
});
