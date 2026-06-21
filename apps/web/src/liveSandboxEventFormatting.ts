import type { LiveSandboxStreamEvent } from "./liveSandboxSessionApi";

export interface LiveSandboxEventViewModel {
  title: string;
  detail?: string | undefined;
  tone: "neutral" | "blue" | "pink" | "red";
  label: string;
}

export function selectRecentLiveSandboxEvents(
  events: LiveSandboxStreamEvent[],
  limit = 6,
): LiveSandboxStreamEvent[] {
  const meaningfulEvents = events.filter((event) => event.type !== "input.audio.buffered");

  if (meaningfulEvents.length > 0) {
    return meaningfulEvents.slice(-limit);
  }

  return events.slice(-1);
}

export function selectDiagnosticLiveSandboxEvents(
  events: LiveSandboxStreamEvent[],
  limit = 40,
): LiveSandboxStreamEvent[] {
  if (limit <= 0) {
    return [];
  }

  const diagnosticEvents = events.filter((event) => isDiagnosticLiveSandboxEvent(event));
  const pinnedEvents = diagnosticEvents.filter((event) => isPinnedDiagnosticLiveSandboxEvent(event)).slice(-limit);
  const pinnedSequences = new Set(pinnedEvents.map((event) => event.sequence));
  const recentEvents = diagnosticEvents
    .filter((event) => !pinnedSequences.has(event.sequence))
    .slice(-(limit - pinnedEvents.length));

  return [...recentEvents, ...pinnedEvents].sort((a, b) => a.sequence - b.sequence);
}

