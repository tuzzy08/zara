import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("production ESM output", () => {
  it("emits Node-resolvable relative JavaScript specifiers", async () => {
    const outputRoots = [
      resolve(process.cwd(), "apps/api/dist-js"),
      resolve(process.cwd(), "packages/core/dist"),
    ];

    const unresolvedSpecifiers: string[] = [];

    for (const outputRoot of outputRoots) {
      for (const filePath of await listJavaScriptFiles(outputRoot)) {
        const source = await readFile(filePath, "utf8");
        const relativeFile = relative(process.cwd(), filePath);

        for (const specifier of findRelativeSpecifiers(source)) {
          if (isExtensionlessJavaScriptSpecifier(specifier)) {
            unresolvedSpecifiers.push(`${relativeFile}: ${specifier}`);
          }
        }
      }
    }

    expect(unresolvedSpecifiers).toEqual([]);
  }, 20_000);
});

async function listJavaScriptFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(root, entry.name);

      if (entry.isDirectory()) {
        return listJavaScriptFiles(path);
      }

      return entry.isFile() && entry.name.endsWith(".js") && !entry.name.endsWith(".test.js") ? [path] : [];
    }),
  );

  return files.flat();
}

function findRelativeSpecifiers(source: string) {
  const specifiers: string[] = [];
  const pattern =
    /(?:import\s+[^"']*?\s+from\s*["']|export\s+[^"']*?\s+from\s*["']|import\s*\(\s*["'])(\.{1,2}\/[^"']+)(?=["'])/g;

  for (const match of source.matchAll(pattern)) {
    const specifier = match[1];

    if (specifier !== undefined) {
      specifiers.push(specifier);
    }
  }

  return specifiers;
}

function isExtensionlessJavaScriptSpecifier(specifier: string) {
  const [path] = specifier.split(/[?#]/, 1);

  return path !== undefined && !/\.(?:cjs|js|json|mjs|node)$/.test(path);
}
