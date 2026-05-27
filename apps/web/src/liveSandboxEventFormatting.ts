import type { LiveSandboxStreamEvent } from "./liveSandboxSessionApi";

export interface LiveSandboxEventViewModel {
  title: string;
  detail?: string | undefined;
  tone: "neutral" | "blue" | "pink" | "red";
  label: string;
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
        detail: readString(event.payload.reason) ?? "The live tool call could not finish.",
        tone: "red",
        label: "Tool",
      };
    case "quality.flagged":
      return summarizeQualityFlag(event);
    case "provider.telemetry":
      return summarizeProviderTelemetry(event);
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
        title: `Handed off to ${readString(event.payload.targetRoleName) ?? "specialist"}`,
        detail: readString(event.payload.targetRoleId),
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
      return "Cartesia Sonic 3";
    case "openai-chat":
      return "OpenAI Chat";
    case "openai":
      return "OpenAI";
    case "google-gemini":
      return "Gemini";
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

function formatUsd(value: number) {
  return `$${value.toFixed(4)}`;
}

function formatDurationDetail(value: unknown) {
  const durationMs = readNumber(value);
  return durationMs !== undefined ? `${durationMs}ms` : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