export function summarizeLiveSandboxEvent(event: LiveSandboxStreamEvent): LiveSandboxEventViewModel {
  switch (event.type) {
    case "turn.transcribed":
      return {
        title: "Caller turn captured",
        detail: readString(event.payload.transcript) ?? "Live speech was transcribed for the workflow.",
        tone: "neutral",
        label: "Transcript",
      };
    case "turn.completed":
      if (readBoolean(event.payload.degraded)) {
        return {
          title: "Agent response degraded",
          detail: `${formatFailureStage(readString(event.payload.failureStage))} fallback response was used.`,
          tone: "red",
          label: "Agent",
        };
      }

      return {
        title: "Agent response ready",
        detail: "Voice playback and transcript output finished for this turn.",
        tone: "blue",
        label: "Agent",
      };
    case "routing.model_selected": {
      const tier = formatModelTier(readString(event.payload.tier));
      const provider = formatProviderName(readString(event.payload.provider));
      const modelId = readString(event.payload.modelId);
      const reason = readString(event.payload.reason);
      const titleSubject =
        modelId !== undefined
          ? `${provider} ${modelId}`
          : provider === "Provider"
            ? tier
            : provider;
      return {
        title: `${titleSubject} selected`,
        ...(reason !== undefined ? { detail: `${tier} - ${reason}` } : { detail: tier }),
        tone: "blue",
        label: "Routing",
      };
    }
    case "tool.started":
      return {
        title: `${readString(event.payload.toolName) ?? "Tool"} started`,
        detail: readString(event.payload.toolId),
        tone: "pink",
        label: "Tool",
      };
    case "tool.requested":
      return {
        title: `${readString(event.payload.toolName) ?? "Tool"} requested`,
        detail: readString(event.payload.toolCallId) ?? readString(event.payload.toolId),
        tone: "pink",
        label: "Tool",
      };
    case "tool.approval_required":
      return {
        title: `${readString(event.payload.toolName) ?? "Tool"} requires approval`,
        detail: "Human review is required before the action can continue.",
        tone: "pink",
        label: "Tool",
      };
    case "tool.completed":
      return {
        title:
          readString(event.payload.summary)
          ?? `${readString(event.payload.toolName) ?? "Tool"} completed`,
        detail: formatDurationDetail(event.payload.durationMs),
        tone: "pink",
        label: "Tool",
      };
    case "tool.failed":
      return {
        title: `${readString(event.payload.toolName) ?? "Tool"} failed`,
        detail:
          readString(event.payload.reason)
          ?? readNestedString(event.payload.error, "message")
          ?? readString(event.payload.summary)
          ?? "The live tool call could not finish.",
        tone: "red",
        label: "Tool",
      };
    case "quality.flagged":
      return summarizeQualityFlag(event);
    case "provider.telemetry":
      return summarizeProviderTelemetry(event);
    case "provider.message":
    case "provider.diagnostic":
      return summarizeProviderEvidence(event);
    case "turn.audio.first_byte": {
      const latencyMs = readNumber(event.payload.latencyMs);
      return {
        title:
          latencyMs !== undefined
            ? `Voice playback first byte in ${latencyMs}ms`
            : "Voice playback started",
        tone: "blue",
        label: "Voice",
      };
    }
    case "turn.audio.timestamps": {
      const count = Array.isArray(event.payload.wordTimestamps) ? event.payload.wordTimestamps.length : 0;
      return {
        title: count > 0 ? `${count} playback word timestamps captured` : "Playback timestamps captured",
        tone: "blue",
        label: "Voice",
      };
    }
    case "turn.cost.delta": {
      const totalUsd = readNumber(event.payload.totalUsd);
      const modelTier = formatModelTier(readString(event.payload.modelTier));
      return {
        title:
          totalUsd !== undefined
            ? `Estimated turn cost ${formatUsd(totalUsd)}`
            : "Turn cost updated",
        detail: modelTier,
        tone: "blue",
        label: "Cost",
      };
    }
    case "stt.partial":
      return {
        title: "Listening",
        detail: readString(event.payload.transcript) ?? "Live speech is still being transcribed.",
        tone: "neutral",
        label: "Transcript",
      };
    case "agent.handoff.requested":
      return {
        title: "Handoff requested",
        detail: readString(event.payload.reason) ?? "The workflow is preparing a specialist transfer.",
        tone: "pink",
        label: "Handoff",
      };
    case "agent.handoff.completed":
      return {
        title: `Handed off to ${readString(event.payload.targetAgentName) ?? "specialist"}`,
        detail: readString(event.payload.targetAgentId),
        tone: "pink",
        label: "Handoff",
      };
    case "node.transition":
      return summarizeNodeTransition(event);
    case "call.failed":
      return {
        title: readString(event.payload.message) ?? "Live sandbox call failed",
        detail: readString(event.payload.stage),
        tone: "red",
        label: "Attention",
      };
    case "call.ended":
      return {
        title: "Sandbox call ended",
        tone: "neutral",
        label: "Call",
      };
    default:
      return {
        title: event.type,
        tone: "neutral",
        label: "Live",
      };
  }
}

function summarizeQualityFlag(event: LiveSandboxStreamEvent): LiveSandboxEventViewModel {
  const stage = readString(event.payload.stage);
  const message = readString(event.payload.message);

  if (stage === "model") {
    return {
      title: "Text model needs attention",
      ...(message !== undefined ? { detail: message } : {}),
      tone: "red",
      label: "Model",
    };
  }

  if (stage === "tts") {
    return {
      title: "Voice playback needs attention",
      ...(message !== undefined ? { detail: message } : {}),
      tone: "red",
      label: "Voice",
    };
  }

  return {
    title: "Quality signal flagged",
    ...(message !== undefined ? { detail: message } : {}),
    tone: "red",
    label: "Quality",
  };
}

