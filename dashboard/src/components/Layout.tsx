import type { ReactNode } from 'react';
import type { DashboardData } from '../lib/types';
import { RelativeTime } from './RelativeTime';
import { scanFreshness, untilNext } from '../lib/format';

interface Props {
  data: DashboardData | null;
  children: ReactNode;
}

const NAV = [
  { hash: '#/', label: 'Overview' },
  { hash: '#/findings', label: 'Findings' },
  { hash: '#/sla', label: 'SLA' },
  { hash: '#/trends', label: 'Trends' },
] as const;

export function Layout({ data, children }: Props) {
  const current = typeof window !== 'undefined' ? (window.location.hash || '#/') : '#/';
  const isCurrent = (h: string) =>
    h === '#/' ? (current === '#/' || current === '' || current.startsWith('#/repo/')) : current === h;

  const freshness = data ? scanFreshness(data.generated_at) : 'cold';
  const freshnessColor = freshness === 'fresh' ? '#65A30D' : freshness === 'stale' ? '#CA8A04' : '#C2410C';

  return (
    <div className="min-h-screen flex flex-col">
      {/* ─────────── Header ─────────── */}
      <header className="sticky top-0 z-20 bg-bg-primary/90 backdrop-blur-md border-b border-border">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between gap-6">
          {/* Wordmark */}
          <a href="#/" className="flex items-center gap-3 text-sm font-sans tracking-tight text-fg-primary">
            <span>Kilowott</span>
            <span className="text-fg-tertiary" aria-hidden>·</span>
            <span className="text-fg-secondary">Repo Health</span>
          </a>

          {/* Nav */}
          <nav className="hidden md:flex items-center gap-0.5 text-sm font-sans">
            {NAV.map(item => (
              <a
                key={item.hash}
                href={item.hash}
                className={`relative px-3 py-1.5 transition-colors duration-150 ${
                  isCurrent(item.hash) ? 'text-fg-primary' : 'text-fg-secondary hover:text-fg-primary'
                }`}
              >
                {item.label}
                {isCurrent(item.hash) && (
                  <span className="absolute left-3 right-3 -bottom-[17px] h-px bg-accent" aria-hidden />
                )}
              </a>
            ))}
          </nav>

          {/* Scan status */}
          {data ? (
            <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-fg-tertiary">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ background: freshnessColor, boxShadow: `0 0 0 3px ${freshnessColor}22` }}
                aria-label={`Scan ${freshness}`}
              />
              <span>
                Last scan <RelativeTime iso={data.generated_at} className="text-fg-secondary" />
                <span className="mx-1.5 text-fg-tertiary">·</span>
                next <span className="text-fg-secondary">{untilNext(data.next_scan_at)}</span>
              </span>
            </div>
          ) : (
            <span className="text-xs font-mono text-fg-tertiary">—</span>
          )}
        </div>
      </header>

      {/* ─────────── Main ─────────── */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-10">
        {children}
      </main>

      {/* ─────────── Footer ─────────── */}
      <footer className="border-t border-border mt-16">
        <div className="max-w-7xl mx-auto px-6 py-6 flex items-center justify-between text-[11px] font-mono text-fg-tertiary">
          <span>Kilowott · {new Date().getFullYear()}</span>
          <a
            href="https://github.com/Kilowott-labs/repo-health"
            target="_blank"
            rel="noreferrer"
            className="hover:text-fg-secondary transition-colors"
          >
            github.com/Kilowott-labs/repo-health ↗
          </a>
        </div>
      </footer>
    </div>
  );
}
