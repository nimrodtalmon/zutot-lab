import type { DriveToken } from "../types";
import {
  DriveAuthError,
  PageTokenGoneError,
  RateLimitError,
  getStartPageToken,
  listChanges,
} from "./files";

const CHANGES_TOKEN_KEY = "zutot.observer.changesPageToken";

export function readChangesToken(): string | null {
  return localStorage.getItem(CHANGES_TOKEN_KEY);
}

export function writeChangesToken(tok: string): void {
  localStorage.setItem(CHANGES_TOKEN_KEY, tok);
}

export interface PollCallbacks {
  getToken: () => DriveToken | null;
  onAuthError: () => void;
  onSuccess: () => void;
  onTransientError: () => void;
  onChanges: (
    changes: Array<{
      fileId?: string;
      removed?: boolean;
      file?: { id: string; name: string; modifiedTime: string; mimeType: string; parents?: string[]; trashed?: boolean };
    }>,
  ) => Promise<void> | void;
}

interface PollerHandle {
  stop: () => void;
  bump: () => void;
}

export function startPoller(cb: PollCallbacks): PollerHandle {
  let stopped = false;
  let inFlight = false;
  let timer: number | null = null;
  let rateLimitedUntil = 0;

  function nextDelay(): number {
    const hidden = document.hidden === true;
    return hidden ? 60_000 : 5_000;
  }

  async function tick() {
    if (stopped) return;
    if (inFlight) {
      schedule();
      return;
    }
    if (Date.now() < rateLimitedUntil) {
      schedule(rateLimitedUntil - Date.now());
      return;
    }
    const t = cb.getToken();
    if (!t) {
      schedule();
      return;
    }

    inFlight = true;
    try {
      let pageToken = readChangesToken();
      if (!pageToken) {
        pageToken = await getStartPageToken(t);
        writeChangesToken(pageToken);
      }
      let nextToken = pageToken;
      let collected: any[] = [];
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const res = await listChanges(t, nextToken);
        collected = collected.concat(res.changes ?? []);
        if (res.nextPageToken) {
          nextToken = res.nextPageToken;
          continue;
        }
        if (res.newStartPageToken) {
          writeChangesToken(res.newStartPageToken);
        }
        break;
      }
      if (collected.length > 0) {
        await cb.onChanges(collected);
      }
      cb.onSuccess();
    } catch (e) {
      if (e instanceof DriveAuthError) {
        cb.onAuthError();
      } else if (e instanceof PageTokenGoneError) {
        // re-seed token; caller's onChanges loop will eventually re-derive.
        try {
          const t2 = cb.getToken();
          if (t2) {
            const tok = await getStartPageToken(t2);
            writeChangesToken(tok);
          }
        } catch (e2) {
          console.warn("re-seed page token failed", e2);
        }
      } else if (e instanceof RateLimitError) {
        rateLimitedUntil = Date.now() + 30_000;
        cb.onTransientError();
      } else {
        cb.onTransientError();
        console.warn("poll error", e);
      }
    } finally {
      inFlight = false;
      schedule();
    }
  }

  function schedule(delay?: number) {
    if (stopped) return;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    timer = window.setTimeout(tick, delay ?? nextDelay());
  }

  function bump() {
    if (stopped) return;
    if (timer !== null) clearTimeout(timer);
    timer = window.setTimeout(tick, 0);
  }

  const visHandler = () => {
    bump();
  };
  document.addEventListener("visibilitychange", visHandler);

  schedule(500);

  return {
    stop: () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener("visibilitychange", visHandler);
    },
    bump,
  };
}
