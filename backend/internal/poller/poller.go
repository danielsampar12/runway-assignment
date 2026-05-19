package poller

import (
	"log"
	"time"

	"runway/backend/internal/domain"
	"runway/backend/internal/rss"
	"runway/backend/internal/store"
)

type Poller struct {
	apps     []domain.AppConfig
	store    *store.Store
	interval time.Duration
	done     chan struct{}
}

func New(apps []domain.AppConfig, st *store.Store, interval time.Duration) *Poller {
	return &Poller{
		apps:     apps,
		store:    st,
		interval: interval,
		done:     make(chan struct{}),
	}
}

// Start kicks off an immediate poll, then continues at intervalMs cadence.
// Stop() signals the loop to exit at the next iteration boundary.
func (p *Poller) Start() {
	go p.run()
}

func (p *Poller) Stop() {
	close(p.done)
}

func (p *Poller) run() {
	p.pollOnce()

	timer := time.NewTimer(p.interval)
	defer timer.Stop()

	for {
		select {
		case <-p.done:
			return
		case <-timer.C:
			p.pollOnce()
			timer.Reset(p.interval)
		}
	}
}

func (p *Poller) pollOnce() {
	for _, app := range p.apps {
		known, err := p.store.KnownIDs(app.ID)
		if err != nil {
			log.Printf("[%s] knownIds: %v", app.Name, err)
			continue
		}

		reviews, err := rss.FetchAllNewReviews(app, known, 10)
		if err != nil {
			log.Printf("[%s] fetch failed: %v", app.Name, err)
			continue
		}

		if len(reviews) == 0 {
			continue
		}

		if err := p.store.Merge(app.ID, reviews); err != nil {
			log.Printf("[%s] merge: %v", app.Name, err)
			continue
		}

		log.Printf("[%s] merged %d new reviews", app.Name, len(reviews))
	}
}
