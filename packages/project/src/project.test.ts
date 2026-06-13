import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createNote, createProject, openProject } from "./index";

const createdRoots: string[] = [];

afterEach(async () => {
  await Promise.all(createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("project operations", () => {
  it("creates and opens a project", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "osnova-core-"));
    createdRoots.push(rootPath);

    await createProject({ rootPath, id: "test-project", name: "Test Project" });
    const project = await openProject(rootPath);

    expect(project.manifest.id).toBe("test-project");
    expect(project.manifest.name).toBe("Test Project");
  });

  it("creates a markdown note in notes", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "osnova-core-"));
    createdRoots.push(rootPath);

    const project = await createProject({ rootPath, id: "test-project", name: "Test Project" });
    const note = await createNote(project, { title: "First Note", body: "Body." });
    const content = await readFile(note.path, "utf8");

    expect(note.id).toBe("first-note");
    expect(content).toContain("# First Note");
    expect(content).toContain("Body.");
  });
});
