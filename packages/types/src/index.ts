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

export interface Asset {
  id: string;
  path: string;
  mediaType?: string;
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
