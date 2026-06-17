import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createManifest, readManifest, serializeManifest, type CreateManifestInput } from "@osnova/manifest";
import type { OsnovaProject, ProjectOverview, ValidationIssue } from "@osnova/types";
import { assertValidManifest, validateManifest, validateProjectStructure } from "@osnova/validation";
import { getErrorMessage } from "./errors";
import { listNotes } from "./note";
import { listAssets } from "./asset";
import { ASSETS_DIR, MANIFEST_FILE, NOTES_DIR, OSNOVA_DIR } from "./constants";

export interface CreateProjectInput extends CreateManifestInput {
  rootPath: string;
}

export async function createProject(input: CreateProjectInput): Promise<OsnovaProject> {
  const manifest = createManifest(input);

  await mkdir(input.rootPath, { recursive: true });
  await Promise.all([
    mkdir(path.join(input.rootPath, NOTES_DIR), { recursive: true }),
    mkdir(path.join(input.rootPath, ASSETS_DIR), { recursive: true }),
    mkdir(path.join(input.rootPath, OSNOVA_DIR), { recursive: true })
  ]);

  await writeFile(path.join(input.rootPath, MANIFEST_FILE), serializeManifest(manifest), "utf8");

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
    issues.push({ path: MANIFEST_FILE, message: getErrorMessage(error) });
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
