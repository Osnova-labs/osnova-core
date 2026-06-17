import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createManifest, readManifest, serializeManifest, type CreateManifestInput } from "@osnova/manifest";
import type {
  AssetSummary,
  CreateProjectFolderInput,
  ImportAssetInput,
  NoteContent,
  NoteSummary,
  OsnovaProject,
  ProjectLink,
  ProjectOverview,
  ProjectTree,
  ProjectTreeNode,
  ProjectTreeScope,
  ValidationIssue
} from "@osnova/types";
import { assertValidManifest, validateManifest, validateProjectStructure } from "@osnova/validation";

export interface CreateProjectInput extends CreateManifestInput {
  rootPath: string;
}

export interface CreateNoteInput {
  title: string;
  body?: string;
  id?: string;
  tags?: string[];
  folderRelativePath?: string;
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
  const notes = await Promise.all(files.map((filePath) => readNoteSummary(rootPath, filePath)));

  return notes.sort(compareUpdatedDesc);
}

export async function listAssets(rootPath: string): Promise<AssetSummary[]> {
  const assetsPath = path.join(rootPath, "assets");
  const files = await listFiles(assetsPath);
  const assets = await Promise.all(files.map((filePath) => readAssetSummary(rootPath, filePath)));

  return assets.sort(compareUpdatedDesc);
}

export async function listProjectTree(rootPath: string): Promise<ProjectTree> {
  const [notes, assets] = await Promise.all([listNotes(rootPath), listAssets(rootPath)]);
  const notesByRelativePath = new Map(notes.map((note) => [note.relativePath, note]));
  const assetsByRelativePath = new Map(assets.map((asset) => [asset.relativePath, asset]));

  return {
    notes: await readTreeNode(rootPath, "notes", "", notesByRelativePath, assetsByRelativePath),
    assets: await readTreeNode(rootPath, "assets", "", notesByRelativePath, assetsByRelativePath)
  };
}

export async function createProjectFolder(project: OsnovaProject, input: CreateProjectFolderInput): Promise<ProjectTreeNode> {
  const parentRelativePath = normalizeScopeRelativePath(input.parentRelativePath ?? "");
  const folderName = sanitizePathSegment(input.name);
  const folderRelativePath = joinScopeRelativePath(parentRelativePath, folderName);
  const folderPath = resolveScopedPath(project.rootPath, input.scope, folderRelativePath);

  await mkdir(folderPath, { recursive: true });

  return {
    id: `${input.scope}:${folderRelativePath}`,
    name: folderName,
    kind: "directory",
    scope: input.scope,
    relativePath: folderRelativePath,
    projectRelativePath: toProjectPath(input.scope, folderRelativePath),
    path: folderPath,
    children: []
  };
}

export async function createNote(project: OsnovaProject, input: CreateNoteInput): Promise<NoteSummary> {
  const folderRelativePath = normalizeScopeRelativePath(input.folderRelativePath ?? "");
  const id = sanitizePathSegment(input.id ?? (slugify(input.title) || "untitled"));
  const notesFolderPath = resolveScopedPath(project.rootPath, "notes", folderRelativePath);
  const notePath = await createUniqueFilePath(notesFolderPath, `${id}.md`);
  const noteId = path.basename(notePath, ".md");
  const now = new Date().toISOString();
  const frontmatter = [
    "---",
    `id: ${noteId}`,
    `title: ${input.title}`,
    `createdAt: ${now}`,
    `updatedAt: ${now}`,
    ...(input.tags?.length ? ["tags:", ...input.tags.map((tag) => `  - ${tag}`)] : []),
    "---"
  ].join("\n");

  await mkdir(notesFolderPath, { recursive: true });
  await writeFile(notePath, `${frontmatter}\n\n# ${input.title}\n\n${input.body ?? ""}\n`, "utf8");

  return readNoteSummary(project.rootPath, notePath);
}

