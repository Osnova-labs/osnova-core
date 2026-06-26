import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createNote,
  createProject,
  createProjectFolder,
  getProjectOverview,
  importAsset,
  listAssets,
  listNotes,
  listProjectLinks,
  listProjectTree,
  moveProjectFolder,
  openProject,
  readNote,
  updateNote,
  updateNoteDocument
} from "./index";

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
    expect(content).toContain("title: First Note");
    expect(content).not.toContain("# First Note");
    expect(content).toContain("Body.");
  });

  it("creates folders and notes inside nested project folders", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "osnova-core-"));
    createdRoots.push(rootPath);

    const project = await createProject({ rootPath, id: "test-project", name: "Test Project" });
    await createProjectFolder(project, { scope: "notes", name: "Lectures" });
    const note = await createNote(project, { title: "Nested Note", body: "Body.", folderRelativePath: "Lectures" });

    expect(note.relativePath).toBe("notes/Lectures/nested-note.md");
    await expect(createProjectFolder(project, { scope: "notes", parentRelativePath: "../outside", name: "Bad" })).rejects.toThrow(
      "Path traversal"
    );
  });

  it("reads and updates note content", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "osnova-core-"));
    createdRoots.push(rootPath);

    const project = await createProject({ rootPath, id: "test-project", name: "Test Project" });
    const note = await createNote(project, { title: "Editable Note", body: "Draft." });
    const content = await readNote(rootPath, note.relativePath);

    expect(content.body).toContain("Draft.");

    const updated = await updateNote(rootPath, note.relativePath, content.content.replace("Draft.", "Published."));
    const raw = await readFile(note.path, "utf8");

    expect(updated.body).toContain("Published.");
    expect(raw).toContain("updatedAt:");
  });

  it("updates note document metadata and body without exposing frontmatter to the editor body", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "osnova-core-"));
    createdRoots.push(rootPath);

    const project = await createProject({ rootPath, id: "test-project", name: "Test Project" });
    const note = await createNote(project, { title: "Old Title", body: "Body." });
    const content = await readNote(rootPath, note.relativePath);
    const updated = await updateNoteDocument(rootPath, note.relativePath, {
      title: "New Title",
      body: content.body.replace("Body.", "Updated body.")
    });
    const raw = await readFile(note.path, "utf8");

    expect(updated.summary.title).toBe("New Title");
    expect(updated.body).not.toContain("# New Title");
    expect(updated.body).toContain("Updated body.");
    expect(raw).toContain('title: "New Title"');
  });

  it("hides a duplicate first heading from legacy note bodies", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "osnova-core-"));
    createdRoots.push(rootPath);

    await createProject({ rootPath, id: "test-project", name: "Test Project" });
    await writeFile(
      path.join(rootPath, "notes", "legacy.md"),
      [
        "---",
        "id: legacy",
        "title: Legacy Note",
        "createdAt: 2026-06-17T00:00:00.000Z",
        "updatedAt: 2026-06-17T00:00:00.000Z",
        "---",
        "",
        "# Legacy Note",
        "",
        "Body."
      ].join("\n"),
      "utf8"
    );

    const content = await readNote(rootPath, "notes/legacy.md");
    const updated = await updateNoteDocument(rootPath, "notes/legacy.md", {
      title: "Renamed Note",
      body: content.body
    });
    const raw = await readFile(path.join(rootPath, "notes", "legacy.md"), "utf8");

    expect(content.body).toBe("Body.");
    expect(updated.body).toBe("Body.");
    expect(raw).not.toContain("# Legacy Note");
    expect(raw).not.toContain("# Renamed Note");
    expect(raw).toContain('title: "Renamed Note"');
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

  it("imports assets and creates unique names on conflict", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "osnova-core-"));
    const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "osnova-source-"));
    createdRoots.push(rootPath, sourceRoot);

    const sourcePath = path.join(sourceRoot, "diagram.png");
    await writeFile(sourcePath, "image", "utf8");
    const project = await createProject({ rootPath, id: "test-project", name: "Test Project" });

    const firstAsset = await importAsset(project, { sourcePath, targetFolderRelativePath: "images" });
    const secondAsset = await importAsset(project, { sourcePath, targetFolderRelativePath: "images" });

    expect(firstAsset.relativePath).toBe("assets/images/diagram.png");
    expect(secondAsset.relativePath).toBe("assets/images/diagram-2.png");
  });

  it("returns a stable project tree for notes and assets", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "osnova-core-"));
    createdRoots.push(rootPath);

    const project = await createProject({ rootPath, id: "test-project", name: "Test Project" });
    await createProjectFolder(project, { scope: "notes", name: "Lectures" });
    await createNote(project, { title: "Tree Note", folderRelativePath: "Lectures" });
    await mkdir(path.join(rootPath, "assets", "images"), { recursive: true });
    await writeFile(path.join(rootPath, "assets", "images", "diagram.png"), "image", "utf8");

    const tree = await listProjectTree(rootPath);

    expect(tree.notes.children?.[0].name).toBe("Lectures");
    expect(tree.notes.children?.[0].children?.[0].projectRelativePath).toBe("notes/Lectures/tree-note.md");
    expect(tree.assets.children?.[0].children?.[0].projectRelativePath).toBe("assets/images/diagram.png");
  });

  it("lists existing root markdown notes and files after adopting a folder", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "osnova-core-"));
    createdRoots.push(rootPath);

    await createProject({ rootPath, id: "test-project", name: "Test Project" });
    await writeFile(path.join(rootPath, "Root Note.md"), "# Root Note\n\nBody.", "utf8");
    await mkdir(path.join(rootPath, "Nested"), { recursive: true });
    await writeFile(path.join(rootPath, "Nested", "Nested Note.md"), "# Nested Note\n\nBody.", "utf8");
    await writeFile(path.join(rootPath, "Nested", "image.png"), "image", "utf8");

    const [notes, assets, tree, rootNote] = await Promise.all([
      listNotes(rootPath),
      listAssets(rootPath),
      listProjectTree(rootPath),
      readNote(rootPath, "Root Note.md")
    ]);

    expect(notes.map((note) => note.relativePath).sort()).toEqual(["Nested/Nested Note.md", "Root Note.md"]);
    expect(assets.map((asset) => asset.relativePath)).toEqual(["Nested/image.png"]);
    expect(rootNote.summary.title).toBe("Root Note");
    expect(rootNote.body).toBe("Body.");
    expect(tree.notes.children?.find((node) => node.projectRelativePath === "Root Note.md")?.kind).toBe("note");
    expect(
      tree.assets.children
        ?.find((node) => node.name === "Nested")
        ?.children?.find((node) => node.projectRelativePath === "Nested/image.png")?.kind
    ).toBe("asset");
  });

  it("hides dotfiles and dot directories from notes, assets and tree", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "osnova-core-"));
    createdRoots.push(rootPath);

    const project = await createProject({ rootPath, id: "test-project", name: "Test Project" });
    await mkdir(path.join(rootPath, ".obsidian"), { recursive: true });
    await writeFile(path.join(rootPath, ".obsidian", "workspace.json"), "{}", "utf8");
    await writeFile(path.join(rootPath, ".obsidian", "hidden.md"), "# Hidden\n\nBody.", "utf8");
    await writeFile(path.join(rootPath, ".DS_Store"), "store", "utf8");
    await mkdir(path.join(rootPath, "notes", ".drafts"), { recursive: true });
    await writeFile(path.join(rootPath, "notes", ".drafts", "draft.md"), "# Draft\n\nBody.", "utf8");
    await createNote(project, { title: "Visible Note", body: "Body." });

    const [notes, assets, tree] = await Promise.all([
      listNotes(rootPath),
      listAssets(rootPath),
      listProjectTree(rootPath)
    ]);

    expect(notes.map((note) => note.relativePath)).toEqual(["notes/visible-note.md"]);
    expect(assets.map((asset) => asset.name)).not.toContain(".DS_Store");
    expect(assets.find((asset) => asset.relativePath.includes(".obsidian"))).toBeUndefined();
    expect(tree.notes.children?.find((node) => node.name === ".drafts")).toBeUndefined();
    expect(tree.assets.children?.find((node) => node.name === ".obsidian")).toBeUndefined();
  });

  it("lists resolved and unresolved project links", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "osnova-core-"));
    createdRoots.push(rootPath);

    const project = await createProject({ rootPath, id: "test-project", name: "Test Project" });
    await createNote(project, { title: "Target Note", body: "Target." });
    await writeFile(path.join(rootPath, "assets", "diagram.png"), "image", "utf8");
    await createNote(project, {
      title: "Source Note",
      body: "[[Target Note]]\n[[Missing Note]]\n[diagram](assets/diagram.png)"
    });

    const links = await listProjectLinks(rootPath);

    expect(links.find((link) => link.rawTarget === "Target Note")?.resolved).toBe(true);
    expect(links.find((link) => link.rawTarget === "Missing Note")?.resolved).toBe(false);
    expect(links.find((link) => link.rawTarget === "assets/diagram.png")?.resolved).toBe(true);
  });

  it("does not fail project links on traversal-like existing vault links", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "osnova-core-"));
    createdRoots.push(rootPath);

    const project = await createProject({ rootPath, id: "test-project", name: "Test Project" });
    await writeFile(path.join(rootPath, "Root Target.md"), "# Root Target\n\nBody.", "utf8");
    await createNote(project, {
      title: "Source Note",
      body: "[[Root Target]]\n[[../Outside]]\n[bad](assets/../secret.png)"
    });

    const links = await listProjectLinks(rootPath);

    expect(links.find((link) => link.rawTarget === "Root Target")?.resolved).toBe(true);
    expect(links.find((link) => link.rawTarget === "../Outside")?.resolved).toBe(false);
    expect(links.find((link) => link.rawTarget === "assets/../secret.png")?.resolved).toBe(false);
  });

  it("moves project folders across scopes and rejects moving into itself", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "osnova-core-"));
    createdRoots.push(rootPath);

    const project = await createProject({ rootPath, id: "test-project", name: "Test Project" });
    await createProjectFolder(project, { scope: "notes", name: "Lectures" });
    await createNote(project, { title: "L1", body: "Body.", folderRelativePath: "Lectures" });
    await createProjectFolder(project, { scope: "notes", name: "Archive" });
    await mkdir(path.join(rootPath, "assets", "Lectures"), { recursive: true });
    await writeFile(path.join(rootPath, "assets", "Lectures", "diagram.png"), "image", "utf8");

    await moveProjectFolder(project, { sourceRelativePath: "Lectures", targetFolderRelativePath: "Archive" });

    const tree = await listProjectTree(rootPath);
    const archiveDir = tree.notes.children?.find((n) => n.name === "Archive");
    expect(archiveDir?.children?.find((n) => n.name === "Lectures")).toBeTruthy();
    expect(archiveDir?.children?.find((n) => n.name === "Lectures")?.children?.[0].name).toBe("L1");

    const assetsArchive = tree.assets.children?.find((n) => n.name === "Archive");
    expect(assetsArchive?.children?.find((n) => n.name === "Lectures")).toBeTruthy();

    await expect(
      moveProjectFolder(project, { sourceRelativePath: "Archive", targetFolderRelativePath: "Archive/Lectures" })
    ).rejects.toThrow("Cannot move folder into itself");
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
