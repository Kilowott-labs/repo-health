import { useMemo, useState } from 'react';
import type { DashboardData, FindingRow, Severity, FindingStatus } from '../lib/types';
import { SEVERITIES, SEVERITY_ORDER } from '../lib/types';
import { SEVERITY_COLORS, SEVERITY_LABELS } from '../lib/format';
import { TableVirtuoso } from 'react-virtuoso';
import { Popover } from '../components/Popover';

interface Props {
  data: DashboardData;
}

export function Findings({ data }: Props) {
  // Flatten all findings with repo stitched in.
  const allRows: FindingRow[] = useMemo(() => {
    const out: FindingRow[] = [];
    for (const r of data.repos) {
      for (const f of r.findings) out.push({ ...f, repo: r.name });
    }
    return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  }, [data.repos]);

  const scannersAvailable = useMemo(
    () => Array.from(new Set(allRows.map(f => f.scanner))).sort(),
    [allRows]
  );
  const reposAvailable = useMemo(
    () => data.repos.map(r => r.name).sort(),
    [data.repos]
  );

  // Filters — default: status='open', all severities, all scanners, all repos
  const [query, setQuery] = useState('');
  const [sevFilter, setSevFilter] = useState<Set<Severity>>(new Set(SEVERITIES));
  const [scannerFilter, setScannerFilter] = useState<Set<string>>(() => new Set());
  const [repoFilter, setRepoFilter] = useState<Set<string>>(() => new Set());
  const [statusFilter, setStatusFilter] = useState<Set<FindingStatus>>(() => new Set(['open']));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allRows.filter(f => {
      if (!sevFilter.has(f.severity)) return false;
      if (scannerFilter.size > 0 && !scannerFilter.has(f.scanner)) return false;
      if (repoFilter.size > 0 && !repoFilter.has(f.repo)) return false;
      if (!statusFilter.has(f.status)) return false;
      if (q) {
        const hay = `${f.title} ${f.rule} ${f.file}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allRows, query, sevFilter, scannerFilter, repoFilter, statusFilter]);

  const clearFilters = () => {
    setQuery('');
    setSevFilter(new Set(SEVERITIES));
    setScannerFilter(new Set());
    setRepoFilter(new Set());
    setStatusFilter(new Set(['open']));
  };

  const toggleSet = <T,>(s: Set<T>, v: T, setter: (n: Set<T>) => void) => {
    const n = new Set(s);
    n.has(v) ? n.delete(v) : n.add(v);
    setter(n);
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="fade-up">
        <h1 className="font-display italic text-4xl md:text-5xl leading-[1.05] text-fg-primary mb-2">
          Findings
        </h1>
        <p className="text-sm font-mono text-fg-tertiary">
          {filtered.length.toLocaleString()}
          <span className="mx-2">of</span>
          {allRows.length.toLocaleString()}
          <span className="ml-1">findings</span>
        </p>
      </header>

      {/* Filter bar */}
      <section
        className="fade-up flex flex-col gap-3 border border-border bg-bg-secondary rounded-sm px-4 py-3"
        style={{ animationDelay: '40ms' }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search title / rule / file…"
            className="flex-1 min-w-[220px] px-3 py-1.5 bg-bg-primary border border-border rounded-sm text-sm font-mono text-fg-primary placeholder-fg-tertiary focus:outline-none focus:border-fg-tertiary"
          />
          <MultiDropdown
            label="Scanner"
            options={scannersAvailable}
            selected={scannerFilter}
            onToggle={v => toggleSet(scannerFilter, v, setScannerFilter)}
          />
          <MultiDropdown
            label="Repo"
            options={reposAvailable}
            selected={repoFilter}
            onToggle={v => toggleSet(repoFilter, v, setRepoFilter)}
          />
          <MultiDropdown
            label="Status"
            options={['open', 'dismissed', 'acknowledged']}
            selected={statusFilter}
            onToggle={v => toggleSet(statusFilter, v as FindingStatus, setStatusFilter)}
          />
          <button
            type="button"
            onClick={clearFilters}
            className="px-3 py-1.5 text-xs font-mono text-fg-tertiary hover:text-fg-secondary transition-colors"
          >
            Clear
          </button>
        </div>

        {/* Severity chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          {SEVERITIES.map(sev => {
            const on = sevFilter.has(sev);
            return (
              <button
                key={sev}
                type="button"
                onClick={() => toggleSet(sevFilter, sev, setSevFilter)}
                className={`px-2.5 py-1 border rounded-sm text-[11px] font-mono uppercase tracking-wider transition-colors flex items-center gap-1.5 ${
                  on
                    ? 'border-fg-tertiary text-fg-primary bg-bg-tertiary'
                    : 'border-border text-fg-tertiary hover:text-fg-secondary'
                }`}
                aria-pressed={on}
              >
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ background: SEVERITY_COLORS[sev], opacity: on ? 1 : 0.3 }}
                />
                {SEVERITY_LABELS[sev]}
              </button>
            );
          })}
        </div>
      </section>

      {/* Virtualized table */}
      <FindingsTable rows={filtered} />
    </div>
  );
}

// --------------------------------------------------------------------------
// Multi-select dropdown — portal-rendered so it escapes parent clipping
// and z-index stacks. See components/Popover.tsx.
// --------------------------------------------------------------------------
function MultiDropdown<T extends string>({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: T[];
  selected: Set<T>;
  onToggle: (v: T) => void;
}) {
  return (
    <Popover
      align="left"
      trigger={({ toggle, open }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="px-3 py-1.5 text-xs font-mono text-fg-secondary hover:text-fg-primary border border-border rounded-sm bg-bg-primary transition-colors select-none"
        >
          {label}
          {selected.size > 0 && <span className="ml-1.5 text-accent">· {selected.size}</span>}
          <span className="ml-1.5 text-fg-tertiary" aria-hidden>{open ? '▴' : '▾'}</span>
        </button>
      )}
    >
      {options.map(opt => {
        const on = selected.has(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-mono text-left hover:bg-bg-tertiary transition-colors"
          >
            <span
              className={`inline-block w-3 h-3 border rounded-sm ${on ? 'bg-accent border-accent' : 'border-fg-tertiary'}`}
              aria-hidden
            />
            <span className={on ? 'text-fg-primary' : 'text-fg-secondary'}>{opt}</span>
          </button>
        );
      })}
    </Popover>
  );
}

// --------------------------------------------------------------------------
// The virtualized table itself — handles 14k rows without breaking a sweat.
// --------------------------------------------------------------------------
export function FindingsTable({ rows }: { rows: FindingRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="border border-border bg-bg-secondary rounded-sm px-6 py-16 text-center">
        <p className="font-display italic text-2xl text-fg-primary mb-2">No matching findings.</p>
        <p className="font-mono text-xs text-fg-tertiary">Try clearing filters.</p>
      </div>
    );
  }

  return (
    <div
      className="border border-border rounded-sm overflow-hidden"
      style={{ height: 'calc(100vh - 320px)', minHeight: 420 }}
    >
      <TableVirtuoso
        data={rows}
        components={{
          Table: (props) => (
            <table {...props} className="w-full border-collapse text-xs font-mono" />
          ),
          TableHead: (props) => (
            <thead {...props} className="bg-bg-tertiary" />
          ),
          TableRow: ({ item: _item, ...rest }) => (
            <tr {...rest} className="border-t border-border hover:bg-bg-secondary/60 transition-colors" />
          ),
        }}
        fixedHeaderContent={() => (
          <tr className="text-[10px] uppercase tracking-wider text-fg-tertiary">
            <th className="text-left px-3 py-2.5 font-normal w-14">Sev</th>
            <th className="text-left px-3 py-2.5 font-normal w-44">Repo</th>
            <th className="text-left px-3 py-2.5 font-normal">File</th>
            <th className="text-left px-3 py-2.5 font-normal w-16 tabular-nums">Line</th>
            <th className="text-left px-3 py-2.5 font-normal w-28">Scanner</th>
            <th className="text-left px-3 py-2.5 font-normal w-48">Rule</th>
            <th className="text-left px-3 py-2.5 font-normal w-16">Age</th>
            <th className="text-left px-3 py-2.5 font-normal w-20">Status</th>
            <th className="text-left px-3 py-2.5 font-normal w-10">↗</th>
          </tr>
        )}
        itemContent={(_idx, f) => (
          <>
            <td className="px-3 py-2" title={SEVERITY_LABELS[f.severity]}>
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ background: SEVERITY_COLORS[f.severity] }}
              />
            </td>
            <td className="px-3 py-2 text-fg-primary truncate" title={f.repo}>
              <a href={`#/repo/${f.repo}`} className="hover:text-accent transition-colors">
                {f.repo}
              </a>
            </td>
            <td className="px-3 py-2 text-fg-secondary truncate max-w-[360px]" title={f.file}>
              {f.file || '—'}
            </td>
            <td className="px-3 py-2 text-fg-tertiary tabular-nums">
              {f.line || '—'}
            </td>
            <td className="px-3 py-2 text-fg-tertiary truncate">
              {f.scanner}
            </td>
            <td className="px-3 py-2 text-fg-tertiary truncate" title={f.rule}>
              {f.rule}
            </td>
            <td className={`px-3 py-2 tabular-nums ${f.age_days > 30 ? 'text-sev-high' : 'text-fg-tertiary'}`}>
              {f.age_days > 0 ? `${f.age_days}d` : '—'}
            </td>
            <td className="px-3 py-2 text-fg-tertiary">
              {f.status}
            </td>
            <td className="px-3 py-2">
              {f.gh_issue ? (
                <a
                  href={f.gh_issue}
                  target="_blank"
                  rel="noreferrer"
                  className="text-fg-tertiary hover:text-accent transition-colors"
                  title="Open in GitHub"
                >
                  ↗
                </a>
              ) : null}
            </td>
          </>
        )}
      />
    </div>
  );
}
