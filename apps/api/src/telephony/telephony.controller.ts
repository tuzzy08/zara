import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
} from "@nestjs/common";

import { TelephonyService } from "./telephony.service";

@Controller()
export class TelephonyController {
  constructor(private readonly telephonyService: TelephonyService) {}

  @Get("organizations/:organizationId/telephony/state")
  getState(@Param("organizationId") organizationId: string) {
    return this.telephonyService.getState(organizationId);
  }

  @Post("organizations/:organizationId/telephony/connections")
  createConnection(
    @Param("organizationId") organizationId: string,
    @Body()
    body: {
      actorUserId: string;
      label: string;
      ownershipMode: "platform_managed" | "byo_sip_trunk" | "byo_provider_account";
      provider: "browser-webrtc" | "openai-sip" | "twilio" | "signalwire" | "telnyx" | "custom-sip";
      region: string;
      blockRoutingOnHealthFailure: boolean;
      recordingPolicy?: {
        enabled: boolean;
        consentMode: "disabled" | "single-party" | "two-party";
        consentMessage: string;
      };
      accountSid?: string | undefined;
      authToken?: string | undefined;
      username?: string | undefined;
      secret?: string | undefined;
      sip?: { domain: string; codecs: string[] } | undefined;
    },
  ) {
    return this.telephonyService.createConnection({
      organizationId,
      actorUserId: body.actorUserId,
      label: body.label,
      ownershipMode: body.ownershipMode,
      provider: body.provider,
      region: body.region,
      blockRoutingOnHealthFailure: body.blockRoutingOnHealthFailure,
      recordingPolicy: body.recordingPolicy,
      accountSid: body.accountSid,
      authToken: body.authToken,
      username: body.username,
      secret: body.secret,
      sip: body.sip,
    });
  }

  @Delete("organizations/:organizationId/telephony/connections/:connectionId")
  deleteConnection(
    @Param("organizationId") organizationId: string,
    @Param("connectionId") connectionId: string,
    @Body()
    body: {
      actorUserId?: string | undefined;
    },
  ) {
    return this.telephonyService.deleteConnection({
      organizationId,
      connectionId,
      actorUserId: body.actorUserId,
    });
  }

  @Post("organizations/:organizationId/telephony/connections/:connectionId/validate")
  @HttpCode(200)
  validateConnection(
    @Param("organizationId") organizationId: string,
    @Param("connectionId") connectionId: string,
  ) {
    return this.telephonyService.validateConnection({
      organizationId,
      connectionId,
    });
  }

  @Post("organizations/:organizationId/telephony/connections/:connectionId/heartbeat")
  runConnectionHeartbeat(
    @Param("organizationId") organizationId: string,
    @Param("connectionId") connectionId: string,
    @Body()
    body: {
      scheduled?: boolean | undefined;
    },
  ) {
    return this.telephonyService.runConnectionHeartbeat({
      organizationId,
      connectionId,
      scheduled: body.scheduled ?? false,
    });
  }

  @Post("organizations/:organizationId/telephony/connections/:connectionId/import-twilio-numbers")
  importTwilioNumbers(
    @Param("organizationId") organizationId: string,
    @Param("connectionId") connectionId: string,
  ) {
    return this.telephonyService.importTwilioNumbers({
      organizationId,
      connectionId,
    });
  }

  @Post("organizations/:organizationId/telephony/connections/:connectionId/register-number")
  registerPhoneNumber(
    @Param("organizationId") organizationId: string,
    @Param("connectionId") connectionId: string,
    @Body()
    body: {
      phoneNumber: string;
      friendlyName: string;
      externalNumberId?: string | undefined;
    },
  ) {
    return this.telephonyService.registerPhoneNumber({
      organizationId,
      connectionId,
      phoneNumber: body.phoneNumber,
      friendlyName: body.friendlyName,
      externalNumberId: body.externalNumberId,
    });
  }

