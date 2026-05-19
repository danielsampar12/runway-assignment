package rss

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"

	"runway/backend/internal/domain"
)

type labeled struct {
	Label string `json:"label"`
}

type rawEntry struct {
	ID       labeled   `json:"id"`
	Author   rawAuthor `json:"author"`
	ImRating *labeled  `json:"im:rating,omitempty"`
	Title    labeled   `json:"title"`
	Content  labeled   `json:"content"`
	Updated  labeled   `json:"updated"`
}

type rawAuthor struct {
	Name labeled `json:"name"`
}

type rawFeed struct {
	Feed struct {
		// Apple sends `entry` as an array OR a single object when there's
		// exactly one review. We use RawMessage to handle both shapes.
		Entry json.RawMessage `json:"entry,omitempty"`
	} `json:"feed"`
}

func normalizeEntries(raw json.RawMessage) ([]rawEntry, error) {
	if len(raw) == 0 {
		return nil, nil
	}

	// Try array first.
	var arr []rawEntry
	if err := json.Unmarshal(raw, &arr); err == nil {
		return arr, nil
	}

	// Fall back to single object.
	var single rawEntry
	if err := json.Unmarshal(raw, &single); err != nil {
		return nil, err
	}
	return []rawEntry{single}, nil
}

func toReview(e rawEntry, appID string) *domain.Review {
	// Entries without im:rating are usually app-metadata rows — skip.
	if e.ImRating == nil || e.ImRating.Label == "" {
		return nil
	}

	score, err := strconv.Atoi(e.ImRating.Label)
	if err != nil || score < 1 || score > 5 {
		return nil
	}

	if e.ID.Label == "" || e.Author.Name.Label == "" || e.Content.Label == "" || e.Updated.Label == "" {
		return nil
	}

	return &domain.Review{
		ID:          e.ID.Label,
		AppID:       appID,
		Author:      e.Author.Name.Label,
		Score:       score,
		Title:       e.Title.Label,
		Content:     e.Content.Label,
		SubmittedAt: e.Updated.Label,
	}
}

func buildFeedURL(appID, country string, page int) string {
	return fmt.Sprintf(
		"https://itunes.apple.com/%s/rss/customerreviews/id=%s/sortBy=mostRecent/page=%d/json",
		country, appID, page,
	)
}

// FetchReviewsPage fetches a single page of Apple's RSS for the given app.
// Returns the parsed reviews from that page, dropping any malformed entries.
func FetchReviewsPage(appID, country string, page int) ([]domain.Review, error) {
	url := buildFeedURL(appID, country, page)

	res, err := http.Get(url)
	if err != nil {
		return nil, fmt.Errorf("network error fetching %s: %w", url, err)
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("apple rss responded %d for %s", res.StatusCode, url)
	}

	body, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, fmt.Errorf("reading body: %w", err)
	}

	var feed rawFeed
	if err := json.Unmarshal(body, &feed); err != nil {
		return nil, fmt.Errorf("invalid json from %s: %w", url, err)
	}

	entries, err := normalizeEntries(feed.Feed.Entry)
	if err != nil {
		return nil, fmt.Errorf("normalizing entries: %w", err)
	}

	reviews := make([]domain.Review, 0, len(entries))
	for _, e := range entries {
		if r := toReview(e, appID); r != nil {
			reviews = append(reviews, *r)
		}
	}
	return reviews, nil
}

// FetchAllNewReviews walks pages 1..maxPages, accumulating reviews until it
// hits a known ID (Apple's mostRecent sort means everything older is also
// known) or an empty page.
//
// A poll gap longer than ~1 page's worth of reviews could leave older-but-
// unseen reviews lost.
func FetchAllNewReviews(app domain.AppConfig, knownIDs map[string]struct{}, maxPages int) ([]domain.Review, error) {
	if maxPages <= 0 {
		maxPages = 10
	}

	var collected []domain.Review
	for page := 1; page <= maxPages; page++ {
		reviews, err := FetchReviewsPage(app.ID, app.Country, page)
		if err != nil {
			return nil, err
		}
		if len(reviews) == 0 {
			break
		}

		sawKnown := false
		for _, r := range reviews {
			if _, ok := knownIDs[r.ID]; ok {
				sawKnown = true
				break
			}
			collected = append(collected, r)
		}
		if sawKnown {
			break
		}
	}
	return collected, nil
}
