import { describe, expect, it } from "vitest";

import { isRuntimeEntry } from "./entrypoint";

describe("api entrypoint detection", () => {
  it("treats a Windows argv path as the current module entry", () => {
    expect(
      isRuntimeEntry(
        "file:///C:/Users/Lenovo/Desktop/New%20folder/zara/apps/api/src/main.ts",
        "C:\\Users\\Lenovo\\Desktop\\New folder\\zara\\apps\\api\\src\\main.ts",
      ),
    ).toBe(true);
  });

  it("does not match a different argv path", () => {
    expect(
      isRuntimeEntry(
        "file:///C:/Users/Lenovo/Desktop/New%20folder/zara/apps/api/src/main.ts",
        "C:\\Users\\Lenovo\\Desktop\\New folder\\zara\\apps\\api\\src\\other.ts",
      ),
    ).toBe(false);
  });

  it("matches the current module entry when the drive letter casing differs", () => {
    expect(
      isRuntimeEntry(
        "file:///c:/Users/Lenovo/Desktop/New%20folder/zara/apps/api/src/main.ts",
        "C:\\Users\\Lenovo\\Desktop\\New folder\\zara\\apps\\api\\src\\main.ts",
      ),
    ).toBe(true);
  });
});
