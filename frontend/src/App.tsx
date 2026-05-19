import { useState } from "react";
import { fetchApps, fetchReviews } from "./api";
import { ReviewList } from "./components/ReviewList";
import { useAsync } from "./hooks/useAsync";
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

function App() {
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [windowHours, setWindowHours] = useState<number>(48);

  const appsState = useAsync(() => fetchApps(), []);
  const apps = appsState.status === "success" ? appsState.data : [];

  // Derive the "currently shown" app id rather than syncing it back into
  // state in a useEffect — avoids the initial render where nothing is selected
  // and the cascade of effects that would follow.
  const effectiveAppId = selectedAppId ?? apps[0]?.id ?? null;
  const selectedApp = apps.find((a) => a.id === effectiveAppId) ?? null;

  const reviewsState = useAsync(
    () => (effectiveAppId ? fetchReviews(effectiveAppId, windowHours) : Promise.resolve([])),
    [effectiveAppId, windowHours],
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
                  {(value: string) => apps.find((a) => a.id === value)?.name ?? "Select an app"}
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
        {appsState.status === "error" && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircleIcon />
            <AlertTitle>Couldn&apos;t load apps</AlertTitle>
            <AlertDescription>{appsState.error}</AlertDescription>
          </Alert>
        )}

        {selectedApp && (
          <p className="mb-5 text-sm text-muted-foreground">
            Showing reviews for{" "}
            <span className="font-medium text-foreground">{selectedApp.name}</span> (
            {selectedApp.country.toUpperCase()})
            {reviewsState.status === "loading"
              ? " — loading…"
              : reviewsState.status === "success"
                ? ` — ${reviewsState.data.length} review${
                    reviewsState.data.length === 1 ? "" : "s"
                  }`
                : ""}
          </p>
        )}

        {reviewsState.status === "error" && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircleIcon />
            <AlertTitle>Couldn&apos;t load reviews</AlertTitle>
            <AlertDescription>{reviewsState.error}</AlertDescription>
          </Alert>
        )}

        {reviewsState.status === "loading" && (
          <div className="flex flex-col gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        )}

        {reviewsState.status === "success" &&
          reviewsState.data.length === 0 &&
          selectedApp && (
            <p className="py-8 text-center italic text-muted-foreground">
              No reviews in the selected window.
            </p>
          )}

        {reviewsState.status === "success" && reviewsState.data.length > 0 && (
          <ReviewList reviews={reviewsState.data} />
        )}
      </main>
    </div>
  );
}

export default App;
