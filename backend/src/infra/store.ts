import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { Review } from "../domain/types";

export interface Store {
  read(appId: string): Promise<Review[]>;
  merge(appId: string, newReviews: Review[]): Promise<void>;
  knownIds(appId: string): Promise<Set<string>>;
}

function isErrno(e: unknown): e is NodeJS.ErrnoException {
  return e instanceof Error && "code" in e;
}

function dedupeById(...lists: Review[][]): Review[] {
  const byId = new Map<string, Review>();
  for (const list of lists) {
    for (const review of list) byId.set(review.id, review);
  }
  return Array.from(byId.values());
}

function sortNewestFirst(reviews: Review[]): Review[] {
  return [...reviews].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await rename(tmp, filePath);
}

// Closure factory rather than class:
// - dataDir is captured once, call sites don't need to pass it in every time
// - No `this` binding needed
// - filePath stays genuinely private (no `#field` ceremony)
export async function createStore(dataDir: string): Promise<Store> {
  await mkdir(dataDir, { recursive: true });

  const filePath = (appId: string) => join(dataDir, `${appId}.json`);

  async function read(appId: string): Promise<Review[]> {
    try {
      const buffer = await readFile(filePath(appId), "utf8");
      return JSON.parse(buffer) as Review[];
    } catch (err) {
      if (isErrno(err) && err.code === "ENOENT") return [];
      throw err;
    }
  }

  async function merge(appId: string, newReviews: Review[]): Promise<void> {
    const existing = await read(appId);
    const merged = sortNewestFirst(dedupeById(existing, newReviews));
    await atomicWriteJson(filePath(appId), merged);
  }

  async function knownIds(appId: string): Promise<Set<string>> {
    const reviews = await read(appId);
    return new Set(reviews.map((r) => r.id));
  }

  return { read, merge, knownIds };
}
