export interface Route {
  threadSlug: string | null;
  jobId: string | null;
}

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#/, "");
  if (!h) return { threadSlug: null, jobId: null };
  const [slug, jobId] = h.split("/", 2);
  return {
    threadSlug: slug || null,
    jobId: jobId || null,
  };
}

export function buildHash(route: Route): string {
  if (!route.threadSlug) return "";
  if (!route.jobId) return `#${route.threadSlug}`;
  return `#${route.threadSlug}/${route.jobId}`;
}

export function pushRoute(route: Route): void {
  const hash = buildHash(route);
  const url =
    window.location.pathname + window.location.search + (hash || "");
  history.pushState(null, "", url);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

export function replaceRoute(route: Route): void {
  const hash = buildHash(route);
  const url =
    window.location.pathname + window.location.search + (hash || "");
  history.replaceState(null, "", url);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
