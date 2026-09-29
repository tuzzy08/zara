import type { AgentTurnContext, RuntimeUntrustedContextItem } from "@zara/core";

const maxRequestTokens = 32_768;
const maxUntrustedCharacters = 8_000;

export function selectBoundedUntrustedContext(
  items: RuntimeUntrustedContextItem[] | undefined,
  agentContext: AgentTurnContext | undefined,
) {
  const duplicateContent = new Set((agentContext?.toolResults ?? []).flatMap((result) => [
    result.summary,
    ...(result.safeOutput === undefined ? [] : [JSON.stringify(result.safeOutput)]),
  ]));
  const selected: RuntimeUntrustedContextItem[] = [];
  let remaining = maxUntrustedCharacters;

  for (const item of [...(items ?? [])].reverse()) {
    if (remaining === 0 || duplicateContent.has(item.content)) continue;
    const content = item.content.slice(0, remaining);
    selected.unshift({ ...item, content });
    remaining -= content.length;
  }

  return selected;
}

export function assertTextModelRequestBudget(request: unknown, reservedOutputTokens: number) {
  const inputBytes = new TextEncoder().encode(JSON.stringify(request)).byteLength;
  const conservativeInputTokens = inputBytes;
  if (conservativeInputTokens + reservedOutputTokens > maxRequestTokens) {
    throw new Error("Text model request exceeds the input context budget.");
  }
}
