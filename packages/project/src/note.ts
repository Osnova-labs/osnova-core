import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MoveNoteInput, NoteContent, NoteSummary, OsnovaProject, UpdateNoteDocumentInput } from "@osnova/types";
import { slugify } from "./slug";
import {
  normalizeScopeRelativePath,
  resolveProjectPath,
  resolveProjectRelativePath,
  resolveScopedPath,
  sanitizePathSegment,
  toProjectRelativePath
} from "./path";
import { createUniqueFilePath, listFiles } from "./io";
import { compareUpdatedDesc } from "./utils";
import { parseNoteMetadata, splitFrontmatter, unquoteYamlScalar, updateFrontmatterFields, updateFrontmatterTimestamp } from "./frontmatter";
import { isReservedProjectPath } from "./project-files";

export interface CreateNoteInput {
  title: string;
  body?: string;
  id?: string;
  tags?: string[];
  folderRelativePath?: string;
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
  await writeFile(notePath, `${frontmatter}\n\n${stripDuplicateTitleHeading(input.body ?? "", input.title)}`, "utf8");

  return readNoteSummary(project.rootPath, notePath);
}

export async function readNote(rootPath: string, noteRelativePath: string): Promise<NoteContent> {
  const notePath = resolveNotePath(rootPath, noteRelativePath);
  const content = await readFile(notePath, "utf8");
  const summary = await readNoteSummary(rootPath, notePath);
  const split = splitFrontmatter(content);

  return {
    summary,
    relativePath: summary.relativePath,
    path: notePath,
    content,
    frontmatter: split.frontmatter,
    body: stripDuplicateTitleHeading(split.body, summary.title)
  };
}

export async function updateNote(rootPath: string, noteRelativePath: string, content: string): Promise<NoteContent> {
  const notePath = resolveNotePath(rootPath, noteRelativePath);
  const nextContent = updateFrontmatterTimestamp(content, new Date().toISOString());
  await writeFile(notePath, nextContent, "utf8");
  return readNote(rootPath, noteRelativePath);
}

export async function updateNoteDocument(
  rootPath: string,
  noteRelativePath: string,
  input: UpdateNoteDocumentInput
): Promise<NoteContent> {
  const notePath = resolveNotePath(rootPath, noteRelativePath);
  const currentContent = await readFile(notePath, "utf8");
  const currentSummary = await readNoteSummary(rootPath, notePath);
  const currentParts = splitFrontmatter(currentContent);
  const nextTitle = input.title?.trim() || currentSummary.title;
  const nextBody = stripDuplicateTitleHeading(
    stripDuplicateTitleHeading(input.body ?? currentParts.body, currentSummary.title),
    nextTitle
  );
  const nextContent = currentParts.frontmatter
    ? updateFrontmatterFields(replaceNoteBody(currentContent, nextBody), { title: nextTitle }, new Date().toISOString())
    : `---\nid: ${currentSummary.id}\ntitle: ${JSON.stringify(nextTitle)}\ncreatedAt: ${currentSummary.createdAt ?? new Date().toISOString()}\nupdatedAt: ${new Date().toISOString()}\n---\n\n${nextBody}`;

  await writeFile(notePath, nextContent, "utf8");
  return readNote(rootPath, noteRelativePath);
}

export async function listNotes(rootPath: string): Promise<NoteSummary[]> {
  const notesPath = path.join(rootPath, "notes");
  const [scopedFiles, rootFiles] = await Promise.all([
    listFiles(notesPath, (filePath) => filePath.toLowerCase().endsWith(".md")),
    listFiles(
      rootPath,
      (filePath) => filePath.toLowerCase().endsWith(".md") && !isReservedProjectPath(rootPath, filePath),
      { skipDirectory: (directoryPath) => isReservedProjectPath(rootPath, directoryPath) }
    )
  ]);
  const files = [...scopedFiles, ...rootFiles];
  const notes = await Promise.all(files.map((filePath) => readNoteSummary(rootPath, filePath)));

  return notes.sort(compareUpdatedDesc);
}

export async function moveNote(project: OsnovaProject, input: MoveNoteInput): Promise<NoteSummary> {
  const sourcePath = resolveNotePath(project.rootPath, input.sourceRelativePath);
  const targetFolderPath = resolveScopedPath(project.rootPath, "notes", input.targetFolderRelativePath);
  const targetPath = await createUniqueFilePath(targetFolderPath, path.basename(sourcePath));

  await mkdir(targetFolderPath, { recursive: true });
  await rename(sourcePath, targetPath);

  return readNoteSummary(project.rootPath, targetPath);
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

function resolveNotePath(rootPath: string, noteRelativePath: string): string {
  return noteRelativePath.startsWith("notes/")
    ? resolveProjectRelativePath(rootPath, "notes", noteRelativePath)
    : resolveProjectPath(rootPath, noteRelativePath);
}

function replaceNoteBody(content: string, body: string): string {
  if (!content.startsWith("---\n")) {
    return body;
  }

  const endIndex = content.indexOf("\n---", 4);
  if (endIndex === -1) {
    return body;
  }

  const bodyPrefixEnd = endIndex + "\n---".length;
  const lineBreak = content[bodyPrefixEnd] === "\n" ? "\n" : "";
  return `${content.slice(0, bodyPrefixEnd)}${lineBreak}${body}`;
}

function stripDuplicateTitleHeading(body: string, title: string): string {
  const lines = body.split("\n");
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentIndex === -1) {
    return body;
  }

  const headingTitle = parseLevelOneHeading(lines[firstContentIndex]);
  if (!headingTitle || normalizeTitle(headingTitle) !== normalizeTitle(title)) {
    return body;
  }

  let nextContentIndex = firstContentIndex + 1;
  while (lines[nextContentIndex]?.trim() === "") {
    nextContentIndex += 1;
  }

  return lines.slice(nextContentIndex).join("\n");
}

function parseLevelOneHeading(line: string): string | undefined {
  const match = line.trim().match(/^#\s+(.+?)(?:\s+#*)?$/);
  return match?.[1]?.trim();
}

function normalizeTitle(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}
