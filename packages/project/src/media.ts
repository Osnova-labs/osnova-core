import path from "node:path";

export function detectMediaType(filePath: string): string | undefined {
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
