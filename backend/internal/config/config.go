package config

import (
	"encoding/json"
	"os"

	"runway/backend/internal/domain"
)

// Load reads config.json (path overridable via CONFIG_PATH env var).
func Load() (*domain.Config, error) {
	path := os.Getenv("CONFIG_PATH")
	if path == "" {
		path = "./config.json"
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var cfg domain.Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}