function summarizeProviderTelemetry(event: LiveSandboxStreamEvent): LiveSandboxEventViewModel {
  const stage = readString(event.payload.stage);
  const provider = formatProviderName(readString(event.payload.provider));
  const latencyMs = readNumber(event.payload.latencyMs);
  const telemetryEvent = readString(event.payload.event);

  if (stage === "tts") {
    return {
      title:
        latencyMs !== undefined
          ? `${provider} first byte in ${latencyMs}ms`
          : `${provider} voice playback ready`,
      tone: "blue",
      label: "Provider",
    };
  }

  if (stage === "stt") {
    if (telemetryEvent === "session_opened") {
      return {
        title: `${provider} streaming session opened`,
        tone: "blue",
        label: "STT",
      };
    }

    if (telemetryEvent === "audio_first_frame") {
      return {
        title: `${provider} first audio frame received`,
        detail: formatSampleRateDetail(event.payload.sampleRateHz),
        tone: "blue",
        label: "STT",
      };
    }

    if (telemetryEvent === "forced_endpoint") {
      return {
        title: `${provider} endpoint forced`,
        tone: "blue",
        label: "STT",
      };
    }

    if (telemetryEvent === "final") {
      const endpointMs = readNumber(event.payload.endpointMs);
      return {
        title:
          endpointMs !== undefined
            ? `${provider} final transcript after ${endpointMs}ms endpoint`
            : latencyMs !== undefined
            ? `${provider} final transcript in ${latencyMs}ms`
            : `${provider} final transcript received`,
        detail: formatSttFinalTimingDetail(event.payload),
        tone: "blue",
        label: "STT",
      };
    }

    if (telemetryEvent === "provider_close") {
      return {
        title: `${provider} provider connection closed`,
        detail: formatCloseCodeDetail(event.payload.closeCode),
        tone: "red",
        label: "STT",
      };
    }

    if (telemetryEvent === "termination") {
      return {
        title: `${provider} streaming session terminated`,
        tone: "neutral",
        label: "STT",
      };
    }

    return {
      title:
        latencyMs !== undefined
          ? `${provider} transcribed in ${latencyMs}ms`
          : `${provider} transcribed the caller turn`,
      tone: "blue",
      label: "Provider",
    };
  }

  if (stage === "model") {
    const tier = formatModelTier(readString(event.payload.tier));
    if (readBoolean(event.payload.degraded)) {
      return {
        title:
          latencyMs !== undefined
            ? `${provider} used a fallback in ${latencyMs}ms`
            : `${provider} used a fallback response`,
        detail: `${tier} - ${formatFailureStage(readString(event.payload.failureStage)).toLowerCase()} failure`,
        tone: "red",
        label: "Model",
      };
    }

    return {
      title:
        latencyMs !== undefined
          ? `${provider} responded in ${latencyMs}ms`
          : `${provider} completed the model turn`,
      detail: tier,
      tone: "blue",
      label: "Provider",
    };
  }

  return {
    title: provider,
    ...(latencyMs !== undefined ? { detail: `${latencyMs}ms` } : {}),
    tone: "blue",
    label: "Provider",
  };
}

function summarizeProviderEvidence(event: LiveSandboxStreamEvent): LiveSandboxEventViewModel {
  const provider = formatProviderName(readString(event.payload.provider));
  const eventType =
    readString(event.payload.eventType)
    ?? readString(event.payload.providerEventType)
    ?? readString(event.payload.event)
    ?? event.type;
  const detail = formatProviderEvidenceDetail(event.payload);

  return {
    title: `${provider} ${eventType}`,
    ...(detail !== undefined ? { detail } : {}),
    tone: readString(event.payload.status) === "failed" ? "red" : "blue",
    label: "Provider",
  };
}

function isDiagnosticLiveSandboxEvent(event: LiveSandboxStreamEvent) {
  if (event.type === "input.audio.buffered") {
    return false;
  }

  if (
    event.type === "stt.partial"
    || event.type === "turn.transcribed"
    || event.type === "turn.completed"
    || event.type === "turn.audio.first_byte"
    || event.type === "turn.audio.timestamps"
    || event.type === "routing.model_selected"
    || event.type === "tool.requested"
    || event.type === "tool.started"
    || event.type === "tool.completed"
    || event.type === "tool.failed"
    || event.type === "tool.approval_required"
    || event.type === "quality.flagged"
    || event.type === "runtime.warning"
    || event.type === "call.failed"
    || event.type === "provider.diagnostic"
    || event.type === "provider.message"
  ) {
    return true;
  }

  if (event.type !== "provider.telemetry") {
    return false;
  }

  const stage = readString(event.payload.stage);
  return stage === "stt" || stage === "model" || stage === "tts";
}

