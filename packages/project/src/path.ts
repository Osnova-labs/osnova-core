import path from "node:path";
import type { ProjectTreeScope } from "@osnova/types";
import { ASSETS_DIR, NOTES_DIR } from "./constants";

export function sanitizePathSegment(value: string): string {
  const segment = value.trim().replace(/[\\/]+/g, "-");
  if (!segment || segment === "." || segment === "..") {
    throw new Error("Invalid project path segment.");
  }

  return segment;
}

export function normalizeProjectRelativePath(value: string): string {
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

export function normalizeScopeRelativePath(value: string): string {
  const normalized = normalizeProjectRelativePath(value);
  if (normalized.startsWith(`${NOTES_DIR}/`) || normalized.startsWith(`${ASSETS_DIR}/`)) {
    throw new Error("Scope-relative paths must not include project root folder.");
  }

  return normalized;
}

export function resolveScopedPath(rootPath: string, scope: ProjectTreeScope, relativePath: string): string {
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

export function resolveProjectRelativePath(rootPath: string, scope: ProjectTreeScope, projectRelativePath: string): string {
  const normalized = normalizeProjectRelativePath(projectRelativePath);
  if (!normalized.startsWith(`${scope}/`)) {
    throw new Error(`Project path must be inside ${scope}/.`);
  }

  return resolveScopedPath(rootPath, scope, normalized.slice(scope.length + 1));
}

export function resolveProjectPath(rootPath: string, projectRelativePath: string): string {
  const basePath = path.resolve(rootPath);
  const normalizedRelativePath = normalizeProjectRelativePath(projectRelativePath);
  const absolutePath = normalizedRelativePath
    ? path.resolve(basePath, ...normalizedRelativePath.split("/"))
    : basePath;

  if (absolutePath !== basePath && !absolutePath.startsWith(`${basePath}${path.sep}`)) {
    throw new Error("Resolved path must stay inside project root.");
  }

  return absolutePath;
}

export function joinScopeRelativePath(parentRelativePath: string, name: string): string {
  return normalizeScopeRelativePath([parentRelativePath, name].filter(Boolean).join("/"));
}

export function toProjectRelativePath(rootPath: string, filePath: string): string {
  return path.relative(rootPath, filePath).split(path.sep).join("/");
}

export function toProjectPath(scope: ProjectTreeScope, relativePath: string): string {
  return relativePath ? `${scope}/${relativePath}` : scope;
}
