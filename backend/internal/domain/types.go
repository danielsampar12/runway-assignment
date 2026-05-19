package domain

type Review struct {
	ID          string `json:"id"`
	AppID       string `json:"appId"`
	Author      string `json:"author"`
	Score       int    `json:"score"`
	Title       string `json:"title"`
	Content     string `json:"content"`
	SubmittedAt string `json:"submittedAt"`
}

type AppConfig struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Country string `json:"country"`
}

type Config struct {
	Port           int         `json:"port"`
	PollIntervalMs int         `json:"pollIntervalMs"`
	DataDir        string      `json:"dataDir"`
	Apps           []AppConfig `json:"apps"`
}
