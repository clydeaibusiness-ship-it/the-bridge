// API layer for the Next app. Talks to the existing Express backend, which
// stays the source of truth during the migration. API_BASE is same-origin by
// default; in production the app at app.captainsbridge.io points at the main
// origin via NEXT_PUBLIC_API_BASE. credentials:"include" carries the Clerk
// session cookie.
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "";

export async function apiGet<T = unknown>(path: string): Promise<T> {
  const r = await fetch(API_BASE + path, { credentials: "include" });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
  return r.json() as Promise<T>;
}

export async function apiPost<T = unknown>(path: string, body: unknown): Promise<T> {
  const r = await fetch(API_BASE + path, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${path} -> ${r.status}`);
  return r.json() as Promise<T>;
}