  @Patch("organizations/:organizationId/telephony/numbers/:numberId/routing")
  assignNumberRoute(
    @Param("organizationId") organizationId: string,
    @Param("numberId") numberId: string,
    @Body()
    body: {
      publishedVersionId: string;
      workflowLabel: string;
      workspaceId: string;
      runtimeProfile?: "cost-optimized" | "balanced" | "premium-realtime" | undefined;
      recordingPolicy?: {
        enabled: boolean;
        consentMode: "disabled" | "single-party" | "two-party";
        consentMessage: string;
      };
    },
  ) {
    return this.telephonyService.assignNumberRoute({
      organizationId,
      numberId,
      publishedVersionId: body.publishedVersionId,
      workflowLabel: body.workflowLabel,
      workspaceId: body.workspaceId,
      runtimeProfile: body.runtimeProfile,
      recordingPolicy: body.recordingPolicy,
    });
  }

  @Post("organizations/:organizationId/telephony/numbers/:numberId/pstn-test-route")
  createPstnTestRoute(
    @Param("organizationId") organizationId: string,
    @Param("numberId") numberId: string,
    @Body()
    body: {
      publishedVersionId: string;
      workflowLabel: string;
      workspaceId: string;
      runtimeProfile: "cost-optimized" | "balanced" | "premium-realtime";
      allowedCallerNumbers: string[];
      expiresAt: string;
      now?: string | undefined;
    },
  ) {
    return this.telephonyService.createPstnTestRoute({
      organizationId,
      numberId,
      publishedVersionId: body.publishedVersionId,
      workflowLabel: body.workflowLabel,
      workspaceId: body.workspaceId,
      runtimeProfile: body.runtimeProfile,
      allowedCallerNumbers: body.allowedCallerNumbers,
      expiresAt: body.expiresAt,
      now: body.now,
    });
  }

  @Post("organizations/:organizationId/telephony/numbers/:numberId/pstn-test-route/:sessionId/complete")
  completePstnTestRoute(
    @Param("organizationId") organizationId: string,
    @Param("numberId") numberId: string,
    @Param("sessionId") sessionId: string,
    @Body()
    body: {
      status: "failed" | "expired" | "unauthorized_caller" | "manually_ended";
      reason: string;
      at?: string | undefined;
    },
  ) {
    return this.telephonyService.completePstnTestRoute({
      organizationId,
      numberId,
      sessionId,
      status: body.status,
      reason: body.reason,
      at: body.at,
    });
  }

  @Post("organizations/:organizationId/telephony/numbers/:numberId/live-route/activate")
  activateLiveRoute(
    @Param("organizationId") organizationId: string,
    @Param("numberId") numberId: string,
    @Body()
    body: {
      actorUserId: string;
      now?: string | undefined;
      tenantStatus?: "active" | "suspended" | undefined;
      override?: {
        actorUserId: string;
        approvedByUserId: string;
        reason: string;
      } | undefined;
    },
  ) {
    return this.telephonyService.activateLiveRoute({
      organizationId,
      numberId,
      actorUserId: body.actorUserId,
      now: body.now,
      tenantStatus: body.tenantStatus,
      override: body.override,
    });
  }

  @Post("organizations/:organizationId/telephony/numbers/:numberId/live-route/pause")
  pauseLiveRoute(
    @Param("organizationId") organizationId: string,
    @Param("numberId") numberId: string,
    @Body()
    body: {
      actorUserId?: string | undefined;
      now?: string | undefined;
    },
  ) {
    return this.telephonyService.pauseLiveRoute({
      organizationId,
      numberId,
      actorUserId: body.actorUserId,
      now: body.now,
    });
  }

