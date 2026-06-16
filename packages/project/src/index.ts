import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createManifest, readManifest, serializeManifest, type CreateManifestInput } from "@osnova/manifest";
import type { AssetSummary, Note, NoteSummary, OsnovaProject, ProjectOverview, ValidationIssue } from "@osnova/types";
import { assertValidManifest, validateManifest, validateProjectStructure } from "@osnova/validation";

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

export async function getProjectOverview(rootPath: string): Promise<ProjectOverview> {
  const issues: ValidationIssue[] = [];
  let manifest: ProjectOverview["manifest"];

  try {
    const candidate = await readManifest(rootPath);
    const manifestValidation = validateManifest(candidate);
    if (manifestValidation.valid) {
      manifest = candidate;
    } else {
      issues.push(...manifestValidation.issues);
    }
  } catch (error) {
    issues.push({ path: "osnova.json", message: getErrorMessage(error) });
  }

  const structureValidation = await validateProjectStructure(rootPath);
  issues.push(...structureValidation.issues);

  const [notes, assets] = await Promise.all([listNotes(rootPath), listAssets(rootPath)]);

  return {
    rootPath,
    manifest,
    validation: {
      valid: issues.length === 0,
      issues
    },
    counts: {
      notes: notes.length,
      assets: assets.length
    },
    recentNotes: notes.slice(0, 5),
    recentAssets: assets.slice(0, 5),
    notes,
    assets
  };
}

export async function listNotes(rootPath: string): Promise<NoteSummary[]> {
  const notesPath = path.join(rootPath, "notes");
  const files = await listFiles(notesPath, (filePath) => filePath.toLowerCase().endsWith(".md"));
  const notes = await Promise.all(
    files.map(async (filePath) => {
      const content = await readFile(filePath, "utf8");
      const fileStat = await stat(filePath);
      const relativePath = toProjectRelativePath(rootPath, filePath);
      const metadata = parseNoteMetadata(content);
      const id = metadata.id ?? path.basename(filePath, path.extname(filePath));
      const title = metadata.title ?? findFirstHeading(content) ?? titleFromFileName(filePath);

      return {
        id,
        title,
        path: filePath,
        relativePath,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt ?? fileStat.mtime.toISOString(),
        tags: metadata.tags
      };
    })
  );

  return notes.sort(compareUpdatedDesc);
}

export async function listAssets(rootPath: string): Promise<AssetSummary[]> {
  const assetsPath = path.join(rootPath, "assets");
  const files = await listFiles(assetsPath);
  const assets = await Promise.all(
    files.map(async (filePath) => {
      const fileStat = await stat(filePath);
      const relativePath = toProjectRelativePath(rootPath, filePath);
      const name = path.basename(filePath);

      return {
        id: relativePath,
        path: filePath,
        relativePath,
        name,
        mediaType: detectMediaType(filePath),
        size: fileStat.size,
        updatedAt: fileStat.mtime.toISOString()
      };
    })
  );

  return assets.sort(compareUpdatedDesc);
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

async function listFiles(rootPath: string, predicate: (filePath: string) => boolean = () => true): Promise<string[]> {
  try {
    const entries = await readdir(rootPath, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(rootPath, entry.name);
        if (entry.isDirectory()) {
          return listFiles(entryPath, predicate);
        }

        if (entry.isFile() && predicate(entryPath)) {
          return [entryPath];
        }

        return [];
      })
    );

    return nested.flat();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function parseNoteMetadata(content: string): Partial<Pick<NoteSummary, "id" | "title" | "createdAt" | "updatedAt" | "tags">> {
  if (!content.startsWith("---\n")) {
    return {};
  }

  const endIndex = content.indexOf("\n---", 4);
  if (endIndex === -1) {
    return {};
  }

  const frontmatter = content.slice(4, endIndex).split("\n");
  const metadata: Partial<Pick<NoteSummary, "id" | "title" | "createdAt" | "updatedAt" | "tags">> = {};

  for (let index = 0; index < frontmatter.length; index += 1) {
    const line = frontmatter[index];
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();

    if (key === "tags" && rawValue.length === 0) {
      const tags: string[] = [];
      while (frontmatter[index + 1]?.trim().startsWith("- ")) {
        index += 1;
        tags.push(frontmatter[index].trim().slice(2).trim());
      }
      metadata.tags = tags.filter(Boolean);
      continue;
    }

    if (key === "id" || key === "title" || key === "createdAt" || key === "updatedAt") {
      metadata[key] = unquoteYamlScalar(rawValue);
    }
  }

  return metadata;
}

function findFirstHeading(content: string): string | undefined {
  const heading = content
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("# "));

  return heading?.replace(/^#\s+/, "").trim() || undefined;
}

function titleFromFileName(filePath: string): string {
  return path.basename(filePath, path.extname(filePath)).replace(/[-_]+/g, " ");
}

function unquoteYamlScalar(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

function toProjectRelativePath(rootPath: string, filePath: string): string {
  return path.relative(rootPath, filePath).split(path.sep).join("/");
}

function compareUpdatedDesc<T extends { updatedAt?: string }>(left: T, right: T): number {
  return Date.parse(right.updatedAt ?? "") - Date.parse(left.updatedAt ?? "");
}

function detectMediaType(filePath: string): string | undefined {
  const extension = path.extname(filePath).toLowerCase();
  const knownTypes: Record<string, string> = {
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".md": "text/markdown",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".zip": "application/zip"
  };

  return knownTypes[extension];
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
