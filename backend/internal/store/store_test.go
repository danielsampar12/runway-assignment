package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"runway/backend/internal/domain"
)

func tempStore(t *testing.T) (*Store, string) {
	t.Helper()
	dir := t.TempDir()
	s, err := New(dir)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return s, dir
}

func makeReview(id, submittedAt string) domain.Review {
	return domain.Review{
		ID:          id,
		AppID:       "app1",
		Author:      "Author",
		Score:       5,
		Title:       "Title",
		Content:     "Content",
		SubmittedAt: submittedAt,
	}
}

func TestRead_EmptyWhenMissing(t *testing.T) {
	s, _ := tempStore(t)
	reviews, err := s.Read("app1")
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if len(reviews) != 0 {
		t.Errorf("expected empty, got %d entries", len(reviews))
	}
}

func TestNew_CreatesNestedDir(t *testing.T) {
	base := t.TempDir()
	nested := filepath.Join(base, "nested", "deep")
	s, err := New(nested)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if _, err := s.Read("anything"); err != nil {
		t.Fatalf("Read after nested mkdir: %v", err)
	}
}

func TestMerge_PersistsReviews(t *testing.T) {
	s, _ := tempStore(t)
	r := makeReview("r1", "2026-05-19T00:00:00Z")
	if err := s.Merge("app1", []domain.Review{r}); err != nil {
		t.Fatalf("Merge: %v", err)
	}

	got, err := s.Read("app1")
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if len(got) != 1 || got[0].ID != "r1" {
		t.Errorf("unexpected stored reviews: %+v", got)
	}
}

func TestMerge_DedupesByID(t *testing.T) {
	s, _ := tempStore(t)

	original := makeReview("r1", "2026-05-19T00:00:00Z")
	original.Title = "Old"
	updated := makeReview("r1", "2026-05-19T00:00:00Z")
	updated.Title = "New"

	if err := s.Merge("app1", []domain.Review{original}); err != nil {
		t.Fatal(err)
	}
	if err := s.Merge("app1", []domain.Review{updated}); err != nil {
		t.Fatal(err)
	}

	reviews, _ := s.Read("app1")
	if len(reviews) != 1 {
		t.Fatalf("expected 1 review, got %d", len(reviews))
	}
	if reviews[0].Title != "New" {
		t.Errorf("expected last-write-wins title=New, got %q", reviews[0].Title)
	}
}

func TestMerge_CombinesAcrossCalls(t *testing.T) {
	s, _ := tempStore(t)

	if err := s.Merge("app1", []domain.Review{
		makeReview("a", "2026-05-19T00:00:00Z"),
		makeReview("b", "2026-05-18T00:00:00Z"),
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.Merge("app1", []domain.Review{
		makeReview("b", "2026-05-18T00:00:00Z"), // dup
		makeReview("c", "2026-05-17T00:00:00Z"),
	}); err != nil {
		t.Fatal(err)
	}

	reviews, _ := s.Read("app1")
	ids := make([]string, len(reviews))
	for i, r := range reviews {
		ids[i] = r.ID
	}
	sort.Strings(ids)
	want := []string{"a", "b", "c"}
	if len(ids) != len(want) {
		t.Fatalf("expected %v, got %v", want, ids)
	}
	for i, id := range want {
		if ids[i] != id {
			t.Errorf("at %d: got %q, want %q", i, ids[i], id)
		}
	}
}

func TestMerge_SortsNewestFirst(t *testing.T) {
	s, _ := tempStore(t)
	if err := s.Merge("app1", []domain.Review{
		makeReview("oldest", "2026-05-01T00:00:00Z"),
		makeReview("newest", "2026-05-19T00:00:00Z"),
		makeReview("middle", "2026-05-10T00:00:00Z"),
	}); err != nil {
		t.Fatal(err)
	}

	reviews, _ := s.Read("app1")
	wantOrder := []string{"newest", "middle", "oldest"}
	for i, want := range wantOrder {
		if reviews[i].ID != want {
			t.Errorf("position %d: got %q, want %q", i, reviews[i].ID, want)
		}
	}
}

func TestMerge_IsolatesByAppID(t *testing.T) {
	s, _ := tempStore(t)
	if err := s.Merge("app1", []domain.Review{makeReview("a1", "2026-05-19T00:00:00Z")}); err != nil {
		t.Fatal(err)
	}
	if err := s.Merge("app2", []domain.Review{makeReview("b1", "2026-05-19T00:00:00Z")}); err != nil {
		t.Fatal(err)
	}

	app1, _ := s.Read("app1")
	app2, _ := s.Read("app2")

	if len(app1) != 1 || app1[0].ID != "a1" {
		t.Errorf("app1: got %+v", app1)
	}
	if len(app2) != 1 || app2[0].ID != "b1" {
		t.Errorf("app2: got %+v", app2)
	}
}

func TestMerge_SurvivesLeftoverTmp(t *testing.T) {
	s, dir := tempStore(t)
	// Simulate a crash that left a partial .tmp behind.
	if err := os.WriteFile(filepath.Join(dir, "app1.json.tmp"), []byte("garbage"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := s.Merge("app1", []domain.Review{makeReview("r1", "2026-05-19T00:00:00Z")}); err != nil {
		t.Fatalf("Merge with leftover .tmp: %v", err)
	}

	reviews, _ := s.Read("app1")
	if len(reviews) != 1 || reviews[0].ID != "r1" {
		t.Errorf("unexpected reviews: %+v", reviews)
	}
}

func TestKnownIDs_Empty(t *testing.T) {
	s, _ := tempStore(t)
	ids, err := s.KnownIDs("app1")
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 0 {
		t.Errorf("expected empty set, got %d entries", len(ids))
	}
}

func TestKnownIDs_ReturnsAllStoredIDs(t *testing.T) {
	s, _ := tempStore(t)
	if err := s.Merge("app1", []domain.Review{
		makeReview("a", "2026-05-19T00:00:00Z"),
		makeReview("b", "2026-05-18T00:00:00Z"),
		makeReview("c", "2026-05-17T00:00:00Z"),
	}); err != nil {
		t.Fatal(err)
	}

	ids, err := s.KnownIDs("app1")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"a", "b", "c"} {
		if _, ok := ids[want]; !ok {
			t.Errorf("missing id %q from KnownIDs", want)
		}
	}
}

func TestRestartSurvival(t *testing.T) {
	dir := t.TempDir()

	first, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := first.Merge("app1", []domain.Review{
		makeReview("a", "2026-05-19T00:00:00Z"),
		makeReview("b", "2026-05-18T00:00:00Z"),
	}); err != nil {
		t.Fatal(err)
	}

	// Fresh Store on the same dir — simulates a process restart.
	second, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	reviews, err := second.Read("app1")
	if err != nil {
		t.Fatal(err)
	}
	if len(reviews) != 2 {
		t.Fatalf("expected 2 reviews after restart, got %d", len(reviews))
	}
}

func TestMerge_ProducesValidJSONOnDisk(t *testing.T) {
	s, dir := tempStore(t)
	if err := s.Merge("app1", []domain.Review{makeReview("r1", "2026-05-19T00:00:00Z")}); err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(filepath.Join(dir, "app1.json"))
	if err != nil {
		t.Fatal(err)
	}
	var parsed []domain.Review
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("on-disk file isn't valid JSON: %v", err)
	}
	if len(parsed) != 1 || parsed[0].ID != "r1" {
		t.Errorf("unexpected parsed contents: %+v", parsed)
	}
}
