import { Inject, Injectable } from "@nestjs/common";

import type { CompiledRuntimeManifest } from "@zara/core";

import type { PremiumRealtimeConversationPolicy } from "../premium-realtime-policy/premium-realtime-conversation-policy.models";
import { PremiumRealtimeConversationPolicyService } from "../premium-realtime-policy/premium-realtime-conversation-policy.service";
import { applyRuntimePromptPolicyModelDefaultsToManifest } from "../runtime-prompt-policy/runtime-prompt-policy.model-defaults";
import { RuntimePromptPolicyService } from "../runtime-prompt-policy/runtime-prompt-policy.service";
import {
  PUBLISHED_WORKFLOW_MANIFEST_REPOSITORY,
  type PublishedWorkflowManifestRepository,
} from "../workflows/published-workflow-manifest.repository";

export interface PremiumPstnDispatchSnapshotResolution {
  resolvedManifest: CompiledRuntimeManifest;
  resolvedConversationPolicy: PremiumRealtimeConversationPolicy;
}

@Injectable()
export class PremiumPstnDispatchSnapshotResolver {
  constructor(
    @Inject(PUBLISHED_WORKFLOW_MANIFEST_REPOSITORY)
    private readonly manifestRepository: Pick<
      PublishedWorkflowManifestRepository,
      "load"
    >,
    @Inject(RuntimePromptPolicyService)
    private readonly promptPolicyService: Pick<
      RuntimePromptPolicyService,
      "getPromptPolicy"
    >,
    @Inject(PremiumRealtimeConversationPolicyService)
    private readonly conversationPolicyService: Pick<
      PremiumRealtimeConversationPolicyService,
      "getPolicy"
    >,
  ) {}

  async resolve(input: {
    organizationId: string;
    workspaceId: string;
    publishedVersionId: string;
  }): Promise<PremiumPstnDispatchSnapshotResolution> {
    const manifest = await this.manifestRepository.load({
      organizationId: input.organizationId,
      publishedVersionId: input.publishedVersionId,
    });
    if (
      manifest === null
      || manifest.tenantId !== input.organizationId
      || manifest.workspaceId !== input.workspaceId
      || manifest.publishedVersionId !== input.publishedVersionId
      || manifest.runtimeProfile !== "premium-realtime"
      || manifest.entryAgentId === undefined
    ) {
      throw new PremiumPstnDispatchSnapshotResolutionError(
        "premium_dispatch_snapshot_manifest_unavailable",
        "The exact premium workflow manifest is unavailable.",
      );
    }

    const [promptPolicy, conversationPolicy] = await Promise.all([
      this.promptPolicyService.getPromptPolicy(),
      this.conversationPolicyService.getPolicy(),
    ]);
    return {
      resolvedManifest: structuredClone(
        applyRuntimePromptPolicyModelDefaultsToManifest(
          manifest,
          promptPolicy,
        ),
      ),
      resolvedConversationPolicy: structuredClone(conversationPolicy),
    };
  }
}

export class PremiumPstnDispatchSnapshotResolutionError extends Error {
  constructor(
    readonly code: "premium_dispatch_snapshot_manifest_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "PremiumPstnDispatchSnapshotResolutionError";
  }
}
