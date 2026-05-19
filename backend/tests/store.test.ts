import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../src/infra/store";
import type { Review } from "../src/domain/types";

function makeReview(id: string, submittedAt: string, overrides: Partial<Review> = {}): Review {
  return {
    id,
    appId: "app1",
    author: "Author",
    score: 5,
    title: "Title",
    content: "Content",
    submittedAt,
    ...overrides,
  };
}

describe("createStore", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "store-test-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  describe("read", () => {
    it("returns empty array when no file exists yet (first run)", async () => {
      const store = await createStore(dataDir);
      expect(await store.read("app1")).toEqual([]);
    });

    it("creates the data directory if it doesn't exist", async () => {
      const nestedDir = join(dataDir, "nested", "deep");
      const store = await createStore(nestedDir);
      expect(await store.read("app1")).toEqual([]);
    });
  });

  describe("merge", () => {
    it("persists reviews so a subsequent read returns them", async () => {
      const store = await createStore(dataDir);
      const review = makeReview("r1", "2026-05-19T00:00:00Z");

      await store.merge("app1", [review]);

      expect(await store.read("app1")).toEqual([review]);
    });

    it("dedupes by id (last write wins)", async () => {
      const store = await createStore(dataDir);
      const original = makeReview("r1", "2026-05-19T00:00:00Z", { title: "Old title" });
      const updated = makeReview("r1", "2026-05-19T00:00:00Z", { title: "New title" });

      await store.merge("app1", [original]);
      await store.merge("app1", [updated]);

      const reviews = await store.read("app1");
      expect(reviews).toHaveLength(1);
      expect(reviews[0]!.title).toBe("New title");
    });

    it("combines existing and new reviews without duplicating", async () => {
      const store = await createStore(dataDir);
      await store.merge("app1", [
        makeReview("a", "2026-05-19T00:00:00Z"),
        makeReview("b", "2026-05-18T00:00:00Z"),
      ]);
      await store.merge("app1", [
        makeReview("b", "2026-05-18T00:00:00Z"), // dup, should be deduped
        makeReview("c", "2026-05-17T00:00:00Z"),
      ]);

      const reviews = await store.read("app1");
      expect(reviews.map((r) => r.id).sort()).toEqual(["a", "b", "c"]);
    });

    it("sorts merged reviews newest-first by submittedAt", async () => {
      const store = await createStore(dataDir);
      await store.merge("app1", [
        makeReview("oldest", "2026-05-01T00:00:00Z"),
        makeReview("newest", "2026-05-19T00:00:00Z"),
        makeReview("middle", "2026-05-10T00:00:00Z"),
      ]);

      const reviews = await store.read("app1");
      expect(reviews.map((r) => r.id)).toEqual(["newest", "middle", "oldest"]);
    });

    it("isolates data between different appIds", async () => {
      const store = await createStore(dataDir);
      await store.merge("app1", [makeReview("a1", "2026-05-19T00:00:00Z")]);
      await store.merge("app2", [makeReview("b1", "2026-05-19T00:00:00Z")]);

      expect((await store.read("app1")).map((r) => r.id)).toEqual(["a1"]);
      expect((await store.read("app2")).map((r) => r.id)).toEqual(["b1"]);
    });

    it("survives a leftover .tmp file from a previous crash", async () => {
      const store = await createStore(dataDir);
      await writeFile(join(dataDir, "app1.json.tmp"), "garbage from a crash", "utf8");

      await store.merge("app1", [makeReview("r1", "2026-05-19T00:00:00Z")]);

      const reviews = await store.read("app1");
      expect(reviews.map((r) => r.id)).toEqual(["r1"]);
    });
  });

  describe("knownIds", () => {
    it("returns empty Set when no data exists", async () => {
      const store = await createStore(dataDir);
      expect(await store.knownIds("app1")).toEqual(new Set());
    });

    it("returns a Set of all stored review IDs", async () => {
      const store = await createStore(dataDir);
      await store.merge("app1", [
        makeReview("a", "2026-05-19T00:00:00Z"),
        makeReview("b", "2026-05-18T00:00:00Z"),
        makeReview("c", "2026-05-17T00:00:00Z"),
      ]);

      const ids = await store.knownIds("app1");
      expect(ids).toEqual(new Set(["a", "b", "c"]));
    });
  });

  describe("restart survival", () => {
    it("preserves data when a fresh createStore is instantiated on the same dir", async () => {
      const first = await createStore(dataDir);
      await first.merge("app1", [
        makeReview("a", "2026-05-19T00:00:00Z"),
        makeReview("b", "2026-05-18T00:00:00Z"),
      ]);

      // Simulate process restart with a new factory instance on the same dataDir
      const second = await createStore(dataDir);
      const reviews = await second.read("app1");

      expect(reviews.map((r) => r.id)).toEqual(["a", "b"]);
    });

    it("preserves data after multiple restart cycles", async () => {
      for (let i = 0; i < 3; i++) {
        const store = await createStore(dataDir);
        await store.merge("app1", [makeReview(`cycle-${i}`, `2026-05-${10 + i}T00:00:00Z`)]);
      }

      const final = await createStore(dataDir);
      const ids = (await final.read("app1")).map((r) => r.id);
      expect(ids.sort()).toEqual(["cycle-0", "cycle-1", "cycle-2"]);
    });
  });

  describe("on-disk format", () => {
    it("writes valid JSON that can be re-read by JSON.parse", async () => {
      const store = await createStore(dataDir);
      await store.merge("app1", [makeReview("r1", "2026-05-19T00:00:00Z")]);

      const raw = await readFile(join(dataDir, "app1.json"), "utf8");
      const parsed = JSON.parse(raw) as Review[];
      expect(parsed[0]!.id).toBe("r1");
    });
  });
});
