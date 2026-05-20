import type {
  DerivedJob,
  DerivedThread,
  JobFile,
  JobState,
  ThreadFile,
  ThreadState,
  UIState,
} from "../types";

function jobState(j: JobFile): JobState {
  if (j.location === "pending") return "pending";
  if (j.location === "done") return "done";
  // running
  if (j.question !== undefined && !j.hasAnswer) return "blocked";
  return "running";
}

function lastMtimeOf(j: JobFile): number {
  return Math.max(
    j.specMtime || 0,
    j.progressMtime || 0,
    j.questionMtime || 0,
    j.answerMtime || 0,
    j.resultMtime || 0,
  );
}

const RANK: Record<ThreadState, number> = {
  blocked: 0,
  running: 1,
  fresh: 2,
  idle: 3,
};

export function deriveState(
  threads: ThreadFile[],
  jobs: JobFile[],
  lastVisit: Record<string, string>,
): UIState {
  const jobsByThread = new Map<string, DerivedJob[]>();
  for (const j of jobs) {
    if (!j.threadSlug) continue;
    const state = jobState(j);
    const dj: DerivedJob = {
      id: j.id,
      state,
      threadSlug: j.threadSlug,
      title: j.title,
      budget: j.budget,
      location: j.location,
      legacy: j.legacy,
      specBody: j.body,
      progress: j.progress,
      question: j.question,
      result: j.result,
      resultMtime: j.resultMtime,
      lastMtime: lastMtimeOf(j),
    };
    const arr = jobsByThread.get(j.threadSlug) ?? [];
    arr.push(dj);
    jobsByThread.set(j.threadSlug, arr);
  }

  const derived: DerivedThread[] = threads.map((t) => {
    const list = jobsByThread.get(t.slug) ?? [];
    const pending = list.filter((j) => j.state === "pending");
    const running = list.filter((j) => j.state === "running");
    const blocked = list.filter((j) => j.state === "blocked");
    const done = list.filter((j) => j.state === "done");

    const lvIso = lastVisit[t.slug];
    const lvMs = lvIso ? Date.parse(lvIso) : 0;
    const recentDone = done.filter((j) => (j.resultMtime ?? 0) > lvMs);
    recentDone.sort((a, b) => (b.resultMtime ?? 0) - (a.resultMtime ?? 0));

    // any worker-written file under this thread newer than lvMs
    const workerNewest = Math.max(
      t.mtime || 0,
      ...done.map((j) => j.resultMtime ?? 0),
      0,
    );
    const hasFresh = workerNewest > lvMs;

    let state: ThreadState;
    if (blocked.length > 0) state = "blocked";
    else if (running.length > 0) state = "running";
    else if (hasFresh) state = "fresh";
    else state = "idle";

    const lastActivity = Math.max(
      t.mtime || 0,
      ...list.map((j) => j.lastMtime),
      0,
    );

    return {
      slug: t.slug,
      title: t.title,
      status: t.status,
      overleaf: t.overleaf,
      notesBody: t.notes,
      state,
      lastActivity,
      counts: {
        d: done.length,
        r: running.length + blocked.length,
        p: pending.length,
      },
      jobs: { pending, running, blocked, done, recentDone },
    };
  });

  derived.sort((a, b) => {
    const r = RANK[a.state] - RANK[b.state];
    if (r !== 0) return r;
    return b.lastActivity - a.lastActivity;
  });

  const threadBySlug = new Map<string, DerivedThread>();
  for (const t of derived) threadBySlug.set(t.slug, t);

  let globalState: ThreadState = "idle";
  for (const t of derived) {
    if (RANK[t.state] < RANK[globalState]) globalState = t.state;
  }

  return { threads: derived, threadBySlug, jobsByThread, globalState };
}

export function relTime(ms: number, now: number = Date.now()): string {
  if (!ms) return "";
  const d = Math.max(0, now - ms);
  if (d < 60_000) return "just now";
  if (d < 3600_000) return `${Math.floor(d / 60_000)}m`;
  if (d < 86_400_000) return `${Math.floor(d / 3600_000)}h`;
  if (d < 7 * 86_400_000) return `${Math.floor(d / 86_400_000)}d`;
  return `${Math.max(1, Math.floor(d / (7 * 86_400_000)))}w`;
}
