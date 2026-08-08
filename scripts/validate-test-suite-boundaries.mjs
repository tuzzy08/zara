import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const allowlist = JSON.parse(
  readFileSync(new URL("../config/ui-smoke-allowlist.json", import.meta.url), "utf8"),
);
const testDeclarationPattern = /\b(?:it|test)(?:\.each)?\s*\(/g;
const trackedFiles = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean);
const domTestFiles = trackedFiles
  .filter((file) => /^apps\/(?:web|platform-admin)\/.*\.test\.tsx$/.test(file))
  .sort();
const approvedFiles = [...allowlist.files].sort();
const unapprovedFiles = domTestFiles.filter((file) => !approvedFiles.includes(file));
const missingFiles = approvedFiles.filter((file) => !domTestFiles.includes(file) || !existsSync(file));
const declaredTests = domTestFiles.reduce(
  (count, file) => count + (readFileSync(file, "utf8").match(testDeclarationPattern)?.length ?? 0),
  0,
);
const errors = [];

if (unapprovedFiles.length > 0) {
  errors.push(`Unapproved DOM smoke files:\n${unapprovedFiles.join("\n")}`);
}

if (missingFiles.length > 0) {
  errors.push(`Approved DOM smoke files missing from the tracked suite:\n${missingFiles.join("\n")}`);
}

if (
  declaredTests < allowlist.minimumDeclaredTests
  || declaredTests > allowlist.maximumDeclaredTests
) {
  errors.push(
    `DOM smoke declarations ${declaredTests} fall outside the approved ${allowlist.minimumDeclaredTests}-${allowlist.maximumDeclaredTests} range.`,
  );
}

console.log(
  `UI-smoke boundary: ${domTestFiles.length} approved files, ${declaredTests} declared tests.`,
);

if (errors.length > 0) {
  console.error(errors.join("\n\n"));
  process.exitCode = 1;
}
