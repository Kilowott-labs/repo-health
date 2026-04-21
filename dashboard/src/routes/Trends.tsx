import { useEffect, useMemo, useState } from 'react';
import type { DashboardData, HistoryEntry, Severity } from '../lib/types';
import { SEVERITIES } from '../lib/types';
import { loadAllHistory } from '../lib/data';
import { SEVERITY_COLORS, SEVERITY_LABELS } from '../lib/format';
import {
  AreaChart, Area, LineChart, Line, ResponsiveContainer,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';

interface Props {
  data: DashboardData;
}

type WeeklyRow = { week: string } & Record<Severity, number>;

export function Trends({ data }: Props) {
  const [history, setHistory] = useState<Record<string, HistoryEntry[]> | null>(null);

  useEffect(() => {
    loadAllHistory().then(setHistory);
  }, []);

  const weeklyStacked = useMemo(
    () => history ? buildWeeklyStacked(history) : [],
    [history]
  );

  const perRepoSparklines = useMemo(() => {
    if (!history) return [];
    return data.repos
      .map(repo => {
        const entries = history[repo.name] || [];
        const series = entries.slice(-12).map(e => ({ date: e.date, total: e.total }));
        const delta = computeDelta(entries);
        return { name: repo.name, series, delta, total: entries[entries.length - 1]?.total ?? 0 };
      })
      .sort((a, b) => (b.series[b.series.length - 1]?.total ?? 0) - (a.series[a.series.length - 1]?.total ?? 0));
  }, [history, data.repos]);

  const hasTrendData = weeklyStacked.length >= 2;
  const historyDayCount = history
    ? Math.max(...Object.values(history).map(arr => arr.length), 0)
    : 0;

  return (
    <div className="flex flex-col gap-10">
      <header className="fade-up">
        <h1 className="font-display italic text-4xl md:text-5xl leading-[1.05] text-fg-primary mb-2">
          Trends
        </h1>
        <p className="text-sm font-mono text-fg-tertiary">
          Weekly findings aggregated by severity · last 12 weeks
        </p>
      </header>

      {!hasTrendData && (
        <section
          className="fade-up border border-border bg-bg-secondary rounded-sm px-8 py-16 text-center"
          style={{ animationDelay: '40ms' }}
        >
          <p className="font-display italic text-3xl text-fg-primary mb-3">Coming next Monday.</p>
          <p className="text-sm font-mono text-fg-tertiary max-w-xl mx-auto">
            Trend data accumulates weekly — {historyDayCount} scan{historyDayCount === 1 ? '' : 's'} on
            record so far. The first real chart appears once two scans land.
          </p>
        </section>
      )}

      {hasTrendData && (
        <>
          {/* ─────── Org-wide stacked area ─────── */}
          <section
            className="fade-up border border-border bg-bg-secondary rounded-sm px-5 py-5"
            style={{ animationDelay: '40ms' }}
          >
            <div className="mb-4">
              <h2 className="font-display italic text-xl text-fg-primary">Org-wide</h2>
              <p className="text-[11px] font-mono uppercase tracking-wider text-fg-tertiary mt-0.5">
                all repos · stacked by severity
              </p>
            </div>
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={weeklyStacked} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                  <CartesianGrid stroke="#1F1F1F" strokeDasharray="2 4" vertical={false} />
                  <XAxis
                    dataKey="week"
                    tick={{ fontSize: 10, fontFamily: 'Geist Mono, ui-monospace, monospace', fill: '#57534E' }}
                    axisLine={{ stroke: '#2A2A2A' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fontFamily: 'Geist Mono, ui-monospace, monospace', fill: '#57534E' }}
                    axisLine={{ stroke: '#2A2A2A' }}
                    tickLine={false}
                    width={40}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#141414',
                      border: '1px solid #2A2A2A',
                      borderRadius: 2,
                      fontSize: 12,
                      fontFamily: 'Geist Mono, ui-monospace, monospace',
                    }}
                    labelStyle={{ color: '#A8A29E' }}
                    itemStyle={{ color: '#F5F5F4' }}
                  />
                  {SEVERITIES.map(sev => (
                    <Area
                      key={sev}
                      type="monotone"
                      dataKey={sev}
                      stackId="1"
                      stroke={SEVERITY_COLORS[sev]}
                      fill={SEVERITY_COLORS[sev]}
                      fillOpacity={0.55}
                      isAnimationActive={false}
                      name={SEVERITY_LABELS[sev]}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* ─────── Per-repo small multiples ─────── */}
          <section
            className="fade-up"
            style={{ animationDelay: '80ms' }}
          >
            <h2 className="font-display italic text-2xl text-fg-primary mb-5">Per repo</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {perRepoSparklines.map(repo => (
                <div key={repo.name} className="border border-border bg-bg-secondary rounded-sm px-3 py-3">
                  <div className="flex items-baseline justify-between mb-2">
                    <a
                      href={`#/repo/${repo.name}`}
                      className="text-sm font-sans text-fg-primary truncate hover:text-accent transition-colors"
                    >
                      {repo.name}
                    </a>
                    {repo.delta !== null && (
                      <span
                        className={`text-[10px] font-mono tabular-nums shrink-0 ml-2 ${
                          repo.delta > 0 ? 'text-sev-high' : repo.delta < 0 ? 'text-sev-low' : 'text-fg-tertiary'
                        }`}
                      >
                        {repo.delta > 0 ? '↑' : repo.delta < 0 ? '↓' : '·'} {Math.abs(repo.delta)}
                      </span>
                    )}
                  </div>
                  <div className="h-[56px] -mx-1">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={repo.series} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                        <Line
                          type="monotone"
                          dataKey="total"
                          stroke="#84CC16"
                          strokeWidth={1.25}
                          dot={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="text-[10px] font-mono tabular-nums text-fg-tertiary mt-1">
                    now: {repo.total.toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Aggregate all repos' daily snapshots into ISO-week, stack by severity,
// return oldest → newest (cap 12 weeks).
// --------------------------------------------------------------------------
function buildWeeklyStacked(history: Record<string, HistoryEntry[]>): WeeklyRow[] {
  const byWeek = new Map<string, Record<Severity, number>>();
  const zero = (): Record<Severity, number> =>
    ({ critical: 0, high: 0, medium: 0, low: 0, info: 0 });

  for (const entries of Object.values(history)) {
    for (const e of entries) {
      const d = new Date(e.date);
      if (isNaN(d.getTime())) continue;
      const wk = isoWeekKey(d);
      if (!byWeek.has(wk)) byWeek.set(wk, zero());
      const bucket = byWeek.get(wk)!;
      for (const sev of SEVERITIES) {
        bucket[sev] += e.severity_counts[sev] || 0;
      }
    }
  }
  const sorted = Array.from(byWeek.entries()).sort(([a], [b]) => a.localeCompare(b));
  return sorted.slice(-12).map(([week, counts]) => ({ week, ...counts }));
}

function computeDelta(entries: HistoryEntry[]): number | null {
  if (entries.length < 2) return null;
  const current = entries[entries.length - 1]?.total ?? 0;
  // 4 weeks = ~28 days; take the entry nearest 4 weeks back.
  const target = entries.length >= 5 ? entries[entries.length - 5] : entries[0];
  return current - (target?.total ?? 0);
}

function isoWeekKey(d: Date): string {
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `W${String(weekNum).padStart(2, '0')}`;
}
