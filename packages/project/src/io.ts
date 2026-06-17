import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { isNodeError } from "./errors";

export async function listFiles(
  rootPath: string,
  predicate: (filePath: string) => boolean = () => true,
  options: { skipDirectory?: (directoryPath: string) => boolean } = {}
): Promise<string[]> {
  try {
    const entries = await readdir(rootPath, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(rootPath, entry.name);
        if (entry.isDirectory()) {
          if (options.skipDirectory?.(entryPath)) {
            return [];
          }

          return listFiles(entryPath, predicate, options);
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

export async function fileExists(filePath: string): Promise<boolean> {
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

export async function createUniqueFilePath(directoryPath: string, fileName: string): Promise<string> {
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
