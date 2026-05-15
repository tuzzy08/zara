import {
  Body,
  Controller,
  Get,
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
      recordingPolicy: body.recordingPolicy,
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
    },
  ) {
    return this.telephonyService.dispatchInboundCall({
      organizationId,
      toPhoneNumber: body.toPhoneNumber,
      fromPhoneNumber: body.fromPhoneNumber,
      callSid: body.callSid,
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
        | "failover.triggered";
      digit?: string | undefined;
      transferTarget?: string | undefined;
      fallbackTarget?: string | undefined;
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
    });
  }

  @Post("telephony/webhooks/twilio")
  @HttpCode(200)
  handleTwilioWebhook(
    @Headers("x-twilio-signature") signature: string | undefined,
    @Body() body: Record<string, string>,
  ) {
    return this.telephonyService.handleTwilioWebhook({
      signature,
      payload: body,
    });
  }
}
