import type { DerivedJob } from "../types";
import { renderMarkdownDemoted } from "../render/markdown";
import { ProgressLog } from "./ProgressLog";
import { useEffect } from "react";

interface Props {
  job: DerivedJob;
  resultBody: string | undefined;
  resultLoading: boolean;
  onClose: () => void;
}

export function JobOverlay({ job, resultBody, resultLoading, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const showSpec = !!job.specBody && !(job.legacy && job.location === "done");
  return (
    <>
      <div className="overlay-backdrop" onClick={onClose} />
      <div className="overlay" role="dialog" aria-modal="true">
        <div className="overlay-head">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="title">{job.id}</span>
            <span className="state-pill">{job.state}</span>
            {job.legacy && job.location === "done" && (
              <span className="badge">legacy flat job</span>
            )}
          </div>
          <button
            className="close"
            onClick={onClose}
            aria-label="Close overlay"
          >
            ✕
          </button>
        </div>
        <div className="overlay-body">
          {job.threadSlug && (
            <div className="kv">
              <span className="k">thread:</span>
              {job.threadSlug}
            </div>
          )}
          {job.budget && (
            <div className="kv">
              <span className="k">budget:</span>
              {job.budget}
            </div>
          )}

          {showSpec && (
            <>
              <h3>Spec</h3>
              <div
                className="prose"
                dangerouslySetInnerHTML={{
                  __html: renderMarkdownDemoted(job.specBody),
                }}
              />
            </>
          )}

          {job.location === "running" && (
            <>
              <h3>Progress</h3>
              {job.progress !== undefined ? (
                <ProgressLog text={job.progress} expanded />
              ) : (
                <div className="gray-note">no progress recorded yet</div>
              )}
            </>
          )}

          {job.state === "blocked" && job.question && (
            <>
              <h3>Open question</h3>
              <div
                className="prose"
                dangerouslySetInnerHTML={{
                  __html: renderMarkdownDemoted(job.question),
                }}
              />
            </>
          )}

          {job.location === "done" && (
            <>
              <h3>Result</h3>
              {resultLoading ? (
                <div className="gray-note">loading…</div>
              ) : resultBody === undefined ? (
                <div className="gray-note">result file is empty</div>
              ) : resultBody.trim() === "" ? (
                <div className="gray-note">result file is empty</div>
              ) : (
                <div
                  className="prose"
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdownDemoted(resultBody),
                  }}
                />
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
