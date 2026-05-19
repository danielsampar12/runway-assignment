package rss

import (
	"encoding/json"
	"testing"
)

func validEntry() rawEntry {
	return rawEntry{
		ID:       labeled{Label: "r1"},
		Author:   rawAuthor{Name: labeled{Label: "Bob"}},
		ImRating: &labeled{Label: "5"},
		Title:    labeled{Label: "Great"},
		Content:  labeled{Label: "Love it"},
		Updated:  labeled{Label: "2026-05-19T10:00:00-07:00"},
	}
}

func TestToReview_ValidEntry(t *testing.T) {
	r := toReview(validEntry(), "app1")
	if r == nil {
		t.Fatal("expected a review, got nil")
	}
	if r.ID != "r1" || r.AppID != "app1" || r.Author != "Bob" || r.Score != 5 {
		t.Errorf("unexpected review: %+v", r)
	}
	if r.SubmittedAt != "2026-05-19T10:00:00-07:00" {
		t.Errorf("unexpected submittedAt: %q", r.SubmittedAt)
	}
}

func TestToReview_SkipsWithoutRating(t *testing.T) {
	e := validEntry()
	e.ImRating = nil
	if r := toReview(e, "app1"); r != nil {
		t.Errorf("expected nil for missing im:rating, got %+v", r)
	}
}

func TestToReview_SkipsEmptyRating(t *testing.T) {
	e := validEntry()
	e.ImRating = &labeled{Label: ""}
	if r := toReview(e, "app1"); r != nil {
		t.Errorf("expected nil for empty rating, got %+v", r)
	}
}

func TestToReview_SkipsNonIntegerRating(t *testing.T) {
	cases := []string{"abc", "4.5", "", " "}
	for _, c := range cases {
		e := validEntry()
		e.ImRating = &labeled{Label: c}
		if r := toReview(e, "app1"); r != nil {
			t.Errorf("rating %q: expected nil, got %+v", c, r)
		}
	}
}

func TestToReview_SkipsOutOfRangeRating(t *testing.T) {
	for _, raw := range []string{"0", "6", "-1", "10"} {
		e := validEntry()
		e.ImRating = &labeled{Label: raw}
		if r := toReview(e, "app1"); r != nil {
			t.Errorf("rating %q: expected nil, got %+v", raw, r)
		}
	}
}

func TestToReview_AcceptsAllValidRatings(t *testing.T) {
	for _, raw := range []string{"1", "2", "3", "4", "5"} {
		e := validEntry()
		e.ImRating = &labeled{Label: raw}
		if r := toReview(e, "app1"); r == nil {
			t.Errorf("rating %q: expected valid review, got nil", raw)
		}
	}
}

func TestToReview_SkipsMissingRequiredFields(t *testing.T) {
	cases := map[string]func(e *rawEntry){
		"missing id":      func(e *rawEntry) { e.ID.Label = "" },
		"missing author":  func(e *rawEntry) { e.Author.Name.Label = "" },
		"missing content": func(e *rawEntry) { e.Content.Label = "" },
		"missing updated": func(e *rawEntry) { e.Updated.Label = "" },
	}
	for name, mutate := range cases {
		e := validEntry()
		mutate(&e)
		if r := toReview(e, "app1"); r != nil {
			t.Errorf("%s: expected nil, got %+v", name, r)
		}
	}
}

func TestNormalizeEntries_Empty(t *testing.T) {
	got, err := normalizeEntries(nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != nil {
		t.Errorf("expected nil, got %+v", got)
	}
}

func TestNormalizeEntries_Array(t *testing.T) {
	raw := json.RawMessage(`[
		{"id":{"label":"a"}, "author":{"name":{"label":"x"}}, "im:rating":{"label":"5"}, "title":{"label":"t"}, "content":{"label":"c"}, "updated":{"label":"u"}},
		{"id":{"label":"b"}, "author":{"name":{"label":"y"}}, "im:rating":{"label":"4"}, "title":{"label":"t"}, "content":{"label":"c"}, "updated":{"label":"u"}}
	]`)
	got, err := normalizeEntries(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(got))
	}
	if got[0].ID.Label != "a" || got[1].ID.Label != "b" {
		t.Errorf("unexpected IDs: %s, %s", got[0].ID.Label, got[1].ID.Label)
	}
}

func TestNormalizeEntries_SingleObject(t *testing.T) {
	raw := json.RawMessage(`{"id":{"label":"only"}, "author":{"name":{"label":"x"}}, "im:rating":{"label":"5"}, "title":{"label":"t"}, "content":{"label":"c"}, "updated":{"label":"u"}}`)
	got, err := normalizeEntries(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(got))
	}
	if got[0].ID.Label != "only" {
		t.Errorf("unexpected ID: %s", got[0].ID.Label)
	}
}

func TestNormalizeEntries_Invalid(t *testing.T) {
	raw := json.RawMessage(`not json`)
	if _, err := normalizeEntries(raw); err == nil {
		t.Error("expected an error for invalid JSON, got nil")
	}
}

func TestBuildFeedURL(t *testing.T) {
	got := buildFeedURL("595068606", "us", 1)
	want := "https://itunes.apple.com/us/rss/customerreviews/id=595068606/sortBy=mostRecent/page=1/json"
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}