export async function readNote(rootPath: string, noteRelativePath: string): Promise<NoteContent> {
  const notePath = resolveProjectRelativePath(rootPath, "notes", noteRelativePath);
  const content = await readFile(notePath, "utf8");
  const summary = await readNoteSummary(rootPath, notePath);
  const split = splitFrontmatter(content);

  return {
    summary,
    relativePath: summary.relativePath,
    path: notePath,
    content,
    frontmatter: split.frontmatter,
    body: split.body
  };
}

export async function updateNote(rootPath: string, noteRelativePath: string, content: string): Promise<NoteContent> {
  const notePath = resolveProjectRelativePath(rootPath, "notes", noteRelativePath);
  const nextContent = updateFrontmatterTimestamp(content, new Date().toISOString());
  await writeFile(notePath, nextContent, "utf8");
  return readNote(rootPath, noteRelativePath);
}

export async function importAsset(project: OsnovaProject, input: ImportAssetInput): Promise<AssetSummary> {
  const targetFolderRelativePath = normalizeScopeRelativePath(input.targetFolderRelativePath ?? "");
  const sourceName = sanitizePathSegment(path.basename(input.sourcePath));
  const targetFolderPath = resolveScopedPath(project.rootPath, "assets", targetFolderRelativePath);
  const targetPath = await createUniqueFilePath(targetFolderPath, sourceName);

  await mkdir(targetFolderPath, { recursive: true });
  await copyFile(input.sourcePath, targetPath);

  return readAssetSummary(project.rootPath, targetPath);
}

export async function listProjectLinks(rootPath: string): Promise<ProjectLink[]> {
  const [notes, assets] = await Promise.all([listNotes(rootPath), listAssets(rootPath)]);
  const notesByRelativePath = new Map(notes.map((note) => [note.relativePath.toLowerCase(), note]));
  const notesByTitle = new Map(notes.map((note) => [note.title.toLowerCase(), note]));
  const assetsByRelativePath = new Map(assets.map((asset) => [asset.relativePath.toLowerCase(), asset]));
  const links: ProjectLink[] = [];

  await Promise.all(
    notes.map(async (note) => {
      const content = await readFile(note.path, "utf8");
      links.push(...findWikiLinks(note, content, notesByRelativePath, notesByTitle));
      links.push(...findAssetLinks(note, content, assetsByRelativePath));
    })
  );

  return links;
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function readTreeNode(
  rootPath: string,
  scope: ProjectTreeScope,
  relativePath: string,
  notesByRelativePath: Map<string, NoteSummary>,
  assetsByRelativePath: Map<string, AssetSummary>
): Promise<ProjectTreeNode> {
  const nodePath = resolveScopedPath(rootPath, scope, relativePath);
  const projectRelativePath = toProjectPath(scope, relativePath);
  const name = relativePath ? path.posix.basename(relativePath) : scope;
  const children = await readTreeChildren(rootPath, scope, relativePath, notesByRelativePath, assetsByRelativePath);

  return {
    id: `${scope}:${relativePath || scope}`,
    name,
    kind: "directory",
    scope,
    relativePath,
    projectRelativePath,
    path: nodePath,
    children
  };
}

async function readTreeChildren(
  rootPath: string,
  scope: ProjectTreeScope,
  relativePath: string,
  notesByRelativePath: Map<string, NoteSummary>,
  assetsByRelativePath: Map<string, AssetSummary>
): Promise<ProjectTreeNode[]> {
  const directoryPath = resolveScopedPath(rootPath, scope, relativePath);

  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const sortedEntries = entries.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1;
      }
      return left.name.localeCompare(right.name, "ru");
    });
    const nodes = await Promise.all(
      sortedEntries.map(async (entry) => {
        const childRelativePath = joinScopeRelativePath(relativePath, entry.name);
        const projectRelativePath = toProjectPath(scope, childRelativePath);

        if (entry.isDirectory()) {
          return readTreeNode(rootPath, scope, childRelativePath, notesByRelativePath, assetsByRelativePath);
        }

        if (scope === "notes" && entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
          const note = notesByRelativePath.get(projectRelativePath);
          if (!note) {
            return null;
          }

          return {
            id: `note:${note.relativePath}`,
            name: note.title,
            kind: "note" as const,
            scope,
            relativePath: childRelativePath,
            projectRelativePath,
            path: note.path,
            note
          };
        }

        if (scope === "assets" && entry.isFile()) {
          const asset = assetsByRelativePath.get(projectRelativePath);
          if (!asset) {
            return null;
          }

          return {
            id: `asset:${asset.relativePath}`,
            name: asset.name,
            kind: "asset" as const,
            scope,
            relativePath: childRelativePath,
            projectRelativePath,
            path: asset.path,
            asset
          };
        }

        return null;
      })
    );

    return nodes.filter((node): node is ProjectTreeNode => Boolean(node));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
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

