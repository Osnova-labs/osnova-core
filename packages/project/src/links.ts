import { readFile } from "node:fs/promises";
import type { AssetSummary, NoteSummary, ProjectLink } from "@osnova/types";
import { listNotes } from "./note";
import { listAssets } from "./asset";
import { normalizeProjectRelativePath } from "./path";
import { slugify } from "./slug";

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

    const normalizedTarget = normalizeProjectRelativePathSafe(targetWithoutFragment);
    const asset = normalizedTarget ? assetsByRelativePath.get(normalizedTarget.toLowerCase()) : undefined;

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

  const normalizedScopedTarget = normalizeProjectRelativePathSafe(
    target.startsWith("notes/") ? ensureMarkdownExtension(target) : `notes/${ensureMarkdownExtension(target)}`
  )?.toLowerCase();
  const normalizedRootTarget = normalizeProjectRelativePathSafe(ensureMarkdownExtension(target))?.toLowerCase();
  if (!normalizedRootTarget && !normalizedScopedTarget) {
    return undefined;
  }

  const slugTarget = `${slugify(target)}.md`.toLowerCase();

  return (
    (normalizedRootTarget ? notesByRelativePath.get(normalizedRootTarget) : undefined) ??
    (normalizedScopedTarget ? notesByRelativePath.get(normalizedScopedTarget) : undefined) ??
    notesByRelativePath.get(`notes/${slugTarget}`) ??
    notesByRelativePath.get(slugTarget)
  );
}

function ensureMarkdownExtension(value: string): string {
  return value.toLowerCase().endsWith(".md") ? value : `${value}.md`;
}

function normalizeProjectRelativePathSafe(value: string): string | undefined {
  try {
    return normalizeProjectRelativePath(value);
  } catch {
    return undefined;
  }
}
