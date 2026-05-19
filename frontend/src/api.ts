import type { AppInfo, Review } from "./types";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      // body wasn't JSON; ignore
    }
    const detail =
      typeof body === "object" && body !== null && "error" in body
        ? ` — ${String((body as { error: unknown }).error)}`
        : "";
    throw new Error(`HTTP ${res.status}${detail}`);
  }
  return res.json() as Promise<T>;
}

export function fetchApps(): Promise<AppInfo[]> {
  return getJson<AppInfo[]>("/api/apps");
}

export function fetchReviews(appId: string, windowHours: number): Promise<Review[]> {
  return getJson<Review[]>(
    `/api/apps/${encodeURIComponent(appId)}/reviews?windowHours=${windowHours}`,
  );
}
