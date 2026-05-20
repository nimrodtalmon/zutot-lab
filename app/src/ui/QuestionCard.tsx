import type { DerivedJob } from "../types";
import { renderMarkdown } from "../render/markdown";

interface Props {
  job: DerivedJob;
  threadSlug: string;
  studentProjectId: string | null;
}

export function QuestionCard({ job, threadSlug, studentProjectId }: Props) {
  const prompt = `Answer the open question in \`jobs/running/${job.id}/question.md\` (thread: \`${threadSlug}\`). When you have an answer, write it to \`jobs/running/${job.id}/answer.md\` so the worker can resume.`;
  const href = studentProjectId
    ? `https://claude.ai/project/${studentProjectId}/new?q=${encodeURIComponent(prompt)}`
    : null;

  function onClick(e: React.MouseEvent) {
    if (!href) {
      e.preventDefault();
      navigator.clipboard?.writeText(prompt).catch(() => {});
      alert("Prompt copied to clipboard — paste it into Student.");
    }
  }

  return (
    <div className="question-card">
      <div className="from">from job: {job.id}</div>
      <div
        className="body"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(job.question || "") }}
      />
      <div className="footer">
        {href ? (
          <a
            className="btn primary"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClick}
          >
            Answer in Student chat ↗
          </a>
        ) : (
          <button className="btn primary" onClick={onClick}>
            Answer in Student chat ↗
          </button>
        )}
      </div>
    </div>
  );
}
