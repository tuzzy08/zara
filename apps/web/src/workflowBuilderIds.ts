export function getNextBuilderNodeNumber(nodeIds: string[], prefix: string): number {
  let maxSuffix = 0;

  for (const nodeId of nodeIds) {
    if (!nodeId.startsWith(prefix)) {
      continue;
    }

    const suffix = Number.parseInt(nodeId.slice(prefix.length), 10);

    if (Number.isNaN(suffix)) {
      continue;
    }

    maxSuffix = Math.max(maxSuffix, suffix);
  }

  return maxSuffix + 1;
}
