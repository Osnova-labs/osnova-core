import { copyFile, mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import type { AssetSummary, ImportAssetInput, MoveAssetInput, OsnovaProject } from "@osnova/types";
import { normalizeScopeRelativePath, resolveProjectPath, resolveProjectRelativePath, resolveScopedPath, sanitizePathSegment, toProjectRelativePath } from "./path";
import { createUniqueFilePath, listFiles } from "./io";
import { detectMediaType } from "./media";
import { compareUpdatedDesc } from "./utils";
import { isReservedProjectPath } from "./project-files";

export async function listAssets(rootPath: string): Promise<AssetSummary[]> {
  const assetsPath = path.join(rootPath, "assets");
  const [scopedFiles, rootFiles] = await Promise.all([
    listFiles(assetsPath),
    listFiles(
      rootPath,
      (filePath) => !filePath.toLowerCase().endsWith(".md") && !isReservedProjectPath(rootPath, filePath),
      { skipDirectory: (directoryPath) => isReservedProjectPath(rootPath, directoryPath) }
    )
  ]);
  const files = [...scopedFiles, ...rootFiles];
  const assets = await Promise.all(files.map((filePath) => readAssetSummary(rootPath, filePath)));

  return assets.sort(compareUpdatedDesc);
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

export async function moveAsset(project: OsnovaProject, input: MoveAssetInput): Promise<AssetSummary> {
  const sourcePath = resolveAssetPath(project.rootPath, input.sourceRelativePath);
  const targetFolderPath = resolveScopedPath(project.rootPath, "assets", input.targetFolderRelativePath);
  const targetPath = await createUniqueFilePath(targetFolderPath, path.basename(sourcePath));

  await mkdir(targetFolderPath, { recursive: true });
  await rename(sourcePath, targetPath);

  return readAssetSummary(project.rootPath, targetPath);
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

function resolveAssetPath(rootPath: string, assetRelativePath: string): string {
  return assetRelativePath.startsWith("assets/")
    ? resolveProjectRelativePath(rootPath, "assets", assetRelativePath)
    : resolveProjectPath(rootPath, assetRelativePath);
}
