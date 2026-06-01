import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const roots = process.argv.slice(2);

if (roots.length === 0) {
  throw new Error("Usage: node scripts/patch-esm-extensions.mjs <output-dir> [...]");
}

for (const root of roots) {
  for (const filePath of await listJavaScriptFiles(root)) {
    const source = await readFile(filePath, "utf8");
    const patched = patchRelativeSpecifiers(source);

    if (patched !== source) {
      await writeFile(filePath, patched);
    }
  }
}

async function listJavaScriptFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(root, entry.name);

      if (entry.isDirectory()) {
        return listJavaScriptFiles(path);
      }

      return entry.isFile() && entry.name.endsWith(".js") ? [path] : [];
    }),
  );

  return files.flat();
}

function patchRelativeSpecifiers(source) {
  return source.replace(
    /(\bimport\s+(?:[^"']*?\s+from\s*)?["']|\bexport\s+[^"']*?\s+from\s*["']|\bimport\s*\(\s*["'])(\.{1,2}\/[^"']+)(["'])/gs,
    (match, prefix, specifier, suffix) => {
      if (!isExtensionlessJavaScriptSpecifier(specifier)) {
        return match;
      }

      return `${prefix}${specifier}.js${suffix}`;
    },
  );
}

function isExtensionlessJavaScriptSpecifier(specifier) {
  const [path] = specifier.split(/[?#]/, 1);

  return path !== undefined && !/\.(?:cjs|js|json|mjs|node)$/.test(path);
}
