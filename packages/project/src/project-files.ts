import { RESERVED_PROJECT_ENTRIES } from "./constants";
import { toProjectRelativePath } from "./path";

export function isReservedProjectPath(rootPath: string, filePath: string): boolean {
  const relativePath = toProjectRelativePath(rootPath, filePath);
  const [firstSegment] = relativePath.split("/");

  return RESERVED_PROJECT_ENTRIES.has(firstSegment);
}

export function isHiddenEntryName(name: string): boolean {
  return name.startsWith(".");
}
