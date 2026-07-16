export type PremiumRealtimeLifecycleEvent =
  | {
      type: "caller_activity";
      state: "started" | "stopped";
      itemId?: string | undefined;
    }
  | {
      type: "caller_turn";
      state: "committed";
      itemId?: string | undefined;
    }
  | {
      type: "assistant_response";
      state: "started" | "audio_completed" | "completed" | "cancelled" | "failed" | "incomplete" | "interrupted";
      responseId?: string | undefined;
      itemId?: string | undefined;
      contentIndex?: number | undefined;
      failureCode?: string | undefined;
      failureType?: string | undefined;
      failureReason?: string | undefined;
    }
  | {
      type: "provider_failure";
      code?: string | undefined;
      providerErrorType?: string | undefined;
      param?: string | undefined;
      eventId?: string | undefined;
      responseId?: string | undefined;
      itemId?: string | undefined;
      callId?: string | undefined;
    };
