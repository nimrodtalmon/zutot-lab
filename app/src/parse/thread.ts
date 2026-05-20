import type { ThreadFile } from "../types";

export function parseThread(
  slug: string,
  body: string,
  mtime: number,
): ThreadFile {
  const lines = body.split(/\r?\n/);

  let title: string | undefined;
  let overleaf: string | undefined;
  let status: string | undefined;
  let notes: string | undefined;

  const titleRe = /^#\s+(.+)$/;
  const overleafRe = /^Overleaf:\s*(\S+)/;
  const statusRe = /^Status:\s*(.+)$/;
  const notesHeadRe = /^##\s+Notes\s*$/;

  let notesStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (title === undefined) {
      const m = line.match(titleRe);
      if (m) {
        title = m[1].trim();
        continue;
      }
    }
    if (overleaf === undefined) {
      const m = line.match(overleafRe);
      if (m) {
        overleaf = m[1].trim();
        continue;
      }
    }
    if (status === undefined) {
      const m = line.match(statusRe);
      if (m) {
        status = m[1].trim();
        continue;
      }
    }
    if (notesStart === -1 && notesHeadRe.test(line)) {
      notesStart = i + 1;
    }
  }
  if (notesStart >= 0) {
    notes = lines.slice(notesStart).join("\n").replace(/^\s+/, "");
  }

  return {
    slug,
    title: title ?? slug,
    overleaf,
    status,
    notes,
    mtime,
    body,
  };
}
