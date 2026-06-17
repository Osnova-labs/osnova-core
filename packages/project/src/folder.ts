import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import type {
  CreateProjectFolderInput,
  NoteSummary,
  AssetSummary,
  OsnovaProject,
  ProjectTree,
  ProjectTreeNode,
  ProjectTreeScope
} from "@osnova/types";
import {
  joinScopeRelativePath,
  normalizeScopeRelativePath,
  resolveProjectPath,
  resolveScopedPath,
  sanitizePathSegment,
  toProjectPath
} from "./path";
import { isNodeError } from "./errors";
import { listNotes } from "./note";
import { listAssets } from "./asset";
import { isReservedProjectPath } from "./project-files";

export async function createProjectFolder(project: OsnovaProject, input: CreateProjectFolderInput): Promise<ProjectTreeNode> {
  const parentRelativePath = input.parentRelativePath ? normalizeScopeRelativePath(input.parentRelativePath) : "";
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

export async function listProjectTree(rootPath: string): Promise<ProjectTree> {
  const [notes, assets] = await Promise.all([listNotes(rootPath), listAssets(rootPath)]);
  const notesByRelativePath = new Map(notes.map((note) => [note.relativePath, note]));
  const assetsByRelativePath = new Map(assets.map((asset) => [asset.relativePath, asset]));
  const [notesRoot, assetsRoot, looseNotes, looseAssets] = await Promise.all([
    readTreeNode(rootPath, "notes", "", notesByRelativePath, assetsByRelativePath),
    readTreeNode(rootPath, "assets", "", notesByRelativePath, assetsByRelativePath),
    readLooseTreeChildren(rootPath, "notes", "", notesByRelativePath, assetsByRelativePath),
    readLooseTreeChildren(rootPath, "assets", "", notesByRelativePath, assetsByRelativePath)
  ]);

  return {
    notes: { ...notesRoot, children: mergeTreeChildren([...(notesRoot.children ?? []), ...looseNotes]) },
    assets: { ...assetsRoot, children: mergeTreeChildren([...(assetsRoot.children ?? []), ...looseAssets]) }
  };
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
    const nodes: Array<ProjectTreeNode | null> = await Promise.all(
      sortedEntries.map(async (entry): Promise<ProjectTreeNode | null> => {
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

async function readLooseTreeChildren(
  rootPath: string,
  scope: ProjectTreeScope,
  relativePath: string,
  notesByRelativePath: Map<string, NoteSummary>,
  assetsByRelativePath: Map<string, AssetSummary>
): Promise<ProjectTreeNode[]> {
  const directoryPath = resolveProjectPath(rootPath, relativePath);

  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const sortedEntries = entries.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1;
      }
      return left.name.localeCompare(right.name, "ru");
    });
    const nodes: Array<ProjectTreeNode | null> = await Promise.all(
      sortedEntries.map(async (entry): Promise<ProjectTreeNode | null> => {
        const childRelativePath = joinScopeRelativePath(relativePath, entry.name);
        const childPath = resolveProjectPath(rootPath, childRelativePath);

        if (isReservedProjectPath(rootPath, childPath)) {
          return null;
        }

        if (entry.isDirectory()) {
          const children = await readLooseTreeChildren(rootPath, scope, childRelativePath, notesByRelativePath, assetsByRelativePath);
          if (!children.length) {
            return null;
          }

          return {
            id: `${scope}:loose:${childRelativePath}`,
            name: entry.name,
            kind: "directory" as const,
            scope,
            relativePath: childRelativePath,
            projectRelativePath: toProjectPath(scope, childRelativePath),
            path: childPath,
            children
          };
        }

        if (scope === "notes" && entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
          const note = notesByRelativePath.get(childRelativePath);
          if (!note) {
            return null;
          }

          return {
            id: `note:${note.relativePath}`,
            name: note.title,
            kind: "note" as const,
            scope,
            relativePath: childRelativePath,
            projectRelativePath: childRelativePath,
            path: note.path,
            note
          };
        }

        if (scope === "assets" && entry.isFile() && !entry.name.toLowerCase().endsWith(".md")) {
          const asset = assetsByRelativePath.get(childRelativePath);
          if (!asset) {
            return null;
          }

          return {
            id: `asset:${asset.relativePath}`,
            name: asset.name,
            kind: "asset" as const,
            scope,
            relativePath: childRelativePath,
            projectRelativePath: childRelativePath,
            path: asset.path,
            asset
          };
        }

        return null;
      })
    );

    return mergeTreeChildren(nodes.filter((node): node is ProjectTreeNode => Boolean(node)));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function mergeTreeChildren(nodes: ProjectTreeNode[]): ProjectTreeNode[] {
  const directories = new Map<string, ProjectTreeNode>();
  const files: ProjectTreeNode[] = [];

  for (const node of nodes) {
    if (node.kind !== "directory") {
      files.push(node);
      continue;
    }

    const existing = directories.get(node.relativePath);
    if (!existing) {
      directories.set(node.relativePath, node);
      continue;
    }

    directories.set(node.relativePath, {
      ...existing,
      children: mergeTreeChildren([...(existing.children ?? []), ...(node.children ?? [])])
    });
  }

  return [...directories.values(), ...files].sort((left, right) => {
    if (left.kind === "directory" && right.kind !== "directory") {
      return -1;
    }
    if (left.kind !== "directory" && right.kind === "directory") {
      return 1;
    }
    return left.name.localeCompare(right.name, "ru");
  });
}
