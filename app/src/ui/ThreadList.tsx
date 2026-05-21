import type { DerivedThread } from "../types";
import { relTime } from "../state/derive";

interface Props {
  threads: DerivedThread[] | null;
  selected: string | null;
  onSelect: (slug: string) => void;
}

export function ThreadList({ threads, selected, onSelect }: Props) {
  if (threads === null) {
    return <div className="empty-list">Loading threads…</div>;
  }
  if (threads.length === 0) {
    return (
      <div className="empty-list">
        No threads yet. Create one in Student chat.
      </div>
    );
  }
  return (
    <div className="thread-list">
      {threads.map((t) => (
        <div
          key={t.slug}
          className={"thread-row" + (t.slug === selected ? " selected" : "")}
          onClick={() => onSelect(t.slug)}
        >
          <span className={"dot " + t.state} />
          <div>
            <div className="slug">{t.slug}</div>
            <div className="meta">
              <span>{relTime(t.lastActivity)}</span>
              <span className="counts">
                {t.counts.d}d {t.counts.r}r {t.counts.p}p
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
