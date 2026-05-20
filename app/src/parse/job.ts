export interface JobSpec {
  title: string;
  threadSlug: string | null;
  budget?: string;
  body: string;
}

const titleRe = /^#\s+Job:\s+(.+)$/;
const threadRe = /^Thread:\s*(\S+)$/;
const budgetRe = /^Budget:\s*(.+)$/;

export function parseJobSpec(id: string, content: string): JobSpec {
  const lines = content.split(/\r?\n/);
  let title: string | undefined;
  let threadSlug: string | null = null;
  let budget: string | undefined;

  let fieldsEnd = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("##")) {
      fieldsEnd = i;
      break;
    }
    const t = line.match(titleRe);
    if (t && title === undefined) {
      title = t[1].trim();
      fieldsEnd = i + 1;
      continue;
    }
    const th = line.match(threadRe);
    if (th && threadSlug === null) {
      threadSlug = th[1].trim();
      fieldsEnd = i + 1;
      continue;
    }
    const b = line.match(budgetRe);
    if (b && budget === undefined) {
      budget = b[1].trim();
      fieldsEnd = i + 1;
      continue;
    }
    if (line.trim() !== "" && i > 0) {
      // If we hit a non-empty, non-matching, non-field line we let it pass —
      // we keep scanning until a heading or eof to capture trailing fields.
    }
  }

  const body = lines.slice(fieldsEnd).join("\n").replace(/^\n+/, "");

  return {
    title: title ?? id,
    threadSlug,
    budget,
    body,
  };
}
