// Mirrors the backend's Review/AppConfig shapes. Kept duplicated rather than
// extracted to a shared package: 2-package monorepo doesn't warrant the setup tax.

export interface AppInfo {
  id: string;
  name: string;
  country: string;
}

export interface Review {
  id: string;
  appId: string;
  author: string;
  score: number;
  title: string;
  content: string;
  submittedAt: string;
}