  @Post("organizations/:organizationId/telephony/numbers/:numberId/live-route/resume")
  resumeLiveRoute(
    @Param("organizationId") organizationId: string,
    @Param("numberId") numberId: string,
    @Body()
    body: {
      actorUserId: string;
      now?: string | undefined;
      tenantStatus?: "active" | "suspended" | undefined;
      override?: {
        actorUserId: string;
        approvedByUserId: string;
        reason: string;
      } | undefined;
    },
  ) {
    return this.telephonyService.resumeLiveRoute({
      organizationId,
      numberId,
      actorUserId: body.actorUserId,
      now: body.now,
      tenantStatus: body.tenantStatus,
      override: body.override,
    });
  }

  @Post("organizations/:organizationId/telephony/dispatch/inbound")
  dispatchInboundCall(
    @Param("organizationId") organizationId: string,
    @Body()
    body: {
      toPhoneNumber: string;
      fromPhoneNumber: string;
      callSid: string;
      now?: string | undefined;
    },
  ) {
    return this.telephonyService.dispatchInboundCall({
      organizationId,
      toPhoneNumber: body.toPhoneNumber,
      fromPhoneNumber: body.fromPhoneNumber,
      callSid: body.callSid,
      now: body.now,
    });
  }

  @Post("organizations/:organizationId/telephony/calls/:callSessionId/runtime-policy")
  applyCallRuntimePolicy(
    @Param("organizationId") organizationId: string,
    @Param("callSessionId") callSessionId: string,
    @Body()
    body: {
      now?: string | undefined;
      graceUntil?: string | undefined;
      subscriptionStatus?: "active" | "trialing" | "none" | "past_due" | "canceled" | undefined;
      tenantStatus?: "active" | "suspended" | undefined;
      budgetAction?: "allow" | "warn" | "block" | undefined;
      budgetReasons?: string[] | undefined;
    },
  ) {
    return this.telephonyService.applyCallRuntimePolicy({
      organizationId,
      callSessionId,
      now: body.now,
      graceUntil: body.graceUntil,
      subscriptionStatus: body.subscriptionStatus,
      tenantStatus: body.tenantStatus,
      budgetAction: body.budgetAction,
      budgetReasons: body.budgetReasons,
    });
  }

  @Post("organizations/:organizationId/telephony/dispatch/outbound")
  dispatchOutboundCall(
    @Param("organizationId") organizationId: string,
    @Body()
    body: {
      toPhoneNumber: string;
      fromPhoneNumber: string;
      callSid: string;
      publishedVersionId: string;
      workflowLabel: string;
      workspaceId: string;
      consentGranted: boolean;
      budgetRemainingUsd: number;
      estimatedCostUsd: number;
      localHour: number;
      callingWindow: { startHour: number; endHour: number };
      actorUserId?: string | undefined;
      abusePolicy?: {
        maxCallsPerWindow: number;
        windowSeconds: number;
        pauseTenantOnViolation: boolean;
      } | undefined;
      compliancePolicy?: {
        dncPhoneNumbers: string[];
        timezone?: string | undefined;
        localTime?: string | undefined;
        override?: {
          reason: string;
          approvedByUserId: string;
        } | undefined;
      } | undefined;
      now?: string | undefined;
    },
  ) {
    return this.telephonyService.dispatchOutboundCall({
      organizationId,
      toPhoneNumber: body.toPhoneNumber,
      fromPhoneNumber: body.fromPhoneNumber,
      callSid: body.callSid,
      publishedVersionId: body.publishedVersionId,
      workflowLabel: body.workflowLabel,
      workspaceId: body.workspaceId,
      consentGranted: body.consentGranted,
      budgetRemainingUsd: body.budgetRemainingUsd,
      estimatedCostUsd: body.estimatedCostUsd,
      localHour: body.localHour,
      callingWindow: body.callingWindow,
      actorUserId: body.actorUserId,
      abusePolicy: body.abusePolicy,
      compliancePolicy: body.compliancePolicy,
      now: body.now,
    });
  }

