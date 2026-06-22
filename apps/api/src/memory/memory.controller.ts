import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";

import {
  TenantAuth,
  type TenantAuthContext,
  TenantOrganizationGuard,
  withTenantActor,
} from "../auth/tenant-auth";
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
  RefreshKnowledgeSourceRequest,
  RetryKnowledgeIngestionRequest,
  RetrieveMemoryRequest,
  UpdateMemoryRecordRequest,
} from "./memory.models";
import { MemoryService } from "./memory.service";

@Controller("organizations/:organizationId/memory")
@UseGuards(TenantOrganizationGuard)
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  @Post()
  async createMemory(
    @Param("organizationId") organizationId: string,
    @Body() body: CreateMemoryRecordRequest,
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    const memoryOrDraft = await this.memoryService.createMemory(organizationId, withTenantActor(body, tenantAuth));

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
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      knowledge: await this.memoryService.createTenantKnowledge(organizationId, withTenantActor(body, tenantAuth)),
    };
  }

  @Post("knowledge/sources")
  async createKnowledgeSource(
    @Param("organizationId") organizationId: string,
    @Body() body: CreateKnowledgeSourceRequest,
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return this.memoryService.createKnowledgeSource(organizationId, withTenantActor(body, tenantAuth));
  }

  @Post("knowledge/sources/:sourceId/refresh")
  async refreshKnowledgeSource(
    @Param("organizationId") organizationId: string,
    @Param("sourceId") sourceId: string,
    @Body() body: RefreshKnowledgeSourceRequest,
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return this.memoryService.refreshKnowledgeSource(organizationId, sourceId, withTenantActor(body, tenantAuth));
  }

  @Post("knowledge/review-drafts/:draftId/approve")
  async approveKnowledgeReviewDraft(
    @Param("organizationId") organizationId: string,
    @Param("draftId") draftId: string,
    @Body() body: ApproveKnowledgeReviewDraftRequest,
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return this.memoryService.approveKnowledgeReviewDraft(organizationId, draftId, withTenantActor(body, tenantAuth));
  }

  @Post("knowledge/ingestions")
  async createKnowledgeIngestion(
    @Param("organizationId") organizationId: string,
    @Body() body: CreateKnowledgeIngestionRequest,
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      ingestion: await this.memoryService.createKnowledgeIngestion(organizationId, withTenantActor(body, tenantAuth)),
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
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      ingestion: await this.memoryService.retryKnowledgeIngestion(
        organizationId,
        ingestionId,
        withTenantActor(body, tenantAuth),
      ),
    };
  }

  @Post("retention/purge")
  @HttpCode(200)
  async purgeRetention(
    @Param("organizationId") organizationId: string,
    @Body() body: PurgeMemoryRetentionRequest,
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      retention: await this.memoryService.purgeRetention(organizationId, withTenantActor(body, tenantAuth)),
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
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      deletion: await this.memoryService.deleteTenantMemoryData(organizationId, withTenantActor(body, tenantAuth)),
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
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return this.memoryService.extractMemoryDrafts(organizationId, withTenantActor(body, tenantAuth));
  }

  @Post("drafts/:draftId/approve")
  async approveMemoryDraft(
    @Param("organizationId") organizationId: string,
    @Param("draftId") draftId: string,
    @Body() body: ApproveMemoryDraftRequest,
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return this.memoryService.approveMemoryDraft(organizationId, draftId, withTenantActor(body, tenantAuth));
  }

  @Post("drafts/:draftId/reject")
  @HttpCode(200)
  async rejectMemoryDraft(
    @Param("organizationId") organizationId: string,
    @Param("draftId") draftId: string,
    @Body() body: RejectMemoryDraftRequest,
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      draft: await this.memoryService.rejectMemoryDraft(organizationId, draftId, withTenantActor(body, tenantAuth)),
    };
  }

  @Patch(":memoryId")
  async updateMemory(
    @Param("organizationId") organizationId: string,
    @Param("memoryId") memoryId: string,
    @Body() body: UpdateMemoryRecordRequest,
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      memory: await this.memoryService.updateMemory(organizationId, memoryId, withTenantActor(body, tenantAuth)),
    };
  }

  @Delete(":memoryId")
  @HttpCode(200)
  async deleteMemory(
    @Param("organizationId") organizationId: string,
    @Param("memoryId") memoryId: string,
    @Body() body: DeleteMemoryRecordRequest,
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      memory: await this.memoryService.deleteMemory(organizationId, memoryId, withTenantActor(body, tenantAuth)),
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
