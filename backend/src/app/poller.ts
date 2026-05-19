import type { AppConfig } from "../domain/types";
import { fetchAllNewReviews } from "../infra/rss";
import type { Store } from "../infra/store";

export interface Poller {
  start(): void;
  stop(): void;
}

export function createPoller(apps: AppConfig[], store: Store, intervalMs = 5000): Poller {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  async function pollOnce(): Promise<void> {
    for (const app of apps) {
      try {
        const knownIds = await store.knownIds(app.id);
        const result = await fetchAllNewReviews(app, knownIds);
        if (!result.success) {
          console.error(`[${app.name}] fetch failed: ${result.error}`);
          continue;
        }
        if (result.data.length === 0) continue;
        await store.merge(app.id, result.data);
        console.log(`[${app.name}] merged ${result.data.length} new reviews`);
      } catch (err) {
        console.error(`[${app.name}] poll error:`, err);
      }
    }
  }

  async function tick(): Promise<void> {
    await pollOnce();
    if (!stopped) timer = setTimeout(tick, intervalMs);
  }

  function start() {
    stopped = false;
    void tick();
  }

  function stop() {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return {
    start,
    stop,
  };
}
