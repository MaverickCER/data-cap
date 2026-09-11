/**
 * The one place `matters.capability.ts` reaches across the network --
 * isomorphic by construction: the exact same code runs in the browser
 * (`npm run dev`) and in `main-headless.ts`'s real Node process, talking to
 * the real HTTP surface `server/http-handler.ts` implements. `credentials:
 * "include"` covers the browser (httpOnly cookies attach automatically;
 * this module can't read them to forward manually, and doesn't need to).
 * Node's own `fetch` has no cookie jar at all, so `setSessionCookie` exists
 * specifically for `main-headless.ts` to forward the session it captured
 * from `/api/login`'s own `Set-Cookie` response header.
 */
let baseUrl = "http://localhost:3000"
let sessionCookie: string | undefined

export function setBaseUrl(url: string): void {
  baseUrl = url
}

export function setSessionCookie(cookie: string | undefined): void {
  sessionCookie = cookie
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  }
  if (sessionCookie !== undefined) headers.cookie = sessionCookie
  const res = await fetch(`${baseUrl}${path}`, { ...init, headers, credentials: "include" })
  if (!res.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} failed with status ${String(res.status)}`)
  }
  return (await res.json()) as T
}

export function apiUrl(path: string): string {
  return `${baseUrl}${path}`
}

export function currentSessionCookie(): string | undefined {
  return sessionCookie
}
