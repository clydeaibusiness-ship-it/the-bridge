// API layer for the Next app. Talks to the existing Express backend, which
// stays the source of truth during the migration. API_BASE is same-origin by
// default; in production the app at app.captainsbridge.io points at the main
// origin via NEXT_PUBLIC_API_BASE. Auth is a Clerk session token sent as a
// Bearer header (the Express clerkMiddleware validates it), so no cross-domain
// cookies are needed.
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "";

function headers(token?: string | null, json = false): HeadersInit {
  const h: Record<string, string> = {};
  if (json) h["Content-Type"] = "application/json";
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

export async function apiGet<T = unknown>(path: string, token?: string | null): Promise<T> {
  const r = await fetch(API_BASE + path, { headers: headers(token) });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
  return r.json() as Promise<T>;
}

export async function apiPost<T = unknown>(path: string, body: unknown, token?: string | null): Promise<T> {
  const r = await fetch(API_BASE + path, {
    method: "POST",
    headers: headers(token, true),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${path} -> ${r.status}`);
  return r.json() as Promise<T>;
}

export async function apiDelete<T = unknown>(path: string, token?: string | null): Promise<T> {
  const r = await fetch(API_BASE + path, { method: "DELETE", headers: headers(token) });
  if (!r.ok) throw new Error(`DELETE ${path} -> ${r.status}`);
  return r.json() as Promise<T>;
}
