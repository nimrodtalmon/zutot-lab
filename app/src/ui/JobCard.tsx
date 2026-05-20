import type { DerivedJob } from "../types";
import { relTime } from "../state/derive";
import { ProgressLog } from "./ProgressLog";

interface Props {
  job: DerivedJob;
  variant: "running" | "blocked" | "done" | "pending";
  onOpen: (id: string) => void;
}

export function JobCard({ job, variant, onOpen }: Props) {
  if (variant === "pending") {
    return (
      <li onClick={() => onOpen(job.id)}>{job.id}</li>
    );
  }
  const cls = "job-card " + (variant === "blocked" ? "blocked" : variant);
  return (
    <div className={cls} onClick={() => onOpen(job.id)}>
      <div className="top">
        <span className="slug">
          {job.id}
          {variant === "running" && <span className="badge">in progress</span>}
          {variant === "blocked" && (
            <span className="badge blocked">halted on question</span>
          )}
        </span>
        <span className="meta">
          {variant === "done" && job.resultMtime
            ? relTime(job.resultMtime)
            : variant === "done"
              ? ""
              : relTime(job.lastMtime)}
        </span>
      </div>
      {variant === "running" && job.progress !== undefined && (
        <ProgressLog text={job.progress} tail={8} />
      )}
    </div>
  );
}
