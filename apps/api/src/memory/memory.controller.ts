import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";

import type {
  ApproveMemoryDraftRequest,
  ApproveKnowledgeReviewDraftRequest,
  CreateKnowledgeIngestionRequest,
  CreateKnowledgeSourceRequest,
  CreateMemoryRecordRequest,
  CreateTenantKnowledgeRequest,
  DeleteMemoryRecordRequest,
  DeleteTenantMemoryDataRequest,
  ExtractMemoryDraftsRequest,
  PurgeMemoryRetentionRequest,
  RejectMemoryDraftRequest,
  RetryKnowledgeIngestionRequest,
  RetrieveMemoryRequest,
  UpdateMemoryRecordRequest,
} from "./memory.models";
import { MemoryService } from "./memory.service";

@Controller("organizations/:organizationId/memory")
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  @Post()
  async createMemory(
    @Param("organizationId") organizationId: string,
    @Body() body: CreateMemoryRecordRequest,
  ) {
    const memoryOrDraft = await this.memoryService.createMemory(organizationId, body);

    if (memoryOrDraft.status === "draft") {
      return {
        draft: memoryOrDraft,
      };
    }

    return {
      memory: memoryOrDraft,
    };
  }

  @Post("knowledge")
  async createTenantKnowledge(
    @Param("organizationId") organizationId: string,
    @Body() body: CreateTenantKnowledgeRequest,
  ) {
    return {
      knowledge: await this.memoryService.createTenantKnowledge(organizationId, body),
    };
  }

  @Post("knowledge/sources")
  async createKnowledgeSource(
    @Param("organizationId") organizationId: string,
    @Body() body: CreateKnowledgeSourceRequest,
  ) {
    return this.memoryService.createKnowledgeSource(organizationId, body);
  }

  @Post("knowledge/review-drafts/:draftId/approve")
  async approveKnowledgeReviewDraft(
    @Param("organizationId") organizationId: string,
    @Param("draftId") draftId: string,
    @Body() body: ApproveKnowledgeReviewDraftRequest,
  ) {
    return this.memoryService.approveKnowledgeReviewDraft(organizationId, draftId, body);
  }

  @Post("knowledge/ingestions")
  async createKnowledgeIngestion(
    @Param("organizationId") organizationId: string,
    @Body() body: CreateKnowledgeIngestionRequest,
  ) {
    return {
      ingestion: await this.memoryService.createKnowledgeIngestion(organizationId, body),
    };
  }

  @Get("knowledge/ingestions/:ingestionId")
  async getKnowledgeIngestion(
    @Param("organizationId") organizationId: string,
    @Param("ingestionId") ingestionId: string,
  ) {
    return {
      ingestion: await this.memoryService.getKnowledgeIngestion(organizationId, ingestionId),
    };
  }

  @Post("knowledge/ingestions/:ingestionId/retry")
  async retryKnowledgeIngestion(
    @Param("organizationId") organizationId: string,
    @Param("ingestionId") ingestionId: string,
    @Body() body: RetryKnowledgeIngestionRequest,
  ) {
    return {
      ingestion: await this.memoryService.retryKnowledgeIngestion(organizationId, ingestionId, body),
    };
  }

  @Post("retention/purge")
  @HttpCode(200)
  async purgeRetention(
    @Param("organizationId") organizationId: string,
    @Body() body: PurgeMemoryRetentionRequest,
  ) {
    return {
      retention: await this.memoryService.purgeRetention(organizationId, body),
    };
  }

  @Get("export")
  async exportTenantMemory(@Param("organizationId") organizationId: string) {
    return {
      export: await this.memoryService.exportTenantMemory(organizationId),
    };
  }

  @Delete("tenant-data")
  @HttpCode(200)
  async deleteTenantMemoryData(
    @Param("organizationId") organizationId: string,
    @Body() body: DeleteTenantMemoryDataRequest,
  ) {
    return {
      deletion: await this.memoryService.deleteTenantMemoryData(organizationId, body),
    };
  }

  @Post("retrieve")
  @HttpCode(200)
  async retrieveByEmbedding(
    @Param("organizationId") organizationId: string,
    @Body() body: RetrieveMemoryRequest,
  ) {
    return {
      matches: await this.memoryService.retrieveByEmbedding(organizationId, body),
    };
  }

  @Post("extract")
  async extractMemoryDrafts(
    @Param("organizationId") organizationId: string,
    @Body() body: ExtractMemoryDraftsRequest,
  ) {
    return this.memoryService.extractMemoryDrafts(organizationId, body);
  }

  @Post("drafts/:draftId/approve")
  async approveMemoryDraft(
    @Param("organizationId") organizationId: string,
    @Param("draftId") draftId: string,
    @Body() body: ApproveMemoryDraftRequest,
  ) {
    return this.memoryService.approveMemoryDraft(organizationId, draftId, body);
  }

  @Post("drafts/:draftId/reject")
  @HttpCode(200)
  async rejectMemoryDraft(
    @Param("organizationId") organizationId: string,
    @Param("draftId") draftId: string,
    @Body() body: RejectMemoryDraftRequest,
  ) {
    return {
      draft: await this.memoryService.rejectMemoryDraft(organizationId, draftId, body),
    };
  }

  @Patch(":memoryId")
  async updateMemory(
    @Param("organizationId") organizationId: string,
    @Param("memoryId") memoryId: string,
    @Body() body: UpdateMemoryRecordRequest,
  ) {
    return {
      memory: await this.memoryService.updateMemory(organizationId, memoryId, body),
    };
  }

  @Delete(":memoryId")
  @HttpCode(200)
  async deleteMemory(
    @Param("organizationId") organizationId: string,
    @Param("memoryId") memoryId: string,
    @Body() body: DeleteMemoryRecordRequest,
  ) {
    return {
      memory: await this.memoryService.deleteMemory(organizationId, memoryId, body),
    };
  }

  @Get("knowledge")
  async retrieveTenantKnowledge(
    @Param("organizationId") organizationId: string,
    @Query("publishedWorkflowVersionId") publishedWorkflowVersionId?: string | undefined,
    @Query("workspaceId") workspaceId?: string | undefined,
    @Query("workflowId") workflowId?: string | undefined,
    @Query("now") now?: string | undefined,
  ) {
    return {
      knowledge: await this.memoryService.retrieveTenantKnowledge({
        organizationId,
        ...(publishedWorkflowVersionId !== undefined ? { publishedWorkflowVersionId } : {}),
        ...(workspaceId !== undefined ? { workspaceId } : {}),
        ...(workflowId !== undefined ? { workflowId } : {}),
        ...(now !== undefined ? { now } : {}),
      }),
    };
  }

  @Get()
  async retrieveMemories(
    @Param("organizationId") organizationId: string,
    @Query("callerKind") callerKind?: "phone" | "email" | "external_id" | undefined,
    @Query("callerValue") callerValue?: string | undefined,
    @Query("accountId") accountId?: string | undefined,
  ) {
    return {
      memories:
        callerKind === undefined || callerValue === undefined
          ? []
          : await this.memoryService.retrieveMemories({
              organizationId,
              callerIdentity: {
                kind: callerKind,
                value: callerValue,
              },
              ...(accountId !== undefined ? { accountId } : {}),
            }),
    };
  }
}
