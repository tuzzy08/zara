import { normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function normalizeRuntimePath(candidatePath: string) {
  const slashNormalizedPath = candidatePath.replace(/\\/g, "/");
  const drivePath = slashNormalizedPath.replace(/^\/(?=[A-Za-z]:\/)/, "");

  if (/^[A-Za-z]:\//.test(drivePath)) {
    return drivePath.toLowerCase();
  }

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