  @Post("organizations/:organizationId/telephony/connections/:connectionId/test-call")
  runConnectionTestCall(
    @Param("organizationId") organizationId: string,
    @Param("connectionId") connectionId: string,
    @Body()
    body: {
      phoneNumberId: string;
      fromPhoneNumber: string;
      callSid: string;
    },
  ) {
    return this.telephonyService.runConnectionTestCall({
      organizationId,
      connectionId,
      phoneNumberId: body.phoneNumberId,
      fromPhoneNumber: body.fromPhoneNumber,
      callSid: body.callSid,
    });
  }

  @Post("organizations/:organizationId/telephony/calls/:callSessionId/events")
  recordCallControlEvent(
    @Param("organizationId") organizationId: string,
    @Param("callSessionId") callSessionId: string,
    @Body()
    body: {
      dispatchId: string;
      eventType:
        | "dtmf.received"
        | "voicemail.detected"
        | "transfer.requested"
        | "transfer.failed"
        | "failover.triggered"
        | "callback.scheduled";
      digit?: string | undefined;
      transferTarget?: string | undefined;
      fallbackTarget?: string | undefined;
      callbackNumber?: string | undefined;
      actorUserId?: string | undefined;
      callerMessage?: string | undefined;
    },
  ) {
    return this.telephonyService.recordCallControlEvent({
      organizationId,
      callSessionId,
      dispatchId: body.dispatchId,
      eventType: body.eventType,
      digit: body.digit,
      transferTarget: body.transferTarget,
      fallbackTarget: body.fallbackTarget,
      callbackNumber: body.callbackNumber,
      actorUserId: body.actorUserId,
      callerMessage: body.callerMessage,
    });
  }

  @Post("organizations/:organizationId/telephony/calls/:callSessionId/pstn-test-checkpoints")
  recordPstnPhoneTestCheckpoint(
    @Param("organizationId") organizationId: string,
    @Param("callSessionId") callSessionId: string,
    @Body()
    body: {
      checkpoint:
        | "verifiedWebhook"
        | "allowedCallerMatched"
        | "mediaWebSocketConnected"
        | "inboundFrameReceived"
        | "transcriptCreated"
        | "agentResponseGenerated"
        | "outboundAudioSent"
        | "cleanEnd"
        | "noFatalError";
      at?: string | undefined;
    },
  ) {
    return this.telephonyService.recordPstnPhoneTestCheckpoint({
      organizationId,
      callSessionId,
      checkpoint: body.checkpoint,
      at: body.at,
    });
  }

  @Post("organizations/:organizationId/telephony/calls/:callSessionId/human-fallback")
  resolveHumanFallback(
    @Param("organizationId") organizationId: string,
    @Param("callSessionId") callSessionId: string,
    @Body()
    body: {
      dispatchId: string;
      actorUserId: string;
      transferTarget?: string | undefined;
      callbackNumber?: string | undefined;
      now?: string | undefined;
    },
  ) {
    return this.telephonyService.resolveHumanFallback({
      organizationId,
      callSessionId,
      dispatchId: body.dispatchId,
      actorUserId: body.actorUserId,
      transferTarget: body.transferTarget,
      callbackNumber: body.callbackNumber,
      now: body.now,
    });
  }

  @Post("organizations/:organizationId/telephony/credentials/rotate")
  rotateCredentialEnvelopes(
    @Param("organizationId") organizationId: string,
    @Body()
    body: {
      actorUserId?: string | undefined;
    },
  ) {
    return this.telephonyService.rotateCredentialEnvelopes({
      organizationId,
      actorUserId: body.actorUserId,
    });
  }

  @Post("telephony/webhooks/twilio")
  @HttpCode(200)
  @Header("Content-Type", "text/xml")
  async handleTwilioWebhook(
    @Headers("x-twilio-signature") signature: string | undefined,
    @Body() body: Record<string, string>,
  ) {
    const response = await this.telephonyService.handleTwilioWebhook({
      signature,
      payload: body,
    });
    return response.twiml;
  }
}
