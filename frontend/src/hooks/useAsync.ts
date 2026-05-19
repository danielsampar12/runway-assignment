import { useEffect, useState, type DependencyList } from "react";

export type AsyncState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: string };

/**
 * Run an async fetcher on dependency change and expose a discriminated-union
 * state. Cancels in-flight results on unmount or dep change so stale data
 * doesn't overwrite fresh data.
 *
 * Trade-off: by design, this re-fetches on every dep change with no caching
 * or retry. For richer needs (cache, dedup, refetch on focus), reach for
 * TanStack Query or SWR.
 */
export function useAsync<T>(fetcher: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: "idle" });

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetcher()
      .then((data) => {
        if (cancelled) return;
        setState({ status: "success", data });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          error: err instanceof Error ? err.message : "Unexpected error",
        });
      });
    return () => {
      cancelled = true;
    };
    // The fetcher is intentionally NOT in deps — callers pass `deps` explicitly
    // to control identity. This matches React Query's queryKey pattern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  /* eslint-enable react-hooks/set-state-in-effect */

  return state;
}