async function readNoteSummary(rootPath: string, filePath: string): Promise<NoteSummary> {
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
}

async function readAssetSummary(rootPath: string, filePath: string): Promise<AssetSummary> {
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
}

async function createUniqueFilePath(directoryPath: string, fileName: string): Promise<string> {
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);
  let candidate = path.join(directoryPath, fileName);
  let index = 2;

  while (await fileExists(candidate)) {
    candidate = path.join(directoryPath, `${baseName}-${index}${extension}`);
    index += 1;
  }

  return candidate;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

function findWikiLinks(
  sourceNote: NoteSummary,
  content: string,
  notesByRelativePath: Map<string, NoteSummary>,
  notesByTitle: Map<string, NoteSummary>
): ProjectLink[] {
  const links: ProjectLink[] = [];
  const regex = /\[\[([^\]]+)]]/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content))) {
    const [raw, body] = match;
    const [rawTarget, label] = body.split("|").map((part) => part.trim());
    const target = resolveWikiTarget(rawTarget, notesByRelativePath, notesByTitle);

    links.push({
      id: `${sourceNote.relativePath}:wiki:${match.index}`,
      kind: "wiki",
      sourceNoteRelativePath: sourceNote.relativePath,
      rawTarget,
      label: label || undefined,
      resolved: Boolean(target),
      targetRelativePath: target?.relativePath,
      note: target
    });
  }

  return links;
}

function findAssetLinks(
  sourceNote: NoteSummary,
  content: string,
  assetsByRelativePath: Map<string, AssetSummary>
): ProjectLink[] {
  const links: ProjectLink[] = [];
  const regex = /!?\[([^\]]*)]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content))) {
    const [, label, rawTarget] = match;
    const targetWithoutFragment = rawTarget.split("#")[0].trim();
    if (!targetWithoutFragment.startsWith("assets/")) {
      continue;
    }

    const asset = assetsByRelativePath.get(normalizeProjectRelativePath(targetWithoutFragment).toLowerCase());

    links.push({
      id: `${sourceNote.relativePath}:asset:${match.index}`,
      kind: "asset",
      sourceNoteRelativePath: sourceNote.relativePath,
      rawTarget,
      label: label || undefined,
      resolved: Boolean(asset),
      targetRelativePath: asset?.relativePath ?? targetWithoutFragment,
      asset
    });
  }

  return links;
}

function resolveWikiTarget(
  rawTarget: string,
  notesByRelativePath: Map<string, NoteSummary>,
  notesByTitle: Map<string, NoteSummary>
): NoteSummary | undefined {
  const target = rawTarget.split("#")[0].trim();
  if (!target) {
    return undefined;
  }

  const byTitle = notesByTitle.get(target.toLowerCase());
  if (byTitle) {
    return byTitle;
  }

  const normalizedTarget = normalizeProjectRelativePath(
    target.startsWith("notes/") ? ensureMarkdownExtension(target) : `notes/${ensureMarkdownExtension(target)}`
  ).toLowerCase();

  return notesByRelativePath.get(normalizedTarget) ?? notesByRelativePath.get(`notes/${slugify(target)}.md`.toLowerCase());
}

