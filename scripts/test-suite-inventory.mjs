import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ordinaryTestPattern = /\.test\.(?:ts|tsx)$/;
const testDeclarationPattern = /\b(?:it|test)(?:\.each)?\s*\(/g;

const trackedFiles = execFileSync(
  "git",
  ["ls-files"],
  { encoding: "utf8" },
)
  .split(/\r?\n/)
  .filter((file) => ordinaryTestPattern.test(file))
  .sort();

const layerMatchers = {
  unit: [
    /^packages\/.*\.test\.(?:ts|tsx)$/,
    /^apps\/web\/.*\.test\.ts$/,
    /^apps\/platform-admin\/.*\.test\.ts$/,
  ],
  api: [
    /^apps\/api\/.*\.test\.ts$/,
    /^apps\/pstn-protocol-simulator\/.*\.test\.ts$/,
  ],
  "ui-smoke": [
    /^apps\/web\/.*\.test\.tsx$/,
    /^apps\/platform-admin\/.*\.test\.tsx$/,
  ],
};

function summarize(files) {
  return files.reduce(
    (summary, file) => {
      const source = readFileSync(file, "utf8");

      summary.files += 1;
      summary.tests += source.match(testDeclarationPattern)?.length ?? 0;
      summary.lines += source.split(/\r?\n/).length;

      return summary;
    },
    { files: 0, tests: 0, lines: 0 },
  );
}

const layerFiles = Object.fromEntries(
  Object.entries(layerMatchers).map(([layer, matchers]) => [
    layer,
    trackedFiles.filter((file) => matchers.some((matcher) => matcher.test(file))),
  ]),
);
const classifications = new Map(
  trackedFiles.map((file) => [
    file,
    Object.entries(layerFiles)
      .filter(([, files]) => files.includes(file))
      .map(([layer]) => layer),
  ]),
);
const inventory = {
  generatedAt: new Date().toISOString(),
  source: "git ls-files",
  countingNote:
    "tests counts static it()/test() declarations; parameterized runtime cases may be higher",
  ordinary: summarize(trackedFiles),
  layers: Object.fromEntries(
    Object.entries(layerFiles).map(([layer, files]) => [
      layer,
      summarize(files),
    ]),
  ),
  filesByLayer: layerFiles,
  ordinaryFiles: trackedFiles,
  unclassified: [...classifications]
    .filter(([, layers]) => layers.length === 0)
    .map(([file]) => file),
  duplicates: [...classifications]
    .filter(([, layers]) => layers.length > 1)
    .map(([file]) => file),
};

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(inventory)}\n`);
} else {
  console.log("Tracked ordinary test inventory");
  console.log(`Source: ${inventory.source}`);
  console.log(`Counting note: ${inventory.countingNote}`);
  console.table({
    ordinary: inventory.ordinary,
    ...inventory.layers,
  });

  if (inventory.unclassified.length > 0) {
    console.error("Unclassified test files:");
    console.error(inventory.unclassified.join("\n"));
  }

  if (inventory.duplicates.length > 0) {
    console.error("Files assigned to multiple layers:");
    console.error(inventory.duplicates.join("\n"));
  }
}

if (inventory.unclassified.length > 0 || inventory.duplicates.length > 0) {
  process.exitCode = 1;
}
