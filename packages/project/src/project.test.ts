import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createNote, createProject, getProjectOverview, listAssets, listNotes, openProject } from "./index";

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

  it("returns a project overview for a valid project", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "osnova-core-"));
    createdRoots.push(rootPath);

    await createProject({ rootPath, id: "test-project", name: "Test Project" });
    const overview = await getProjectOverview(rootPath);

    expect(overview.manifest?.name).toBe("Test Project");
    expect(overview.validation.valid).toBe(true);
    expect(overview.counts).toEqual({ notes: 0, assets: 0 });
    expect(overview.notes).toEqual([]);
    expect(overview.assets).toEqual([]);
  });

  it("lists markdown notes ordered by update time", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "osnova-core-"));
    createdRoots.push(rootPath);

    const project = await createProject({ rootPath, id: "test-project", name: "Test Project" });
    await createNote(project, { title: "First Note", body: "Body.", tags: ["lecture"] });
    await createNote(project, { title: "Second Note", body: "Body." });

    const notes = await listNotes(rootPath);

    expect(notes).toHaveLength(2);
    expect(notes.map((note) => note.relativePath).sort()).toEqual(["notes/first-note.md", "notes/second-note.md"]);
    expect(notes.find((note) => note.id === "first-note")?.tags).toEqual(["lecture"]);
  });

  it("lists project assets", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "osnova-core-"));
    createdRoots.push(rootPath);

    await createProject({ rootPath, id: "test-project", name: "Test Project" });
    await writeFile(path.join(rootPath, "assets", "diagram.png"), "image", "utf8");
    await mkdir(path.join(rootPath, "assets", "archives"), { recursive: true });
    await writeFile(path.join(rootPath, "assets", "archives", "source.zip"), "zip", "utf8");

    const assets = await listAssets(rootPath);

    expect(assets.map((asset) => asset.relativePath).sort()).toEqual([
      "assets/archives/source.zip",
      "assets/diagram.png"
    ]);
    expect(assets.find((asset) => asset.name === "diagram.png")?.mediaType).toBe("image/png");
  });

  it("returns validation issues for an incomplete project", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "osnova-core-"));
    createdRoots.push(rootPath);

    await writeFile(
      path.join(rootPath, "osnova.json"),
      JSON.stringify({ formatVersion: "0.1", id: "broken", name: "Broken", createdAt: "2026-06-16T00:00:00.000Z" }),
      "utf8"
    );

    const overview = await getProjectOverview(rootPath);

    expect(overview.validation.valid).toBe(false);
    expect(overview.validation.issues.map((issue) => issue.path).sort()).toEqual([".osnova", "assets", "notes"]);
  });
});
