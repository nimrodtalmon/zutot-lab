import type { DriveFileMeta, DriveToken, JobFile, ThreadFile } from "../types";
import { parseThread } from "../parse/thread";
import { parseJobSpec } from "../parse/job";
import { authHeader } from "./auth";

const FOLDER_MIME = "application/vnd.google-apps.folder";

export class DriveAuthError extends Error {
  status: number;
  constructor(status: number, msg: string) {
    super(msg);
    this.status = status;
  }
}

async function driveFetch(
  url: string,
  t: DriveToken,
  init?: RequestInit,
): Promise<Response> {
  const headers = {
    ...(init?.headers ?? {}),
    ...authHeader(t),
  };
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    throw new DriveAuthError(401, "Drive auth expired");
  }
  return res;
}

async function backoffOn429<T>(fn: () => Promise<T>): Promise<T> {
  const delays = [5_000, 10_000, 20_000, 40_000, 60_000];
  let i = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof RateLimitError && i < delays.length) {
        const jitter = Math.floor(Math.random() * 1000);
        await new Promise((r) => setTimeout(r, delays[i] + jitter));
        i++;
        continue;
      }
      throw e;
    }
  }
}

export class RateLimitError extends Error {}

async function readJson(res: Response): Promise<any> {
  if (res.status === 403) {
    const txt = await res.text();
    if (/rateLimit|userRateLimit|quotaExceeded/i.test(txt)) {
      throw new RateLimitError(txt);
    }
    throw new Error(`Drive 403: ${txt}`);
  }
  if (!res.ok) {
    throw new Error(`Drive ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

export async function listChildren(
  t: DriveToken,
  parentId: string,
): Promise<DriveFileMeta[]> {
  const files: DriveFileMeta[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${parentId}' in parents and trashed = false`,
      fields:
        "nextPageToken, files(id, name, mimeType, parents, modifiedTime, trashed)",
      pageSize: "1000",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await backoffOn429(() =>
      driveFetch(
        "https://www.googleapis.com/drive/v3/files?" + params.toString(),
        t,
      ).then(readJson),
    );
    files.push(...(res.files ?? []));
    pageToken = res.nextPageToken;
  } while (pageToken);
  return files;
}

export async function fetchText(
  t: DriveToken,
  fileId: string,
): Promise<string> {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await backoffOn429(() => driveFetch(url, t));
  if (res.status === 404) return "";
  if (res.status === 403) {
    const txt = await res.text();
    if (/rateLimit/i.test(txt)) throw new RateLimitError(txt);
    throw new Error(txt);
  }
  if (!res.ok) throw new Error(`Drive ${res.status}: ${await res.text()}`);
  return await res.text();
}

export async function getStartPageToken(t: DriveToken): Promise<string> {
  const res = await backoffOn429(() =>
    driveFetch(
      "https://www.googleapis.com/drive/v3/changes/startPageToken",
      t,
    ).then(readJson),
  );
  return res.startPageToken as string;
}

export interface ChangesResult {
  changes: Array<{
    fileId?: string;
    removed?: boolean;
    file?: DriveFileMeta;
    time?: string;
  }>;
  newStartPageToken?: string;
  nextPageToken?: string;
}

export async function listChanges(
  t: DriveToken,
  pageToken: string,
): Promise<ChangesResult> {
  const params = new URLSearchParams({
    pageToken,
    fields:
      "nextPageToken, newStartPageToken, changes(fileId, removed, time, file(id,name,mimeType,parents,modifiedTime,trashed))",
    pageSize: "1000",
    includeRemoved: "true",
  });
  const url =
    "https://www.googleapis.com/drive/v3/changes?" + params.toString();
  const res = await driveFetch(url, t);
  if (res.status === 410) {
    throw new PageTokenGoneError();
  }
  return await readJson(res);
}

export class PageTokenGoneError extends Error {}

// ---------------------------------------------------------------------------
// Crawl: build the full filesystem snapshot for the lab folder.
// ---------------------------------------------------------------------------

export interface CrawlResult {
  threads: ThreadFile[];
  jobs: JobFile[];
  fileIndex: Map<string, DriveFileMeta>; // fileId -> meta
  threadsFolderId?: string;
  jobsFolderId?: string;
  pendingFolderId?: string;
  runningFolderId?: string;
  doneFolderId?: string;
}

export async function crawl(
  t: DriveToken,
  rootId: string,
): Promise<CrawlResult> {
  const fileIndex = new Map<string, DriveFileMeta>();
  const rootChildren = await listChildren(t, rootId);
  for (const f of rootChildren) fileIndex.set(f.id, f);

  const threadsFolder = rootChildren.find(
    (f) => f.name === "threads" && f.mimeType === FOLDER_MIME,
  );
  const jobsFolder = rootChildren.find(
    (f) => f.name === "jobs" && f.mimeType === FOLDER_MIME,
  );

  const threads: ThreadFile[] = [];
  if (threadsFolder) {
    const tk = await listChildren(t, threadsFolder.id);
    for (const f of tk) fileIndex.set(f.id, f);
    for (const f of tk) {
      if (f.mimeType !== "text/markdown" && !f.name.endsWith(".md")) continue;
      const slug = f.name.replace(/\.md$/, "");
      try {
        const body = await fetchText(t, f.id);
        threads.push(parseThread(slug, body, mtimeMs(f)));
      } catch (e) {
        console.warn("thread fetch failed:", f.name, e);
      }
    }
  }

  let pendingFolderId: string | undefined;
  let runningFolderId: string | undefined;
  let doneFolderId: string | undefined;
  const jobs: JobFile[] = [];

  if (jobsFolder) {
    const sub = await listChildren(t, jobsFolder.id);
    for (const f of sub) fileIndex.set(f.id, f);
    const pendingFolder = sub.find(
      (f) => f.name === "pending" && f.mimeType === FOLDER_MIME,
    );
    const runningFolder = sub.find(
      (f) => f.name === "running" && f.mimeType === FOLDER_MIME,
    );
    const doneFolder = sub.find(
      (f) => f.name === "done" && f.mimeType === FOLDER_MIME,
    );

    pendingFolderId = pendingFolder?.id;
    runningFolderId = runningFolder?.id;
    doneFolderId = doneFolder?.id;

    if (pendingFolder) {
      const items = await listChildren(t, pendingFolder.id);
      for (const it of items) fileIndex.set(it.id, it);
      for (const j of await readJobs(t, items, "pending", fileIndex))
        jobs.push(j);
    }
    if (runningFolder) {
      const items = await listChildren(t, runningFolder.id);
      for (const it of items) fileIndex.set(it.id, it);
      for (const j of await readJobs(t, items, "running", fileIndex))
        jobs.push(j);
    }
    if (doneFolder) {
      const items = await listChildren(t, doneFolder.id);
      for (const it of items) fileIndex.set(it.id, it);
      for (const j of await readJobs(t, items, "done", fileIndex))
        jobs.push(j);
    }
  }

  return {
    threads,
    jobs,
    fileIndex,
    threadsFolderId: threadsFolder?.id,
    jobsFolderId: jobsFolder?.id,
    pendingFolderId,
    runningFolderId,
    doneFolderId,
  };
}

function mtimeMs(f: DriveFileMeta | undefined): number {
  if (!f) return 0;
  const t = Date.parse(f.modifiedTime);
  return isNaN(t) ? 0 : t;
}

async function readJobs(
  t: DriveToken,
  items: DriveFileMeta[],
  location: "pending" | "running" | "done",
  fileIndex: Map<string, DriveFileMeta>,
): Promise<JobFile[]> {
  const out: JobFile[] = [];
  for (const it of items) {
    if (it.mimeType === FOLDER_MIME) {
      // Folder-form job.
      const inner = await listChildren(t, it.id);
      for (const f of inner) fileIndex.set(f.id, f);
      const jobMd = inner.find((f) => f.name === "job.md");
      const progressMd = inner.find((f) => f.name === "progress.md");
      const questionMd = inner.find((f) => f.name === "question.md");
      const answerMd = inner.find((f) => f.name === "answer.md");
      const resultMd = inner.find((f) => f.name === "result.md");

      let spec: { title: string; threadSlug: string | null; budget?: string; body: string } = {
        title: it.name,
        threadSlug: null,
        body: "",
      };
      let specMtime = mtimeMs(jobMd);
      if (jobMd) {
        try {
          const content = await fetchText(t, jobMd.id);
          spec = parseJobSpec(it.name, content);
        } catch (e) {
          console.warn("job.md fetch failed", jobMd.id, e);
        }
      } else if (location === "done") {
        // Legacy folder-less case is handled below; folder without job.md is unusual.
      }

      if (!spec.threadSlug) {
        console.warn(`job missing Thread: ${location}/${it.name}/job.md`);
        continue;
      }

      let progress: string | undefined;
      if (progressMd) {
        try {
          progress = await fetchText(t, progressMd.id);
        } catch (e) {
          console.warn("progress.md fetch failed", e);
        }
      }
      let question: string | undefined;
      if (questionMd) {
        try {
          question = await fetchText(t, questionMd.id);
        } catch (e) {
          console.warn("question.md fetch failed", e);
        }
      }
      let result: string | undefined;
      // Lazy per spec §4.4 — we leave result content unfetched at crawl time.

      out.push({
        id: it.name,
        location,
        legacy: false,
        threadSlug: spec.threadSlug,
        title: spec.title,
        budget: spec.budget,
        body: spec.body,
        specMtime,
        progress,
        progressMtime: mtimeMs(progressMd),
        question,
        questionMtime: mtimeMs(questionMd),
        hasAnswer: !!answerMd,
        answerMtime: mtimeMs(answerMd),
        result,
        resultMtime: mtimeMs(resultMd),
      });
    } else {
      // Flat .md file (legacy).
      if (!it.name.endsWith(".md")) continue;
      // Conflicted-copy guard — skip "x (1).md" patterns.
      if (/\(\d+\)\.md$/.test(it.name)) {
        console.warn("conflicted copy, ignoring:", it.name);
        continue;
      }
      const baseName = it.name.replace(/\.md$/, "");
      const id = baseName.replace(/\.result$/, "");
      const isResultFlat = baseName.endsWith(".result");

      if (location === "done") {
        // Legacy done: file body IS the result; spec is lost.
        let result: string | undefined;
        // Lazy; loaded on overlay open. We still need the Thread: from somewhere — there isn't one for flat legacy.
        // Per §1.4 "show only the result content … with (legacy flat job) label" — but threadSlug is required to attach.
        // Best effort: leave threadSlug null, which will hide it per §5.4.
        out.push({
          id,
          location: "done",
          legacy: true,
          threadSlug: null,
          title: id,
          body: "",
          specMtime: mtimeMs(it),
          resultMtime: mtimeMs(it),
          result,
          hasAnswer: false,
        });
        continue;
      }

      // Legacy pending: flat <id>.md is the spec.
      try {
        const content = await fetchText(t, it.id);
        const spec = parseJobSpec(id, content);
        if (!spec.threadSlug) {
          console.warn(`job missing Thread: ${location}/${it.name}`);
          continue;
        }
        out.push({
          id,
          location,
          legacy: true,
          threadSlug: spec.threadSlug,
          title: spec.title,
          budget: spec.budget,
          body: spec.body,
          specMtime: mtimeMs(it),
          hasAnswer: false,
        });
      } catch (e) {
        console.warn("legacy job fetch failed", it.name, e);
      }

      // isResultFlat: <id>.result.md form — attach as a done result for an existing legacy id?
      // Spec §1.4: legacy done variants are .md OR .result.md. We treat both the same above when location === 'done'.
      void isResultFlat;
    }
  }
  return out;
}

export function isLabAncestor(
  fileMeta: DriveFileMeta,
  ancestors: Set<string>,
): boolean {
  if (!fileMeta.parents) return false;
  return fileMeta.parents.some((p) => ancestors.has(p));
}
