import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createManifest, readManifest, serializeManifest, type CreateManifestInput } from "@osnova/manifest";
import type { Note, OsnovaProject } from "@osnova/types";
import { assertValidManifest, validateProjectStructure } from "@osnova/validation";

export interface CreateProjectInput extends CreateManifestInput {
  rootPath: string;
}

export interface CreateNoteInput {
  title: string;
  body?: string;
  id?: string;
  tags?: string[];
}

export async function createProject(input: CreateProjectInput): Promise<OsnovaProject> {
  const manifest = createManifest(input);

  await mkdir(input.rootPath, { recursive: true });
  await Promise.all([
    mkdir(path.join(input.rootPath, "notes"), { recursive: true }),
    mkdir(path.join(input.rootPath, "assets"), { recursive: true }),
    mkdir(path.join(input.rootPath, ".osnova"), { recursive: true })
  ]);

  await writeFile(path.join(input.rootPath, "osnova.json"), serializeManifest(manifest), "utf8");

  return { rootPath: input.rootPath, manifest };
}

export async function openProject(rootPath: string): Promise<OsnovaProject> {
  const manifest = await readManifest(rootPath);
  assertValidManifest(manifest);

  const structure = await validateProjectStructure(rootPath);
  if (!structure.valid) {
    throw new Error(structure.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
  }

  return { rootPath, manifest };
}

export async function createNote(project: OsnovaProject, input: CreateNoteInput): Promise<Note> {
  const id = input.id ?? slugify(input.title);
  const notePath = path.join(project.rootPath, "notes", `${id}.md`);
  const now = new Date().toISOString();
  const frontmatter = [
    "---",
    `id: ${id}`,
    `title: ${input.title}`,
    `createdAt: ${now}`,
    `updatedAt: ${now}`,
    ...(input.tags?.length ? ["tags:", ...input.tags.map((tag) => `  - ${tag}`)] : []),
    "---"
  ].join("\n");

  await writeFile(notePath, `${frontmatter}\n\n# ${input.title}\n\n${input.body ?? ""}\n`, "utf8");

  return {
    id,
    title: input.title,
    path: notePath,
    createdAt: now,
    updatedAt: now,
    tags: input.tags
  };
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
