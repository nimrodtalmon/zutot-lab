import { useEffect, useRef, useState } from "react";

interface Props {
  text: string;
  tail?: number; // if set, show only the last N lines
  expanded?: boolean; // overlay variant: bigger and no max-height
}

export function ProgressLog({ text, tail, expanded }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const prevTextRef = useRef<string>("");
  const stickyBottomRef = useRef<boolean>(true);
  const [newLineIdxs, setNewLineIdxs] = useState<Set<number>>(new Set());

  const allLines = (text || "").split(/\r?\n/);
  // Trim trailing empty line that often follows the final newline.
  while (allLines.length > 0 && allLines[allLines.length - 1] === "") {
    allLines.pop();
  }
  const lines = tail !== undefined ? allLines.slice(-tail) : allLines;

  useEffect(() => {
    const prev = prevTextRef.current;
    if (prev && text && text !== prev && text.startsWith(prev)) {
      const newStart = prev.split(/\r?\n/).length - 1;
      const setNew = new Set<number>();
      for (let i = newStart; i < allLines.length; i++) setNew.add(i);
      setNewLineIdxs(setNew);
      const t = setTimeout(() => setNewLineIdxs(new Set()), 250);
      prevTextRef.current = text;
      return () => clearTimeout(t);
    }
    prevTextRef.current = text;
  }, [text]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (stickyBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [text, tail]);

  function onScroll() {
    const el = ref.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
    stickyBottomRef.current = atBottom;
  }

  if (lines.length === 0) {
    return <div className="gray-note">no progress recorded yet</div>;
  }

  const startIdx = allLines.length - lines.length;
  return (
    <div
      ref={ref}
      className={"progress" + (expanded ? " full" : "")}
      onScroll={onScroll}
    >
      {lines.map((raw, i) => {
        const absIdx = startIdx + i;
        const m = raw.match(/^(\S+)\s+(.+)$/);
        const isNew = newLineIdxs.has(absIdx);
        if (m) {
          return (
            <div key={absIdx} className={"line" + (isNew ? " new" : "")}>
              <span className="ts">{m[1]}</span>
              <span>{m[2]}</span>
            </div>
          );
        }
        return (
          <div key={absIdx} className={"line" + (isNew ? " new" : "")}>
            {raw || " "}
          </div>
        );
      })}
    </div>
  );
}
