import type { NoteSummary } from "@osnova/types";

export function unquoteYamlScalar(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

export function splitFrontmatter(content: string): { frontmatter?: string; body: string } {
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

export function parseNoteMetadata(
  content: string
): Partial<Pick<NoteSummary, "id" | "title" | "createdAt" | "updatedAt" | "tags">> {
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

export function updateFrontmatterTimestamp(content: string, updatedAt: string): string {
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

export function updateFrontmatterFields(content: string, fields: Record<string, string | undefined>, updatedAt: string): string {
  if (!content.startsWith("---\n")) {
    return content;
  }

  const endIndex = content.indexOf("\n---", 4);
  if (endIndex === -1) {
    return content;
  }

  const requestedFields: Record<string, string | undefined> = { ...fields, updatedAt };
  const seen = new Set<string>();
  const frontmatter = content.slice(4, endIndex).split("\n");
  const nextFrontmatter = frontmatter.map((line) => {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      return line;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!(key in requestedFields)) {
      return line;
    }

    seen.add(key);
    return `${key}: ${quoteYamlScalar(requestedFields[key] ?? "")}`;
  });

  for (const [key, value] of Object.entries(requestedFields)) {
    if (!seen.has(key)) {
      nextFrontmatter.push(`${key}: ${quoteYamlScalar(value ?? "")}`);
    }
  }

  return `---\n${nextFrontmatter.join("\n")}${content.slice(endIndex)}`;
}

function quoteYamlScalar(value: string): string {
  return JSON.stringify(value);
}
