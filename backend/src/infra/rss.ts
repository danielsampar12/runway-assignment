import type { AppConfig, Review } from "../domain/types";
import { ok, fail, type Result } from "../lib/result";

type Labeled = { label: string };

type RawEntry = {
  id: Labeled;
  author: { name: Labeled };
  "im:rating"?: Labeled;
  title: Labeled;
  content: Labeled;
  updated: Labeled;
};

type RawFeed = {
  feed: {
    entry?: RawEntry | RawEntry[];
  };
};

type FetchParams = {
  appId: string;
  country: string;
  page: number;
};

function buildFeedUrl({ appId, country, page }: FetchParams): string {
  return `https://itunes.apple.com/${country}/rss/customerreviews/id=${appId}/sortBy=mostRecent/page=${page}/json`;
}

function toReview(raw: RawEntry, appId: string): Review | null {
  const ratingLabel = raw["im:rating"]?.label;
  if (!ratingLabel) return null;

  const score = Number(ratingLabel);
  if (!Number.isInteger(score) || score < 1 || score > 5) return null;

  return {
    id: raw.id.label,
    appId,
    author: raw.author.name.label,
    title: raw.title.label,
    score,
    content: raw.content.label,
    submittedAt: raw.updated.label,
  };
}

async function fetchReviewsPage(params: FetchParams): Promise<Result<Review[], string>> {
  const url = buildFeedUrl(params);

  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    return fail(`Network error fetching ${url}: ${(err as Error).message}`, 504);
  }

  if (!res.ok) {
    return fail(`Apple RSS responded ${res.status} for ${url}`, res.status);
  }

  let raw: RawFeed;
  try {
    raw = (await res.json()) as RawFeed;
  } catch (err) {
    return fail(`Invalid JSON from ${url}: ${(err as Error).message}`, 502);
  }

  const entries = raw.feed.entry;
  if (!entries) return ok([]);

  const list = Array.isArray(entries) ? entries : [entries];
  return ok(list.map((e) => toReview(e, params.appId)).filter((r): r is Review => r !== null));
}

// For a 48h window fetch all reviews is ok
// I'm using for loop for simplicity
export async function fetchAllNewReviews(
  app: AppConfig,
  knownIds: Set<string>,
  maxPages = 10,
): Promise<Result<Review[], string>> {
  const collected: Review[] = [];
  for (let page = 1; page <= maxPages; page++) {
    let sawKnown = false;
    const result = await fetchReviewsPage({ appId: app.id, country: app.country, page });

    if (!result.success) return result;
    if (result.data.length === 0) break;

    for (const review of result.data) {
      if (knownIds.has(review.id)) {
        sawKnown = true;
        break;
      }

      collected.push(review);
    }
    // (Edge case): This break on known assumes Apple's sortby=mostRecent order is consistent meaning everyting older is also known.
    // a poll gap longer than ~1 page could elave older but unseen reviews lost
    if (sawKnown) break;
  }

  return ok(collected);
}
