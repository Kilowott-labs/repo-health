import type { Severity } from './types';

export function relativeTime(iso: string): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (!then || isNaN(then)) return '—';
  const diffMs = Date.now() - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 14) return `${diffDay}d ago`;
  const diffWk = Math.floor(diffDay / 7);
  if (diffWk < 10) return `${diffWk}w ago`;
  const diffMo = Math.floor(diffDay / 30);
  if (diffMo < 12) return `${diffMo}mo ago`;
  return `${Math.floor(diffDay / 365)}y ago`;
}

// Freshness bucket for the header pulse dot.
export function scanFreshness(iso: string): 'fresh' | 'stale' | 'cold' {
  if (!iso) return 'cold';
  const ageHours = (Date.now() - new Date(iso).getTime()) / 3600000;
  if (ageHours <= 48) return 'fresh';
  if (ageHours <= 168) return 'stale'; // 7 days
  return 'cold';
}

export function untilNext(iso: string): string {
  if (!iso) return '';
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs <= 0) return 'due now';
  const diffDay = Math.floor(diffMs / 86400000);
  if (diffDay >= 1) return `in ${diffDay}d`;
  const diffHr = Math.floor(diffMs / 3600000);
  return `in ${diffHr}h`;
}

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
};

// CSS var refs so both dark + light themes swap correctly.
// Light mode values are defined in index.css under .theme-light.
export const SEVERITY_COLORS: Record<Severity, string> = {
  critical: 'var(--c-sev-critical)',
  high: 'var(--c-sev-high)',
  medium: 'var(--c-sev-medium)',
  low: 'var(--c-sev-low)',
  info: 'var(--c-sev-info)',
};

export const ACCENT_COLOR = 'var(--c-accent)';

export function formatNumber(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1000) return n.toLocaleString('en-US');
  return String(n);
}
