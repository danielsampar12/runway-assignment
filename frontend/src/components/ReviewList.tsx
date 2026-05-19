import type { Review } from "../types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  reviews: Review[];
}

function StarRating({ score }: { score: number }) {
  const safe = Math.max(0, Math.min(5, Math.round(score)));
  return (
    <span
      className="whitespace-nowrap tracking-wider text-amber-500"
      aria-label={`${safe} out of 5 stars`}
    >
      {"★".repeat(safe)}
      <span className="text-muted-foreground/40">{"★".repeat(5 - safe)}</span>
    </span>
  );
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function ReviewList({ reviews }: Props) {
  return (
    <ul className="flex flex-col gap-3 p-0">
      {reviews.map((review) => (
        <li key={review.id} className="list-none">
          <Card>
            <CardHeader className="flex flex-row items-baseline justify-between gap-3">
              <CardTitle className="text-base">{review.title || "(no title)"}</CardTitle>
              <StarRating score={review.score} />
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <p className="whitespace-pre-wrap break-words leading-relaxed text-foreground">
                {review.content}
              </p>
              <footer className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="font-medium">{review.author}</span>
                <span className="opacity-50">·</span>
                <time dateTime={review.submittedAt}>{formatWhen(review.submittedAt)}</time>
              </footer>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
