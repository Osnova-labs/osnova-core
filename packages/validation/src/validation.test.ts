import { describe, expect, it } from "vitest";
import { validateManifest } from "./index";

describe("validateManifest", () => {
  it("accepts a minimal manifest", () => {
    const result = validateManifest({
      formatVersion: "0.1",
      id: "project",
      name: "Project",
      createdAt: "2026-06-13T00:00:00.000Z"
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("rejects missing required fields", () => {
    const result = validateManifest({ formatVersion: "0.1" });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.path)).toEqual(["id", "name", "createdAt"]);
  });
});
