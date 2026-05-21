import type { DerivedJob } from "../types";
import { renderMarkdown } from "../render/markdown";

interface Props {
  job: DerivedJob;
  threadSlug: string;
  studentProjectId: string | null;
}

export function QuestionCard({ job, studentProjectId }: Props) {
  const href = studentProjectId
    ? `https://claude.ai/project/${studentProjectId}`
    : null;

  return (
    <div className="question-card">
      <div className="from">from job: {job.id}</div>
      <div
        className="body"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(job.question || "") }}
      />
      {href && (
        <div className="footer">
          <a
            className="btn primary"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
          >
            Answer in Student chat ↗
          </a>
        </div>
      )}
    </div>
  );
}
