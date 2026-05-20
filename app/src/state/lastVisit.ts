const KEY = "zutot.observer.lastVisit";

export function readLastVisit(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
    return {};
  } catch {
    return {};
  }
}

export function writeLastVisit(lv: Record<string, string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(lv));
  } catch {
    /* localStorage unavailable; tolerated per spec §7.2 */
  }
}

export function markVisited(slug: string): void {
  const lv = readLastVisit();
  lv[slug] = new Date().toISOString();
  writeLastVisit(lv);
}

export function pruneLastVisit(existingSlugs: Set<string>): void {
  const lv = readLastVisit();
  let changed = false;
  for (const k of Object.keys(lv)) {
    if (!existingSlugs.has(k)) {
      delete lv[k];
      changed = true;
    }
  }
  if (changed) writeLastVisit(lv);
}

export function getLastVisitMs(slug: string): number {
  const lv = readLastVisit();
  const iso = lv[slug];
  if (!iso) return 0;
  const t = Date.parse(iso);
  return isNaN(t) ? 0 : t;
}
