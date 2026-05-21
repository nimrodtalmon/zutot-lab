import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DriveToken, JobFile, ThreadFile } from "./types";
import {
  clearToken,
  finishAuthFlowIfNeeded,
  isExpired,
  readToken,
  startAuthFlow,
} from "./drive/auth";
import {
  crawl,
  fetchText,
  listChildren,
  DriveAuthError,
} from "./drive/files";
import { startPoller } from "./drive/poll";
import { deriveState } from "./state/derive";
import {
  getLastVisitMs,
  markVisited,
  pruneLastVisit,
  readLastVisit,
} from "./state/lastVisit";
import { parseHash, pushRoute } from "./state/routes";
import { Wizard } from "./ui/Wizard";
import { ThreadList } from "./ui/ThreadList";
import { ThreadView } from "./ui/ThreadView";
import { JobOverlay } from "./ui/JobOverlay";
import { Banner } from "./ui/Banner";

const FOLDER_KEY = "zutot.observer.folderId";
const STUDENT_KEY = "zutot.observer.studentProjectId";

function readFolderId(): string | null {
  return localStorage.getItem(FOLDER_KEY);
}
function readStudentId(): string | null {
  return localStorage.getItem(STUDENT_KEY);
}

export default function App() {
  const [token, setToken] = useState<DriveToken | null>(() => readToken());
  const [folderId, setFolderId] = useState<string | null>(() => readFolderId());
  const [studentProjectId, setStudentProjectId] = useState<string | null>(() =>
    readStudentId(),
  );

  const [threads, setThreads] = useState<ThreadFile[] | null>(null);
  const [jobs, setJobs] = useState<JobFile[] | null>(null);
  const [route, setRoute] = useState(() => parseHash(window.location.hash));

  const [authBanner, setAuthBanner] = useState(false);
  const [syncBanner, setSyncBanner] = useState(false);
  const [resultCache, setResultCache] = useState<Record<string, string>>({});
  const [resultLoadingId, setResultLoadingId] = useState<string | null>(null);
  const [lastVisitVer, setLastVisitVer] = useState(0); // re-derive bump
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  // ---- OAuth tail handling on cold load --------------------------------------
  useEffect(() => {
    (async () => {
      try {
        const t = await finishAuthFlowIfNeeded();
        if (t) setToken(t);
      } catch (e) {
        console.warn("OAuth tail failed", e);
      }
    })();
  }, []);

  // ---- Local storage availability ---------------------------------------------
  const lsAvailable = useMemo(() => {
    try {
      const k = "__zutot_test__";
      localStorage.setItem(k, "1");
      localStorage.removeItem(k);
      return true;
    } catch {
      return false;
    }
  }, []);

  // ---- Hash routing -----------------------------------------------------------
  useEffect(() => {
    function onHash() {
      setRoute(parseHash(window.location.hash));
    }
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onHash);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("popstate", onHash);
    };
  }, []);

  // ---- Cold start crawl ------------------------------------------------------
  const crawlInFlight = useRef(false);
  const doCrawl = useCallback(async () => {
    if (!token || !folderId) return;
    if (crawlInFlight.current) return;
    crawlInFlight.current = true;
    try {
      const res = await crawl(token, folderId);
      setThreads(res.threads);
      setJobs(res.jobs);
      const slugs = new Set(res.threads.map((t) => t.slug));
      pruneLastVisit(slugs);
      setSyncBanner(false);
      setAuthBanner(false);
    } catch (e) {
      if (e instanceof DriveAuthError) {
        setAuthBanner(true);
      } else {
        console.warn("crawl failed", e);
        setSyncBanner(true);
      }
    } finally {
      crawlInFlight.current = false;
    }
  }, [token, folderId]);

  useEffect(() => {
    if (token && folderId && threads === null) {
      doCrawl();
    }
  }, [token, folderId, threads, doCrawl]);

  // ---- Polling ---------------------------------------------------------------
  const firstErrorAt = useRef<number | null>(null);
  useEffect(() => {
    if (!token || !folderId) return;
    const handle = startPoller({
      getToken: () => readToken(),
      onAuthError: () => {
        setAuthBanner(true);
      },
      onSuccess: () => {
        firstErrorAt.current = null;
        setSyncBanner(false);
      },
      onTransientError: () => {
        if (firstErrorAt.current === null) firstErrorAt.current = Date.now();
        if (Date.now() - (firstErrorAt.current ?? 0) > 120_000) {
          setSyncBanner(true);
        }
      },
      onChanges: async (_changes) => {
        // For v0 simplicity: any reported change triggers a full re-crawl.
        // The crawl itself is throttled by crawlInFlight.
        await doCrawl();
      },
    });
    return () => handle.stop();
  }, [token, folderId, doCrawl]);

  // ---- Token expiry watcher --------------------------------------------------
  useEffect(() => {
    const t = readToken();
    if (isExpired(t)) {
      if (t) {
        // No refresh flow in v0; just surface the banner.
        setAuthBanner(true);
      }
    }
  }, [token]);

  // ---- Derive ----------------------------------------------------------------
  const lastVisit = useMemo(() => {
    void lastVisitVer;
    return readLastVisit();
  }, [lastVisitVer, threads, jobs]);

  const ui = useMemo(() => {
    if (!threads || !jobs) return null;
    return deriveState(threads, jobs, lastVisit);
  }, [threads, jobs, lastVisit]);

  // After ui derives, do the auto-select-top exactly once per cold load.
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (autoSelectedRef.current) return;
    if (!ui) return;
    autoSelectedRef.current = true;
    if (route.threadSlug) return;
    if (ui.threads.length === 0) return;
    pushRoute({ threadSlug: ui.threads[0].slug, jobId: null });
  }, [ui]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- lastVisit update on thread mount --------------------------------------
  const lastVisitedSlugRef = useRef<string | null>(null);
  useEffect(() => {
    if (!route.threadSlug || !ui) return;
    if (lastVisitedSlugRef.current === route.threadSlug) return;
    lastVisitedSlugRef.current = route.threadSlug;
    // Defer one microtask so render uses the previous lastVisit value first.
    queueMicrotask(() => {
      markVisited(route.threadSlug!);
      setLastVisitVer((v) => v + 1);
    });
  }, [route.threadSlug, ui]);

  // ---- Lazy result fetch on overlay open -------------------------------------
  useEffect(() => {
    if (!route.threadSlug || !route.jobId) return;
    if (!token || !jobs) return;
    if (resultCache[route.jobId] !== undefined) return;
    const job = jobs.find(
      (j) =>
        j.id === route.jobId &&
        (j.threadSlug === route.threadSlug ||
          // legacy flat done has null threadSlug; still allow open if id matches
          j.threadSlug === null),
    );
    if (!job || job.location !== "done") return;
    setResultLoadingId(route.jobId);
    (async () => {
      try {
        // Need the result file ID — re-crawl-derived jobs don't carry it.
        // For v0 we just refetch via files.list on the job's folder.
        const body = await fetchResultBody(token, folderId!, job);
        setResultCache((c) => ({ ...c, [job.id]: body ?? "" }));
      } catch (e) {
        console.warn("result fetch failed", e);
        setResultCache((c) => ({ ...c, [job.id]: "" }));
      } finally {
        setResultLoadingId(null);
      }
    })();
  }, [route.threadSlug, route.jobId, jobs, token, folderId, resultCache]);

  // ---- Tab visibility tracking ----------------------------------------------
  const [visTick, setVisTick] = useState(0);
  useEffect(() => {
    function onVis() {
      setVisTick((v) => v + 1);
    }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // ---- Tab title + favicon ---------------------------------------------------
  useEffect(() => {
    let base = "Zutot Observer";
    if (route.threadSlug) base = `${route.threadSlug} — Zutot Observer`;
    if (route.jobId) base = `${route.jobId} — Zutot Observer`;
    let prefix = "";
    let color = "#b8b1a3";
    if (document.hidden && ui) {
      if (ui.globalState === "blocked") {
        prefix = "🔵 ";
        color = "#2563eb";
      } else if (ui.globalState === "running") {
        prefix = "🟡 ";
        color = "#c97f17";
      } else if (ui.globalState === "fresh") {
        prefix = "🟢 ";
        color = "#2f9e44";
      }
    } else if (ui) {
      if (ui.globalState === "blocked") color = "#2563eb";
      else if (ui.globalState === "running") color = "#c97f17";
      else if (ui.globalState === "fresh") color = "#2f9e44";
    }
    document.title = prefix + base;
    setFavicon(color);
  }, [route, ui, visTick]);

  // ---- Mobile body class -----------------------------------------------------
  useEffect(() => {
    document.body.classList.remove("m-list", "m-thread");
    if (route.threadSlug) document.body.classList.add("m-thread");
    else document.body.classList.add("m-list");
  }, [route.threadSlug]);

  // ---- Handlers --------------------------------------------------------------
  function onSelectThread(slug: string) {
    pushRoute({ threadSlug: slug, jobId: null });
  }
  function onOpenJob(id: string) {
    if (!route.threadSlug) return;
    pushRoute({ threadSlug: route.threadSlug, jobId: id });
  }
  function onCloseOverlay() {
    if (history.length > 1) {
      history.back();
    } else {
      pushRoute({ threadSlug: route.threadSlug, jobId: null });
    }
  }
  function onMobileBack() {
    if (route.jobId) onCloseOverlay();
    else if (route.threadSlug) {
      if (history.length > 1) history.back();
      else pushRoute({ threadSlug: null, jobId: null });
    }
  }

  function onFolderPicked(id: string, _name: string) {
    localStorage.setItem(FOLDER_KEY, id);
    setFolderId(id);
  }
  function onStudentSet(uuid: string) {
    localStorage.setItem(STUDENT_KEY, uuid);
    setStudentProjectId(uuid);
  }

  // ---- Render ----------------------------------------------------------------
  if (!token || !folderId || !studentProjectId) {
    return (
      <div className="app-shell">
        {!lsAvailable && (
          <div className="banner">
            Local storage unavailable — some features disabled.
          </div>
        )}
        <Wizard
          hasToken={!!token}
          hasFolder={!!folderId}
          hasStudent={!!studentProjectId}
          token={token}
          onFolderPicked={onFolderPicked}
          onStudentSet={onStudentSet}
        />
      </div>
    );
  }

  const selectedThread = route.threadSlug
    ? (ui?.threadBySlug.get(route.threadSlug) ?? null)
    : null;

  const overlayJob =
    route.jobId && ui
      ? (ui.jobsByThread.get(route.threadSlug ?? "") ?? []).find(
          (j) => j.id === route.jobId,
        )
      : undefined;

  return (
    <div className="app-shell">
      {toast && <div className="toast">{toast}</div>}
      {!lsAvailable && (
        <div className="banner">
          Local storage unavailable — some features disabled.
        </div>
      )}
      {authBanner && (
        <Banner
          kind="auth"
          onAction={() => {
            clearToken();
            setAuthBanner(false);
            startAuthFlow();
          }}
        />
      )}
      {syncBanner && !authBanner && <Banner kind="sync" />}

      <div className="mobile-topbar">
        {route.threadSlug ? (
          <>
            <button className="back" onClick={onMobileBack}>
              ‹ Threads
            </button>
            <span className="title">
              {selectedThread?.slug ?? route.threadSlug}
            </span>
            <span className="actions" />
          </>
        ) : (
          <>
            <span className="title">zutot-lab-os</span>
            <span className="actions" />
          </>
        )}
      </div>

      <div className="app-body">
        <aside className="pane-left">
          <div className="header">
            <span className="title">Threads</span>
            <span className="folder">zutot-lab-os/</span>
          </div>
          <ThreadList
            threads={ui ? ui.threads : null}
            selected={route.threadSlug}
            onSelect={onSelectThread}
          />
        </aside>

        <main className="pane-right">
          {selectedThread ? (
            <ThreadView
              thread={selectedThread}
              studentProjectId={studentProjectId}
              onOpenJob={onOpenJob}
              onShowToast={showToast}
            />
          ) : ui === null ? (
            <div className="empty-list">Loading…</div>
          ) : (
            <div className="empty-list">Select a thread.</div>
          )}
        </main>
      </div>

      {overlayJob && (
        <JobOverlay
          job={overlayJob}
          resultBody={
            overlayJob.location === "done"
              ? resultCache[overlayJob.id]
              : undefined
          }
          resultLoading={resultLoadingId === overlayJob.id}
          onClose={onCloseOverlay}
        />
      )}
    </div>
  );
}

function setFavicon(color: string) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='16' cy='16' r='10' fill='${color}'/></svg>`;
  const dataUrl =
    "data:image/svg+xml;base64," + btoa(svg);
  let link = document.getElementById("favicon") as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.id = "favicon";
    link.rel = "icon";
    link.type = "image/svg+xml";
    document.head.appendChild(link);
  }
  link.href = dataUrl;
}

// Fetch result.md body for a done job by re-listing its folder and pulling the file.
async function fetchResultBody(
  token: DriveToken,
  rootId: string,
  job: JobFile,
): Promise<string | undefined> {
  // Find the file ID for the result by listing the folder tree freshly.
  // For folder-form jobs: jobs/done/<id>/result.md
  // For legacy flat done: jobs/done/<id>.md or <id>.result.md (the file itself is the result)
  const root = await listChildren(token, rootId);
  const jobsFolder = root.find(
    (f) => f.name === "jobs" && f.mimeType === "application/vnd.google-apps.folder",
  );
  if (!jobsFolder) return undefined;
  const subs = await listChildren(token, jobsFolder.id);
  const doneFolder = subs.find(
    (f) =>
      f.name === "done" && f.mimeType === "application/vnd.google-apps.folder",
  );
  if (!doneFolder) return undefined;
  const inside = await listChildren(token, doneFolder.id);
  if (job.legacy) {
    const flat =
      inside.find((f) => f.name === `${job.id}.md`) ??
      inside.find((f) => f.name === `${job.id}.result.md`);
    if (!flat) return undefined;
    return await fetchText(token, flat.id);
  } else {
    const folder = inside.find(
      (f) =>
        f.name === job.id &&
        f.mimeType === "application/vnd.google-apps.folder",
    );
    if (!folder) return undefined;
    const inner = await listChildren(token, folder.id);
    const result = inner.find((f) => f.name === "result.md");
    if (!result) return undefined;
    return await fetchText(token, result.id);
  }
}
