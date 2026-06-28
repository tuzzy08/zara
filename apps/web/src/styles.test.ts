import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("tenant form field styling", () => {
  it("keeps white form controls readable in the dark tenant shell", () => {
    const css = readFileSync(join(currentDir, "styles.css"), "utf8").replace(/\r\n/g, "\n");

    expect(css).toContain(".form-field input,\n.form-field select,\n.form-field textarea");
    expect(css).toContain("color: #171717;");
    expect(css).toContain(".form-field input::placeholder");
    expect(css).toContain("color: #6b7280;");
  });
});
