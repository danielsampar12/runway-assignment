export type Review = {
  id: string;
  appId: string;
  author: string;
  score: number;
  title: string;
  content: string;
  submittedAt: string;
};
export type AppConfig = {
  id: string;
  name: string;
  country: string;
};

export type Config = {
  port: number;
  pollIntervalMs: number;
  dataDir: string;
  apps: AppConfig[];
};
