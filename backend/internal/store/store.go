package store

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"sync"

	"runway/backend/internal/domain"
)

// Store persists reviews per app to JSON files on disk. Atomic writes via
// the standard tmp + rename pattern guarantee the canonical file is never
// observed in a partially-written state.
type Store struct {
	dataDir string

	// Per-store mutex serializes Merge calls so two concurrent merges for the
	// same app can't lose data. Read/KnownIDs don't need the lock since the
	// atomic rename guarantees they observe either the old or the new file.
	mu sync.Mutex
}

func New(dataDir string) (*Store, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, err
	}
	return &Store{dataDir: dataDir}, nil
}

func (s *Store) filePath(appID string) string {
	return filepath.Join(s.dataDir, appID+".json")
}

// Read returns all reviews stored for the given app. Returns an empty slice
// (not an error) when no file exists yet.
func (s *Store) Read(appID string) ([]domain.Review, error) {
	data, err := os.ReadFile(s.filePath(appID))
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return []domain.Review{}, nil
		}
		return nil, err
	}

	var reviews []domain.Review
	if err := json.Unmarshal(data, &reviews); err != nil {
		return nil, err
	}
	return reviews, nil
}

// Merge upserts new reviews into the store, dedupes by ID, sorts newest-
// first, and atomically replaces the on-disk file.
func (s *Store) Merge(appID string, newReviews []domain.Review) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	existing, err := s.Read(appID)
	if err != nil {
		return err
	}

	byID := make(map[string]domain.Review, len(existing)+len(newReviews))
	for _, r := range existing {
		byID[r.ID] = r
	}
	for _, r := range newReviews {
		byID[r.ID] = r
	}

	merged := make([]domain.Review, 0, len(byID))
	for _, r := range byID {
		merged = append(merged, r)
	}
	sort.Slice(merged, func(i, j int) bool {
		// Newest first. Apple's ISO 8601 strings sort lexicographically.
		return merged[i].SubmittedAt > merged[j].SubmittedAt
	})

	data, err := json.MarshalIndent(merged, "", "  ")
	if err != nil {
		return err
	}

	target := s.filePath(appID)
	tmp := target + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, target)
}

// KnownIDs returns the set of review IDs stored for the given app.
func (s *Store) KnownIDs(appID string) (map[string]struct{}, error) {
	reviews, err := s.Read(appID)
	if err != nil {
		return nil, err
	}
	ids := make(map[string]struct{}, len(reviews))
	for _, r := range reviews {
		ids[r.ID] = struct{}{}
	}
	return ids, nil
}
