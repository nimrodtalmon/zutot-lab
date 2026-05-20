import type { DriveToken } from "../types";

const TOKEN_KEY = "zutot.observer.driveToken";
const PKCE_KEY = "zutot.observer.pkce";
const SCOPE = "https://www.googleapis.com/auth/drive.readonly";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

export function getClientId(): string {
  if (!CLIENT_ID) {
    throw new Error(
      "VITE_GOOGLE_CLIENT_ID is not configured. Set it in your env or .env.local.",
    );
  }
  return CLIENT_ID;
}

export function readToken(): DriveToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as DriveToken;
    if (!t.access || typeof t.expiry !== "number") return null;
    return t;
  } catch {
    return null;
  }
}

export function writeToken(t: DriveToken): void {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function isExpired(t: DriveToken | null, skewMs = 60_000): boolean {
  if (!t) return true;
  return Date.now() + skewMs >= t.expiry;
}

function randomString(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

function base64url(buf: ArrayBuffer | Uint8Array): string {
  const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(s: string): Promise<string> {
  const enc = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  return base64url(hash);
}

export async function startAuthFlow(): Promise<void> {
  const verifier = randomString(48);
  const challenge = await sha256(verifier);
  const state = randomString(16);
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));

  const params = new URLSearchParams({
    client_id: getClientId(),
    redirect_uri: window.location.origin + window.location.pathname,
    response_type: "code",
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    access_type: "online",
    include_granted_scopes: "true",
    prompt: "consent",
  });
  window.location.assign(
    "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString(),
  );
}

export async function finishAuthFlowIfNeeded(): Promise<DriveToken | null> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  if (!code) return null;

  const rawPkce = sessionStorage.getItem(PKCE_KEY);
  if (!rawPkce) return null;
  let pkce: { verifier: string; state: string };
  try {
    pkce = JSON.parse(rawPkce);
  } catch {
    return null;
  }
  if (stateParam !== pkce.state) return null;

  const body = new URLSearchParams({
    client_id: getClientId(),
    code,
    code_verifier: pkce.verifier,
    grant_type: "authorization_code",
    redirect_uri: window.location.origin + window.location.pathname,
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    sessionStorage.removeItem(PKCE_KEY);
    throw new Error("Token exchange failed: " + (await res.text()));
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };
  const tok: DriveToken = {
    access: data.access_token,
    refresh: data.refresh_token,
    expiry: Date.now() + (data.expires_in - 30) * 1000,
  };
  writeToken(tok);
  sessionStorage.removeItem(PKCE_KEY);

  // Scrub the code/state params from the URL.
  url.searchParams.delete("code");
  url.searchParams.delete("state");
  url.searchParams.delete("scope");
  url.searchParams.delete("authuser");
  url.searchParams.delete("prompt");
  history.replaceState(null, "", url.pathname + url.search + url.hash);

  return tok;
}

export function authHeader(t: DriveToken): Record<string, string> {
  return { Authorization: `Bearer ${t.access}` };
}
