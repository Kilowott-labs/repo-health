import { useEffect, useState, type ReactNode } from 'react';
import { Menu, X } from 'lucide-react';
import type { DashboardData } from '../lib/types';
import { RelativeTime } from './RelativeTime';
import { ThemeToggle } from './ThemeToggle';
import { scanFreshness, untilNext } from '../lib/format';

interface Props {
  data: DashboardData | null;
  children: ReactNode;
}

const NAV = [
  { hash: '#/', label: 'Overview' },
  { hash: '#/findings', label: 'Findings' },
  { hash: '#/backlog', label: 'Backlog' },
  { hash: '#/trends', label: 'Trends' },
] as const;

export function Layout({ data, children }: Props) {
  const [current, setCurrent] = useState<string>(
    typeof window !== 'undefined' ? (window.location.hash || '#/') : '#/'
  );
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onHash = () => {
      setCurrent(window.location.hash || '#/');
      setMobileOpen(false);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const isCurrent = (h: string) =>
    h === '#/'
      ? (current === '#/' || current === '' || current.startsWith('#/repo/'))
      // #/sla is a legacy alias for #/backlog — highlight Backlog for either.
      : h === '#/backlog'
        ? (current === '#/backlog' || current === '#/sla')
        : current === h;

  const freshness = data ? scanFreshness(data.generated_at) : 'cold';
  const freshnessVar =
    freshness === 'fresh' ? 'var(--c-sev-low)'
    : freshness === 'stale' ? 'var(--c-sev-medium)'
    : 'var(--c-sev-critical)';

  return (
    <div className="min-h-screen flex flex-col">
      {/* ─────────── Header ─────────── */}
      <header className="sticky top-0 z-20 bg-bg-primary/90 backdrop-blur-md border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3 sm:gap-6">
          {/* Wordmark */}
          <a href="#/" className="flex items-center gap-2 sm:gap-3 text-sm font-sans tracking-tight text-fg-primary shrink-0">
            <span>Kilowott</span>
            <span className="text-fg-tertiary" aria-hidden>·</span>
            <span className="text-fg-secondary hidden sm:inline">Repo Health</span>
            <span className="text-fg-secondary sm:hidden">Health</span>
          </a>

          {/* Desktop nav */}
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

          {/* Right cluster */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {data ? (
              <div className="hidden lg:flex items-center gap-2 text-xs font-mono text-fg-tertiary">
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ background: freshnessVar, boxShadow: `0 0 0 3px color-mix(in srgb, ${freshnessVar} 20%, transparent)` }}
                  aria-label={`Scan ${freshness}`}
                />
                <span>
                  Last scan <RelativeTime iso={data.generated_at} className="text-fg-secondary" />
                  <span className="mx-1.5 text-fg-tertiary">·</span>
                  next <span className="text-fg-secondary">{untilNext(data.next_scan_at)}</span>
                </span>
              </div>
            ) : null}
            <ThemeToggle />
            {/* Mobile menu toggle */}
            <button
              type="button"
              className="md:hidden p-1.5 text-fg-secondary hover:text-fg-primary transition-colors"
              onClick={() => setMobileOpen(v => !v)}
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? <X size={18} strokeWidth={1.5} /> : <Menu size={18} strokeWidth={1.5} />}
            </button>
          </div>
        </div>

        {/* Mobile nav panel */}
        {mobileOpen && (
          <nav className="md:hidden border-t border-border bg-bg-primary">
            <div className="max-w-7xl mx-auto px-4 py-2 flex flex-col">
              {NAV.map(item => (
                <a
                  key={item.hash}
                  href={item.hash}
                  className={`px-3 py-3 text-sm font-sans border-b border-border last:border-0 ${
                    isCurrent(item.hash) ? 'text-fg-primary' : 'text-fg-secondary'
                  }`}
                >
                  {item.label}
                </a>
              ))}
              {data && (
                <div className="px-3 py-3 text-xs font-mono text-fg-tertiary border-t border-border mt-1">
                  Last scan <RelativeTime iso={data.generated_at} className="text-fg-secondary" />
                  <span className="mx-1.5">·</span>
                  next <span className="text-fg-secondary">{untilNext(data.next_scan_at)}</span>
                </div>
              )}
            </div>
          </nav>
        )}
      </header>

      {/* ─────────── Main ─────────── */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-10">
        {children}
      </main>

      {/* ─────────── Footer ─────────── */}
      <footer className="border-t border-border mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-[11px] font-mono text-fg-tertiary">
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
