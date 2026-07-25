import { MODULE_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";

import { PUBLISHED_WORKFLOW_MANIFEST_REPOSITORY } from "./published-workflow-manifest.repository";
import { PublishedWorkflowManifestReadModule } from "./published-workflow-manifest-read.module";

describe("PublishedWorkflowManifestReadModule", () => {
  it("exports durable manifest reads without workflow controllers", () => {
    expect(
      Reflect.getMetadata(
        MODULE_METADATA.CONTROLLERS,
        PublishedWorkflowManifestReadModule,
      ),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(
        MODULE_METADATA.EXPORTS,
        PublishedWorkflowManifestReadModule,
      ),
    ).toContain(PUBLISHED_WORKFLOW_MANIFEST_REPOSITORY);
  });
});
