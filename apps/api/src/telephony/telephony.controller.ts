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
