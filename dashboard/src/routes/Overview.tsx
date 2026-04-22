import { useEffect, useState } from 'react';
import type { DashboardData, HistoryEntry } from '../lib/types';
import { loadAllHistory } from '../lib/data';
import { NumberStyled } from '../components/NumberStyled';
import { RepoCard } from '../components/RepoCard';
import { RelativeTime } from '../components/RelativeTime';
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts';

interface Props {
  data: DashboardData;
}

type WeeklyPoint = { week: string; total: number };

export function Overview({ data }: Props) {
  const [history, setHistory] = useState<Record<string, HistoryEntry[]> | null>(null);

  useEffect(() => {
    loadAllHistory().then(setHistory);
  }, []);

  const flagged = data.repos
    .filter(r => r.findings.length > 0)
    .sort((a, b) => {
      const cmp = b.severity_counts.critical - a.severity_counts.critical;
      if (cmp !== 0) return cmp;
      const hcmp = b.severity_counts.high - a.severity_counts.high;
      if (hcmp !== 0) return hcmp;
      return a.name.localeCompare(b.name);
    });
  const clean = data.repos
    .filter(r => r.findings.length === 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  const weekly = history ? buildWeeklyTrend(history) : [];
  const historyDayCount = history
    ? Math.max(...Object.values(history).map(arr => arr.length), 0)
    : 0;
  const hasTrendData = weekly.length >= 2;

  // Nothing to show yet — fresh deploy before the first scan.
  if (data.totals.repos_monitored === 0) {
    return (
      <div className="fade-up flex flex-col items-center justify-center py-24 text-center">
        <p className="font-display italic text-5xl text-fg-primary mb-4">
          No scans yet.
        </p>
        <p className="text-sm font-mono text-fg-tertiary max-w-md">
          The first Monday cron will populate this view. Trigger
          it manually from Actions → Weekly repo health scan if
          you can't wait.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-12">
      {/* ─────── Hero band ─────── */}
      <section className="fade-up">
        <p className="text-xs font-mono uppercase tracking-[0.2em] text-fg-tertiary mb-3">
          Dashboard · {data.generated_at.slice(0, 10)}
        </p>
        <h1 className="font-sans text-4xl md:text-5xl leading-[1.05] tracking-tight text-fg-primary max-w-4xl">
          <NumberStyled value={data.totals.repos_monitored} format={false} />
          <span className="text-fg-secondary"> repos monitored </span>
          <span className="text-fg-tertiary">·</span>{' '}
          <NumberStyled value={flagged.length} format={false} />
          <span className="text-fg-secondary"> with findings </span>
          <span className="text-fg-tertiary">·</span>{' '}
          <NumberStyled value={data.totals.repos_clean} format={false} />
          <span className="text-fg-secondary"> clean</span>
        </h1>
        <div className="mt-4 flex items-center gap-4 text-xs font-mono text-fg-tertiary">
          <span>
            Generated <RelativeTime iso={data.generated_at} className="text-fg-secondary" />
          </span>
          <span>·</span>
          <span>
            <NumberStyled
              value={Object.values(data.totals.findings_by_severity).reduce((s, n) => s + n, 0)}
              className="text-fg-secondary"
            />
            <span className="ml-1">findings total across scanners</span>
          </span>
        </div>
      </section>

      {/* ─────── Sparkline strip ─────── */}
      <section
        className="fade-up border border-border bg-bg-secondary rounded-sm px-6 py-5"
        style={{ animationDelay: '60ms' }}
      >
        <div className="flex items-end justify-between mb-3">
          <div>
            <h2 className="font-display italic text-xl text-fg-primary">Org trend</h2>
            <p className="text-[11px] font-mono uppercase tracking-wider text-fg-tertiary mt-0.5">
              total findings · last 12 weeks
            </p>
          </div>
          {hasTrendData ? (
            <span className="text-xs font-mono text-fg-tertiary">
              {weekly[0].total.toLocaleString()} → {weekly[weekly.length - 1].total.toLocaleString()}
            </span>
          ) : null}
        </div>
        {hasTrendData ? (
          <div className="h-[120px] -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={weekly} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                <defs>
                  <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--c-accent)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="var(--c-accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Tooltip
                  contentStyle={{
                    background: 'var(--c-bg-secondary)',
                    border: '1px solid var(--c-border)',
                    borderRadius: 2,
                    fontSize: 12,
                    fontFamily: 'Geist Mono, ui-monospace, monospace',
                  }}
                  labelStyle={{ color: 'var(--c-fg-secondary)' }}
                  itemStyle={{ color: 'var(--c-fg-primary)' }}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke="var(--c-accent)"
                  strokeWidth={1.5}
                  fill="url(#spark-fill)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm font-mono text-fg-tertiary py-6">
            Trend data accumulates weekly — only {historyDayCount} scan
            {historyDayCount === 1 ? '' : 's'} on record. Check back next Monday.
          </p>
        )}
      </section>

      {/* ─────── Active findings (flagged repos) ─────── */}
      {flagged.length > 0 && (
        <section>
          <h2 className="font-display italic text-2xl text-fg-primary mb-5">
            Active findings
            <span className="font-sans not-italic text-sm text-fg-tertiary ml-3 align-middle">
              {flagged.length}
            </span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {flagged.map((repo, i) => (
              <RepoCard key={repo.name} repo={repo} delayMs={80 + i * 12} />
            ))}
          </div>
        </section>
      )}

      {/* ─────── Clean repos ─────── */}
      {clean.length > 0 && (
        <section>
          <h2 className="font-display italic text-2xl text-fg-primary mb-5">
            Clean
            <span className="font-sans not-italic text-sm text-fg-tertiary ml-3 align-middle">
              {clean.length}
            </span>
          </h2>
          <ul className="divide-y divide-border border-t border-b border-border">
            {clean.map(repo => (
              <li key={repo.name}>
                <a
                  href={`#/repo/${repo.name}`}
                  className="flex items-center justify-between gap-4 px-1 py-3 transition-colors hover:bg-bg-secondary/40 group"
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-sev-clean shrink-0" aria-hidden />
                    <span className="font-sans text-fg-primary truncate">{repo.name}</span>
                    {repo.description && (
                      <span className="hidden md:inline text-xs text-fg-tertiary truncate">
                        {repo.description}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-4 text-[11px] font-mono text-fg-tertiary shrink-0">
                    {repo.language && (
                      <span className="hidden sm:inline px-1.5 py-0.5 border border-border rounded-sm">
                        {repo.language}
                      </span>
                    )}
                    <RelativeTime iso={repo.last_scanned_at} />
                    <span className="text-fg-tertiary group-hover:text-accent transition-colors" aria-hidden>→</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Bucket all repos' daily snapshots into ISO-week totals (sum of `total`
// across repos per week). Returns oldest → newest, max 12 weeks.
// --------------------------------------------------------------------------
function buildWeeklyTrend(history: Record<string, HistoryEntry[]>): WeeklyPoint[] {
  const byWeek = new Map<string, number>();
  for (const entries of Object.values(history)) {
    for (const e of entries) {
      const d = new Date(e.date);
      if (isNaN(d.getTime())) continue;
      const wk = isoWeekKey(d);
      byWeek.set(wk, (byWeek.get(wk) || 0) + (e.total || 0));
    }
  }
  const sorted = Array.from(byWeek.entries()).sort(([a], [b]) => a.localeCompare(b));
  return sorted.slice(-12).map(([week, total]) => ({ week, total }));
}

function isoWeekKey(d: Date): string {
  // YYYY-Www (ISO week)
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}
