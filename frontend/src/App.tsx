import { useState } from "react";
import useSWR from "swr";
import { fetchApps, fetchReviews } from "./api";
import { ReviewList } from "./components/ReviewList";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircleIcon } from "lucide-react";

const WINDOW_OPTIONS = [
  { label: "48 hours", value: 48 },
  { label: "7 days", value: 24 * 7 },
  { label: "30 days", value: 24 * 30 },
];

// Matches the backend's pollIntervalMs (config.json). The frontend revalidates
// reviews on the same cadence as the upstream RSS poller, so new
// reviews surface in the UI without needing to refresh.
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

function App() {
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [windowHours, setWindowHours] = useState<number>(48);

  const { data: appsData, error: appsError } = useSWR("apps", fetchApps);
  const apps = appsData ?? [];

  const effectiveAppId = selectedAppId ?? apps[0]?.id ?? null;
  const selectedApp = apps.find((a) => a.id === effectiveAppId) ?? null;

  const {
    data: reviews,
    error: reviewsError,
    isLoading: reviewsLoading,
  } = useSWR(
    effectiveAppId ? (["reviews", effectiveAppId, windowHours] as const) : null,
    ([, id, hours]) => fetchReviews(id, hours),
    { refreshInterval: REFRESH_INTERVAL_MS },
  );

  return (
    <div className="mx-auto max-w-3xl px-5 py-8 sm:py-12">
      <header className="mb-6 border-b pb-4">
        <h1 className="mb-4 text-2xl font-semibold tracking-tight">
          Recent App Store Reviews
        </h1>
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-muted-foreground">App</span>
            <Select
              value={effectiveAppId ?? ""}
              onValueChange={setSelectedAppId}
              disabled={apps.length === 0}
            >
              <SelectTrigger className="min-w-[180px]">
                <SelectValue placeholder="Select an app">
                  {(value: string) =>
                    apps.find((a) => a.id === value)?.name ?? "Select an app"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {apps.map((app) => (
                  <SelectItem key={app.id} value={app.id}>
                    {app.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-muted-foreground">Window</span>
            <Select
              value={String(windowHours)}
              onValueChange={(value) => setWindowHours(Number(value))}
            >
              <SelectTrigger className="min-w-[140px]">
                <SelectValue>
                  {(value: string) =>
                    WINDOW_OPTIONS.find((o) => String(o.value) === value)?.label ?? value
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {WINDOW_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={String(opt.value)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
      </header>

      <main>
        {appsError && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircleIcon />
            <AlertTitle>Couldn&apos;t load apps</AlertTitle>
            <AlertDescription>{(appsError as Error).message}</AlertDescription>
          </Alert>
        )}

        {selectedApp && (
          <p className="mb-5 text-sm text-muted-foreground">
            Showing reviews for{" "}
            <span className="font-medium text-foreground">{selectedApp.name}</span> (
            {selectedApp.country.toUpperCase()})
            {reviewsLoading
              ? " — loading…"
              : reviewsError
                ? ""
                : ` — ${reviews?.length ?? 0} review${
                    (reviews?.length ?? 0) === 1 ? "" : "s"
                  }`}
          </p>
        )}

        {reviewsError && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircleIcon />
            <AlertTitle>Couldn&apos;t load reviews</AlertTitle>
            <AlertDescription>{(reviewsError as Error).message}</AlertDescription>
          </Alert>
        )}

        {reviewsLoading && (
          <div className="flex flex-col gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        )}

        {!reviewsLoading && !reviewsError && reviews && reviews.length === 0 && selectedApp && (
          <p className="py-8 text-center italic text-muted-foreground">
            No reviews in the selected window.
          </p>
        )}

        {reviews && reviews.length > 0 && <ReviewList reviews={reviews} />}
      </main>
    </div>
  );
}

export default App;
