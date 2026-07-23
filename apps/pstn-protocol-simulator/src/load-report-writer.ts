import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { serializeLoadReport } from "./load-report";
import type { PstnLoadReport } from "./load-runner";

export async function writeLoadReport(report: PstnLoadReport, directory: string) {
  const targetDirectory = resolve(directory);
  await mkdir(targetDirectory, { recursive: true });
  const timestamp = report.generatedAt.replace(/[-:.]/gu, "");
  const profile = safeSegment(report.profile, "profile");
  const commit = safeSegment(report.commitSha.slice(0, 12), "commit");
  const filename = `${profile}-${commit}-${timestamp}.json`;
  const target = resolve(targetDirectory, filename);
  const temporary = resolve(targetDirectory, `.${filename}.${randomUUID()}.tmp`);
  await writeFile(temporary, serializeLoadReport(report), { encoding: "utf8", flag: "wx" });
  await rename(temporary, target);
  return target;
}

function safeSegment(value: string, label: string) {
  if (!/^[a-zA-Z0-9_-]+$/u.test(value)) throw new Error(`PSTN load report ${label} is not filename-safe.`);
  return value;
}
