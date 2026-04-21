import type { DashboardData, HistoryEntry } from './types';

// Vite injects BASE_URL = '/repo-health/' in production, '/' in dev.
const BASE = import.meta.env.BASE_URL;

async function fetchJson<T>(pathname: string): Promise<T> {
  const res = await fetch(`${BASE}${pathname}`);
  if (!res.ok) {
    throw new Error(`Failed to load ${pathname}: HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function loadDashboard(): Promise<DashboardData> {
  return fetchJson<DashboardData>('dashboard.json');
}

// Per-repo time-series. Returns [] if history not yet populated (< 2 scans).
export async function loadHistory(repoName: string): Promise<HistoryEntry[]> {
  try {
    return await fetchJson<HistoryEntry[]>(`history/${repoName}/combined.json`);
  } catch {
    return [];
  }
}

// Org-wide history index. Keyed by repo name; used by Overview sparkline
// + Trends route so the page fetches one file instead of 11.
export async function loadAllHistory(): Promise<Record<string, HistoryEntry[]>> {
  try {
    return await fetchJson<Record<string, HistoryEntry[]>>('history-combined.json');
  } catch {
    return {};
  }
}
