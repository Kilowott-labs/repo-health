// Shape mirrors dashboard.json emitted by scripts/aggregate.js.
// Keep in sync with that file's writer (single source of truth = aggregate.js).

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type FindingStatus = 'open' | 'dismissed' | 'acknowledged';

export interface Finding {
  id: string;
  severity: Severity;
  scanner: string;
  rule: string;
  file: string;
  line: number;
  title: string;
  first_seen: string;
  age_days: number;
  status: FindingStatus;
  labels: string[];
  gh_issue: string | null;
}

export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface ScannerCounts {
  [scanner: string]: number;
}

export interface Repo {
  name: string;
  description: string;
  language: string;
  url: string;
  last_scanned_at: string;
  severity_counts: SeverityCounts;
  scanner_counts: ScannerCounts;
  findings: Finding[];
}

export interface DashboardData {
  generated_at: string;
  next_scan_at: string;
  repos: Repo[];
  totals: {
    repos_monitored: number;
    repos_clean: number;
    findings_by_severity: SeverityCounts;
  };
}

export interface HistoryEntry {
  date: string;
  severity_counts: SeverityCounts;
  scanner_counts: ScannerCounts;
  total: number;
}

// Flat finding row — same shape as Finding plus the repo it came from.
// Used by the cross-repo Findings + SLA tables.
export interface FindingRow extends Finding {
  repo: string;
}

export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};
