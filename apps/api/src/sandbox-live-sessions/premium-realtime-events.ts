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
      state: "started" | "audio_completed" | "completed" | "cancelled" | "interrupted";
      responseId?: string | undefined;
      itemId?: string | undefined;
      contentIndex?: number | undefined;
    };
