import type { DerivedThread } from "../types";
import { QuestionCard } from "./QuestionCard";
import { JobCard } from "./JobCard";
import { renderMarkdown } from "../render/markdown";
import { useState } from "react";

interface Props {
  thread: DerivedThread;
  studentProjectId: string | null;
  onOpenJob: (id: string) => void;
}

function overleafWebUrl(url: string): string {
  const m = url.match(/^https?:\/\/(?:[^@/]+@)?git\.overleaf\.com\/([^/?#]+)/i);
  if (m) return `https://www.overleaf.com/project/${m[1]}`;
  return url;
}

export function ThreadView({
  thread,
  studentProjectId,
  onOpenJob,
}: Props) {
  const prompt = `Resume work on thread \`${thread.slug}\`. Read \`threads/${thread.slug}.md\` and any relevant files under \`jobs/\` before responding.`;
  const studentHref = studentProjectId
    ? `https://claude.ai/project/${studentProjectId}/new?q=${encodeURIComponent(prompt)}`
    : null;

  const pendingExpanded = thread.jobs.pending.length <= 5;

  function studentClick() {
    navigator.clipboard?.writeText(prompt).catch(() => {});
  }

  return (
    <>
      <div className="thread-header">
        <h2>{thread.title}</h2>
        <div className="actions">
          {thread.overleaf && (
            <a
              className="btn"
              href={overleafWebUrl(thread.overleaf)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Overleaf ↗
            </a>
          )}
          {studentHref && (
            <a
              className="btn primary"
              href={studentHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={studentClick}
              title="Open Student chat with this thread's context"
            >
              💬 Student
            </a>
          )}
        </div>
      </div>

      {thread.status && (
        <div className="status-line">Status: {thread.status}</div>
      )}

      {thread.jobs.blocked.length > 0 && (
        <div className="section">
          <div className="section-h">Open question</div>
          {thread.jobs.blocked.map((j) => (
            <QuestionCard
              key={j.id}
              job={j}
              threadSlug={thread.slug}
              studentProjectId={studentProjectId}
            />
          ))}
        </div>
      )}

      {thread.jobs.running.length > 0 && (
        <div className="section">
          <div className="section-h">Running now</div>
          {thread.jobs.running.map((j) => (
            <JobCard key={j.id} job={j} variant="running" onOpen={onOpenJob} />
          ))}
        </div>
      )}

      {thread.jobs.recentDone.length > 0 && (
        <div className="section">
          <div className="section-h">Recently done</div>
          {thread.jobs.recentDone.map((j) => (
            <JobCard key={j.id} job={j} variant="done" onOpen={onOpenJob} />
          ))}
        </div>
      )}

      {thread.notesBody && thread.notesBody.trim() !== "" && (
        <div className="section">
          <div className="section-h">Notes</div>
          <div
            className="notes"
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(thread.notesBody),
            }}
          />
        </div>
      )}

      {thread.jobs.pending.length > 0 && (
        <div className="section">
          <div className="section-h">Pending</div>
          <PendingList
            jobs={thread.jobs.pending}
            expanded={pendingExpanded}
            onOpen={onOpenJob}
          />
        </div>
      )}
    </>
  );
}

function PendingList({
  jobs,
  expanded,
  onOpen,
}: {
  jobs: { id: string }[];
  expanded: boolean;
  onOpen: (id: string) => void;
}) {
  const [open, setOpen] = useState(expanded);
  if (expanded) {
    return (
      <ul className="pending-list">
        {jobs.map((j) => (
          <li key={j.id} onClick={() => onOpen(j.id)}>
            {j.id}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <details
      className="pending-collapse"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary>
        {open ? "hide" : "show"} {jobs.length} pending
      </summary>
      <ul className="pending-list">
        {jobs.map((j) => (
          <li key={j.id} onClick={() => onOpen(j.id)}>
            {j.id}
          </li>
        ))}
      </ul>
    </details>
  );
}
