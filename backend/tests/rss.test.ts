import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAllNewReviews } from "../src/infra/rss";
import type { AppConfig } from "../src/domain/types";

const APP: AppConfig = { id: "595068606", name: "Headspace", country: "us" };

function makeEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: { label: "default-id" },
    author: { name: { label: "Bob" } },
    "im:rating": { label: "5" },
    title: { label: "Great" },
    content: { label: "Love it" },
    updated: { label: "2026-05-19T10:00:00-07:00" },
    ...overrides,
  };
}

type MockResponse =
  | { ok?: boolean; status?: number; body: unknown }
  | { throws: Error }
  | { jsonThrows: true };

function mockFetch(...responses: MockResponse[]): void {
  const spy = vi.spyOn(global, "fetch");
  for (const r of responses) {
    if ("throws" in r) {
      spy.mockRejectedValueOnce(r.throws);
    } else if ("jsonThrows" in r) {
      spy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("invalid JSON");
        },
      } as unknown as Response);
    } else {
      spy.mockResolvedValueOnce({
        ok: r.ok ?? true,
        status: r.status ?? 200,
        json: async () => r.body,
      } as unknown as Response);
    }
  }
}

describe("fetchAllNewReviews", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("parsing", () => {
    it("maps Apple's labeled shape into Review objects", async () => {
      mockFetch(
        {
          body: {
            feed: {
              entry: [makeEntry({ id: { label: "r1" }, "im:rating": { label: "4" } })],
            },
          },
        },
        { body: { feed: { entry: [] } } },
      );

      const result = await fetchAllNewReviews(APP, new Set(), 2);

      if (!result.success) throw new Error(`expected success, got: ${result.error}`);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        id: "r1",
        appId: "595068606",
        author: "Bob",
        score: 4,
        title: "Great",
        content: "Love it",
        submittedAt: "2026-05-19T10:00:00-07:00",
      });
    });

    it("handles `entry` as a single object (Apple's one-review quirk)", async () => {
      mockFetch({ body: { feed: { entry: makeEntry() } } }, { body: { feed: { entry: [] } } });

      const result = await fetchAllNewReviews(APP, new Set(), 2);
      if (!result.success) throw new Error(`expected success, got: ${result.error}`);
      expect(result.data).toHaveLength(1);
    });

    it("returns empty array when feed has no entries", async () => {
      mockFetch({ body: { feed: {} } });

      const result = await fetchAllNewReviews(APP, new Set(), 1);
      if (!result.success) throw new Error(`expected success, got: ${result.error}`);
      expect(result.data).toEqual([]);
    });
  });

  describe("filtering bad rows", () => {
    it("skips entries without im:rating (app-metadata rows)", async () => {
      mockFetch(
        {
          body: {
            feed: {
              entry: [
                makeEntry({ id: { label: "good" } }),
                { ...makeEntry({ id: { label: "no-rating" } }), "im:rating": undefined },
              ],
            },
          },
        },
        { body: { feed: { entry: [] } } },
      );

      const result = await fetchAllNewReviews(APP, new Set(), 2);
      if (!result.success) throw new Error(`expected success, got: ${result.error}`);
      expect(result.data.map((r) => r.id)).toEqual(["good"]);
    });

    it("skips non-integer ratings", async () => {
      mockFetch(
        {
          body: {
            feed: {
              entry: [
                makeEntry({ id: { label: "five" }, "im:rating": { label: "5" } }),
                makeEntry({ id: { label: "decimal" }, "im:rating": { label: "4.5" } }),
                makeEntry({ id: { label: "garbage" }, "im:rating": { label: "abc" } }),
                makeEntry({ id: { label: "empty" }, "im:rating": { label: "" } }),
              ],
            },
          },
        },
        { body: { feed: { entry: [] } } },
      );

      const result = await fetchAllNewReviews(APP, new Set(), 2);
      if (!result.success) throw new Error(`expected success, got: ${result.error}`);
      expect(result.data.map((r) => r.id)).toEqual(["five"]);
    });

    it("skips ratings outside the 1-5 range", async () => {
      mockFetch(
        {
          body: {
            feed: {
              entry: [
                makeEntry({ id: { label: "ok" }, "im:rating": { label: "3" } }),
                makeEntry({ id: { label: "zero" }, "im:rating": { label: "0" } }),
                makeEntry({ id: { label: "six" }, "im:rating": { label: "6" } }),
                makeEntry({ id: { label: "negative" }, "im:rating": { label: "-1" } }),
              ],
            },
          },
        },
        { body: { feed: { entry: [] } } },
      );

      const result = await fetchAllNewReviews(APP, new Set(), 2);
      if (!result.success) throw new Error(`expected success, got: ${result.error}`);
      expect(result.data.map((r) => r.id)).toEqual(["ok"]);
    });
  });

  describe("error handling", () => {
    it("returns fail with upstream status on non-2xx HTTP response", async () => {
      mockFetch({ ok: false, status: 503, body: {} });

      const result = await fetchAllNewReviews(APP, new Set(), 1);
      if (result.success) throw new Error("expected failure");
      expect(result.status).toBe(503);
      expect(result.error).toContain("503");
    });

    it("returns fail with 504 on network error", async () => {
      mockFetch({ throws: new Error("ECONNREFUSED") });

      const result = await fetchAllNewReviews(APP, new Set(), 1);
      if (result.success) throw new Error("expected failure");
      expect(result.status).toBe(504);
      expect(result.error).toContain("Network error");
    });

    it("returns fail with 502 when response isn't valid JSON", async () => {
      mockFetch({ jsonThrows: true });

      const result = await fetchAllNewReviews(APP, new Set(), 1);
      if (result.success) throw new Error("expected failure");
      expect(result.status).toBe(502);
      expect(result.error).toContain("Invalid JSON");
    });
  });

  describe("pagination", () => {
    it("walks multiple pages and accumulates results", async () => {
      mockFetch(
        { body: { feed: { entry: [makeEntry({ id: { label: "p1-1" } })] } } },
        { body: { feed: { entry: [makeEntry({ id: { label: "p2-1" } })] } } },
        { body: { feed: { entry: [] } } },
      );

      const result = await fetchAllNewReviews(APP, new Set(), 5);
      if (!result.success) throw new Error(`expected success, got: ${result.error}`);
      expect(result.data.map((r) => r.id)).toEqual(["p1-1", "p2-1"]);
    });

    it("stops at the first known ID within a page", async () => {
      const known = new Set(["known"]);
      mockFetch({
        body: {
          feed: {
            entry: [
              makeEntry({ id: { label: "new-1" } }),
              makeEntry({ id: { label: "known" } }),
              makeEntry({ id: { label: "would-be-included-if-not-known" } }),
            ],
          },
        },
      });

      const result = await fetchAllNewReviews(APP, known, 5);
      if (!result.success) throw new Error(`expected success, got: ${result.error}`);
      expect(result.data.map((r) => r.id)).toEqual(["new-1"]);
    });

    it("respects the maxPages cap", async () => {
      mockFetch(
        { body: { feed: { entry: [makeEntry({ id: { label: "p1" } })] } } },
        { body: { feed: { entry: [makeEntry({ id: { label: "p2" } })] } } },
      );

      const result = await fetchAllNewReviews(APP, new Set(), 2);
      if (!result.success) throw new Error(`expected success, got: ${result.error}`);
      expect(result.data.map((r) => r.id)).toEqual(["p1", "p2"]);
    });

    it("bubbles failure from a mid-page fetch", async () => {
      mockFetch(
        { body: { feed: { entry: [makeEntry({ id: { label: "p1" } })] } } },
        { ok: false, status: 429, body: {} },
      );

      const result = await fetchAllNewReviews(APP, new Set(), 5);
      if (result.success) throw new Error("expected failure");
      expect(result.status).toBe(429);
    });
  });
});