function isPinnedDiagnosticLiveSandboxEvent(event: LiveSandboxStreamEvent) {
  if (
    event.type === "tool.failed"
    || event.type === "quality.flagged"
    || event.type === "runtime.warning"
    || event.type === "call.failed"
    || event.type === "provider.diagnostic"
    || event.type === "provider.message"
    || event.type === "tool.approval_required"
  ) {
    return true;
  }

  if (event.type === "turn.completed") {
    return readBoolean(event.payload.degraded);
  }

  if (event.type === "provider.telemetry") {
    return readString(event.payload.event) === "provider_close" || readBoolean(event.payload.degraded);
  }

  return false;
}

function summarizeNodeTransition(event: LiveSandboxStreamEvent): LiveSandboxEventViewModel {
  const branchLabel = readString(event.payload.branchLabel);
  const label = readString(event.payload.label);

  if (branchLabel !== undefined) {
    return {
      title: `Route selected: ${branchLabel}`,
      detail: readString(event.payload.targetNodeId),
      tone: "neutral",
      label: "Node",
    };
  }

  return {
    title: `Entered ${label ?? readString(event.payload.nodeId) ?? "workflow node"}`,
    detail: readString(event.payload.nodeKind),
    tone: "neutral",
    label: "Node",
  };
}

function formatProviderName(provider: string | undefined) {
  switch (provider) {
    case "assemblyai-streaming":
      return "AssemblyAI";
    case "cartesia-sonic-3":
      return "Cartesia Sonic 3.5";
    case "openai-chat":
      return "OpenAI Chat";
    case "openai":
      return "OpenAI";
    case "openai-realtime":
      return "OpenAI Realtime";
    case "google-gemini":
      return "Gemini";
    case "gemini-live":
      return "Gemini Live";
    default:
      return provider ?? "Provider";
  }
}

function formatModelTier(tier: string | undefined) {
  switch (tier) {
    case "cheap":
      return "Cheap tier";
    case "standard":
      return "Standard tier";
    case "sota":
      return "SOTA tier";
    case "rules":
      return "Rules tier";
    default:
      return tier ?? "Model tier";
  }
}

function formatFailureStage(stage: string | undefined) {
  switch (stage) {
    case "stt":
      return "STT";
    case "model":
      return "Model";
    case "tts":
      return "Voice";
    default:
      return "Runtime";
  }
}

function formatUsd(value: number) {
  return `$${value.toFixed(4)}`;
}

function formatDurationDetail(value: unknown) {
  const durationMs = readNumber(value);
  return durationMs !== undefined ? `${durationMs}ms` : undefined;
}

function formatSampleRateDetail(value: unknown) {
  const sampleRateHz = readNumber(value);
  return sampleRateHz !== undefined ? `${sampleRateHz} Hz` : undefined;
}

function formatCloseCodeDetail(value: unknown) {
  const closeCode = readNumber(value);
  return closeCode !== undefined ? `Close code ${closeCode}` : undefined;
}

function formatSttFinalTimingDetail(payload: Record<string, unknown>) {
  const speechMs = readNumber(payload.speechMs);
  const listeningMs = readNumber(payload.listeningMs);
  const parts = [
    ...(speechMs !== undefined ? [`Speech ${speechMs}ms`] : []),
    ...(listeningMs !== undefined ? [`listening ${listeningMs}ms`] : []),
  ];

  return parts.length === 0 ? undefined : parts.join("; ");
}

function formatProviderEvidenceDetail(payload: Record<string, unknown>) {
  const parts = [
    formatEvidenceId("response", readString(payload.responseId)),
    formatEvidenceId("item", readString(payload.itemId)),
    formatEvidenceId("call", readString(payload.callId)),
    readString(payload.status),
  ].filter((part): part is string => part !== undefined);

  return parts.length > 0 ? parts.join("; ") : undefined;
}

function formatEvidenceId(label: string, value: string | undefined) {
  return value !== undefined ? `${label} ${value}` : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNestedString(value: unknown, key: string) {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  return readString((value as Record<string, unknown>)[key]);
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(value: unknown) {
  return typeof value === "boolean" ? value : false;
}
