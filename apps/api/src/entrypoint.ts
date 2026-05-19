import { normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function normalizeRuntimePath(candidatePath: string) {
  const resolvedPath = normalize(resolve(candidatePath));

  if (process.platform === "win32") {
    return resolvedPath.toLowerCase();
  }

  return resolvedPath;
}

export function isRuntimeEntry(importMetaUrl: string, argvEntry: string | undefined) {
  if (!argvEntry) {
    return false;
  }

  try {
    return normalizeRuntimePath(fileURLToPath(importMetaUrl)) === normalizeRuntimePath(argvEntry);
  } catch {
    return false;
  }
}