function ensureMarkdownExtension(value: string): string {
  return value.toLowerCase().endsWith(".md") ? value : `${value}.md`;
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

function splitFrontmatter(content: string): { frontmatter?: string; body: string } {
  if (!content.startsWith("---\n")) {
    return { body: content };
  }

  const endIndex = content.indexOf("\n---", 4);
  if (endIndex === -1) {
    return { body: content };
  }

  const bodyStart = endIndex + "\n---".length;
  return {
    frontmatter: content.slice(4, endIndex),
    body: content.slice(bodyStart).replace(/^\n/, "")
  };
}

function updateFrontmatterTimestamp(content: string, updatedAt: string): string {
  if (!content.startsWith("---\n")) {
    return content;
  }

  const endIndex = content.indexOf("\n---", 4);
  if (endIndex === -1) {
    return content;
  }

  const frontmatter = content.slice(4, endIndex).split("\n");
  const nextFrontmatter = frontmatter.some((line) => line.startsWith("updatedAt:"))
    ? frontmatter.map((line) => (line.startsWith("updatedAt:") ? `updatedAt: ${updatedAt}` : line))
    : [...frontmatter, `updatedAt: ${updatedAt}`];

  return `---\n${nextFrontmatter.join("\n")}${content.slice(endIndex)}`;
}

function findFirstHeading(content: string): string | undefined {
  const heading = splitFrontmatter(content)
    .body.split("\n")
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

function sanitizePathSegment(value: string): string {
  const segment = value.trim().replace(/[\\/]+/g, "-");
  if (!segment || segment === "." || segment === "..") {
    throw new Error("Invalid project path segment.");
  }

  return segment;
}

function normalizeScopeRelativePath(value: string): string {
  const normalized = normalizeProjectRelativePath(value);
  if (normalized.startsWith("notes/") || normalized.startsWith("assets/")) {
    throw new Error("Scope-relative paths must not include project root folder.");
  }

  return normalized;
}

function normalizeProjectRelativePath(value: string): string {
  const input = value.replace(/\\/g, "/").trim();
  if (!input || input === ".") {
    return "";
  }

  if (input.startsWith("/")) {
    throw new Error("Absolute project paths are not allowed.");
  }

  const parts = input.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error("Path traversal is not allowed.");
  }

  return path.posix.normalize(parts.join("/"));
}

function resolveProjectRelativePath(rootPath: string, scope: ProjectTreeScope, projectRelativePath: string): string {
  const normalized = normalizeProjectRelativePath(projectRelativePath);
  if (!normalized.startsWith(`${scope}/`)) {
    throw new Error(`Project path must be inside ${scope}/.`);
  }

  return resolveScopedPath(rootPath, scope, normalized.slice(scope.length + 1));
}

function resolveScopedPath(rootPath: string, scope: ProjectTreeScope, relativePath: string): string {
  const basePath = path.resolve(rootPath, scope);
  const normalizedRelativePath = normalizeScopeRelativePath(relativePath);
  const absolutePath = normalizedRelativePath
    ? path.resolve(basePath, ...normalizedRelativePath.split("/"))
    : basePath;

  if (absolutePath !== basePath && !absolutePath.startsWith(`${basePath}${path.sep}`)) {
    throw new Error(`Resolved path must stay inside ${scope}/.`);
  }

  return absolutePath;
}

function joinScopeRelativePath(parentRelativePath: string, name: string): string {
  return normalizeScopeRelativePath([parentRelativePath, name].filter(Boolean).join("/"));
}

function toProjectRelativePath(rootPath: string, filePath: string): string {
  return path.relative(rootPath, filePath).split(path.sep).join("/");
}

function toProjectPath(scope: ProjectTreeScope, relativePath: string): string {
  return relativePath ? `${scope}/${relativePath}` : scope;
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
