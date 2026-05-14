import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function isRuntimeEntry(importMetaUrl: string, argvEntry: string | undefined) {
  if (!argvEntry) {
    return false;
  }

  return importMetaUrl === pathToFileURL(resolve(argvEntry)).href;
}
