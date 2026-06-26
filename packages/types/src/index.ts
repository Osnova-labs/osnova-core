export type ProjectKind = "general" | "subject" | "exam";

export interface SubjectMetadata {
  name?: string;
  grade?: string;
  institution?: string;
}

export interface ExamMetadata {
  name?: string;
  date?: string;
  targetScore?: number;
}

export interface OsnovaManifest {
  formatVersion: "0.1";
  id: string;
  name: string;
  description?: string;
  kind?: ProjectKind;
  createdAt: string;
  updatedAt?: string;
  locale?: string;
  tags?: string[];
  subject?: SubjectMetadata;
  exam?: ExamMetadata;
}

export interface OsnovaProject {
  rootPath: string;
  manifest: OsnovaManifest;
}

export interface Note {
  id: string;
  title: string;
  path: string;
  createdAt?: string;
  updatedAt?: string;
  tags?: string[];
}

export interface NoteSummary extends Note {
  relativePath: string;
}

export interface NoteContent {
  summary: NoteSummary;
  relativePath: string;
  path: string;
  content: string;
  frontmatter?: string;
  body: string;
}

export interface UpdateNoteDocumentInput {
  title?: string;
  body?: string;
}

export interface Asset {
  id: string;
  path: string;
  mediaType?: string;
}

export interface AssetSummary extends Asset {
  name: string;
  relativePath: string;
  size: number;
  updatedAt: string;
}

export type ProjectTreeScope = "notes" | "assets";

export interface ProjectTreeNode {
  id: string;
  name: string;
  kind: "directory" | "note" | "asset";
  scope: ProjectTreeScope;
  relativePath: string;
  projectRelativePath: string;
  path?: string;
  children?: ProjectTreeNode[];
  note?: NoteSummary;
  asset?: AssetSummary;
}

export interface ProjectTree {
  notes: ProjectTreeNode;
  assets: ProjectTreeNode;
}

export interface CreateProjectFolderInput {
  scope: ProjectTreeScope;
  parentRelativePath?: string;
  name: string;
}

export interface ImportAssetInput {
  sourcePath: string;
  targetFolderRelativePath?: string;
}

export interface MoveNoteInput {
  sourceRelativePath: string;
  targetFolderRelativePath: string;
}

export interface MoveAssetInput {
  sourceRelativePath: string;
  targetFolderRelativePath: string;
}

export interface MoveFolderInput {
  sourceRelativePath: string;
  targetFolderRelativePath: string;
}

export interface ProjectLink {
  id: string;
  kind: "wiki" | "asset";
  sourceNoteRelativePath: string;
  rawTarget: string;
  label?: string;
  resolved: boolean;
  targetRelativePath?: string;
  note?: NoteSummary;
  asset?: AssetSummary;
}

export interface ProjectOverview {
  rootPath: string;
  manifest?: OsnovaManifest;
  validation: ValidationResult;
  counts: {
    notes: number;
    assets: number;
  };
  recentNotes: NoteSummary[];
  recentAssets: AssetSummary[];
  notes: NoteSummary[];
  assets: AssetSummary[];
}

export interface Card {
  id: string;
  type: "flashcard" | "definition" | "question";
  front: string;
  back: string;
  sourceNote?: string;
  tags?: string[];
}

export interface EntityRef {
  kind: "note" | "asset" | "card";
  id: string;
}

export interface Relation {
  id: string;
  from: EntityRef;
  to: EntityRef;
  type: "references" | "depends-on" | "explains" | "contradicts" | "related";
  createdAt?: string;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}
