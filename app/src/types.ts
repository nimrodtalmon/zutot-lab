export type JobLocation = "pending" | "running" | "done";
export type JobState = "pending" | "running" | "blocked" | "done";
export type ThreadState = "blocked" | "running" | "fresh" | "idle";

export interface ThreadFile {
  slug: string;
  title: string;
  overleaf?: string;
  status?: string;
  notes?: string;
  mtime: number;
  body: string;
}

export interface JobFile {
  id: string;
  location: JobLocation;
  legacy: boolean;
  threadSlug: string | null;
  title: string;
  budget?: string;
  body: string;
  specMtime: number;
  progress?: string;
  progressMtime?: number;
  question?: string;
  questionMtime?: number;
  hasAnswer: boolean;
  answerMtime?: number;
  result?: string;
  resultMtime?: number;
}

export interface DerivedJob {
  id: string;
  state: JobState;
  threadSlug: string;
  title: string;
  budget?: string;
  location: JobLocation;
  legacy: boolean;
  specBody: string;
  progress?: string;
  question?: string;
  result?: string;
  resultMtime?: number;
  lastMtime: number;
}

export interface DerivedThread {
  slug: string;
  title: string;
  status?: string;
  overleaf?: string;
  notesBody?: string;
  state: ThreadState;
  lastActivity: number;
  counts: { d: number; r: number; p: number };
  jobs: {
    pending: DerivedJob[];
    running: DerivedJob[];
    blocked: DerivedJob[];
    done: DerivedJob[];
    recentDone: DerivedJob[];
  };
}

export interface UIState {
  threads: DerivedThread[];
  threadBySlug: Map<string, DerivedThread>;
  jobsByThread: Map<string, DerivedJob[]>;
  globalState: ThreadState;
}

export interface DriveToken {
  access: string;
  refresh?: string;
  expiry: number;
}

export interface DriveFileMeta {
  id: string;
  name: string;
  parents?: string[];
  mimeType: string;
  modifiedTime: string;
  trashed?: boolean;
}
