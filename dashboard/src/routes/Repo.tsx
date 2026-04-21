import { useMemo } from 'react';
import type { Repo as RepoType, Finding, Severity } from '../lib/types';
import { SEVERITIES, SEVERITY_ORDER } from '../lib/types';
import { SeverityBar } from '../components/SeverityBar';
import { FindingRow } from '../components/FindingRow';
import { NumberStyled } from '../components/NumberStyled';
import { RelativeTime } from '../components/RelativeTime';
import { SEVERITY_COLORS, SEVERITY_LABELS } from '../lib/format';
import { TableVirtuoso } from 'react-virtuoso';

interface Props {
  repo: RepoType;
}

export function Repo({ repo }: Props) {
  // Bucket by severity, keep natural order (critical → info).
  const bySev = useMemo(() => {
    const buckets: Record<Severity, Finding[]> = {
      critical: [], high: [], medium: [], low: [], info: [],
    };
    for (const f of repo.findings) buckets[f.severity]?.push(f);
    return buckets;
  }, [repo.findings]);

  const scannerEntries = Object.entries(repo.scanner_counts).sort(([, a], [, b]) => b - a);
  const scannerTotal = scannerEntries.reduce((s, [, c]) => s + c, 0);

  return (
    <div className="flex flex-col gap-10">
      {/* ─────── Breadcrumb + heading ─────── */}
      <header className="fade-up">
        <a
          href="#/"
          className="inline-flex items-center gap-1.5 text-xs font-mono text-fg-tertiary hover:text-fg-secondary transition-colors mb-5"
        >
          <span aria-hidden>←</span> Overview
        </a>
        <h1 className="font-display italic text-5xl md:text-6xl leading-[1.05] text-fg-primary">
          {repo.name}
        </h1>
        {repo.description && (
          <p className="mt-3 text-base text-fg-secondary max-w-3xl">{repo.description}</p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-mono text-fg-tertiary">
          {repo.language && (
            <span className="px-1.5 py-0.5 border border-border rounded-sm text-fg-secondary">
              {repo.language}
            </span>
          )}
          <a
            href={repo.url}
            target="_blank"
            rel="noreferrer"
            className="hover:text-accent transition-colors"
          >
            {repo.url.replace('https://', '')} ↗
          </a>
          <span>·</span>
          <span>
            Last scan <RelativeTime iso={repo.last_scanned_at} className="text-fg-secondary" />
          </span>
        </div>
      </header>

      {/* ─────── Metrics band ─────── */}
      <section className="fade-up grid grid-cols-1 lg:grid-cols-2 gap-6" style={{ animationDelay: '60ms' }}>
        {/* Severity distribution */}
        <div className="border border-border bg-bg-secondary rounded-sm px-5 py-5">
          <div className="flex items-end justify-between mb-4">
            <h2 className="font-display italic text-lg text-fg-primary">Severity</h2>
            <span className="text-3xl leading-none">
              <NumberStyled value={repo.findings.length} format={false} className="text-fg-primary" />
              <span className="ml-2 text-[11px] font-mono uppercase tracking-wider text-fg-tertiary not-italic align-middle">
                total
              </span>
            </span>
          </div>
          <SeverityBar counts={repo.severity_counts} height={24} showLabels />
        </div>

        {/* Scanner distribution */}
        <div className="border border-border bg-bg-secondary rounded-sm px-5 py-5">
          <div className="flex items-end justify-between mb-4">
            <h2 className="font-display italic text-lg text-fg-primary">Scanners</h2>
            <span className="text-[11px] font-mono uppercase tracking-wider text-fg-tertiary">
              {scannerEntries.length} active
            </span>
          </div>
          {scannerEntries.length === 0 ? (
            <p className="text-sm font-mono text-fg-tertiary">No findings from any scanner.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {scannerEntries.map(([name, count]) => {
                const pct = scannerTotal > 0 ? (count / scannerTotal) * 100 : 0;
                return (
                  <li key={name} className="flex items-center gap-3">
                    <span className="w-24 text-xs font-mono text-fg-secondary shrink-0 truncate">{name}</span>
                    <span className="flex-1 h-1.5 rounded-sm overflow-hidden" style={{ background: '#1F1F1F' }}>
                      <span
                        className="block h-full"
                        style={{ width: `${pct}%`, background: '#84CC16' }}
                      />
                    </span>
                    <span className="text-xs font-mono tabular-nums text-fg-primary w-12 text-right">
                      {count.toLocaleString()}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* ─────── Findings by severity ─────── */}
      <section className="flex flex-col gap-8">
        {SEVERITIES
          .slice()
          .sort((a, b) => SEVERITY_ORDER[a] - SEVERITY_ORDER[b])
          .map(sev => {
            const bucket = bySev[sev];
            if (!bucket || bucket.length === 0) return null;
            const expanded = sev === 'critical' || sev === 'high';
            return (
              <div key={sev}>
                <h2 className="flex items-baseline gap-3 font-display italic text-2xl text-fg-primary mb-4">
                  <span
                    className="inline-block w-2 h-2 rounded-full not-italic"
                    style={{ background: SEVERITY_COLORS[sev] }}
                    aria-hidden
                  />
                  {SEVERITY_LABELS[sev]}
                  <span className="font-sans not-italic text-sm text-fg-tertiary">
                    {bucket.length}
                  </span>
                </h2>
                {expanded ? (
                  <div className="flex flex-col gap-3">
                    {bucket.map(f => <FindingRow key={f.id} finding={f} />)}
                  </div>
                ) : (
                  <details className="group">
                    <summary className="cursor-pointer text-sm font-mono text-fg-secondary hover:text-fg-primary transition-colors select-none">
                      Show {bucket.length.toLocaleString()} {SEVERITY_LABELS[sev].toLowerCase()} findings
                    </summary>
                    <div className="mt-4">
                      <CompactTable findings={bucket} />
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        {repo.findings.length === 0 && (
          <div className="fade-up border border-border bg-bg-secondary rounded-sm px-6 py-10 text-center">
            <p className="font-display italic text-3xl text-fg-primary mb-2">Clean.</p>
            <p className="font-mono text-sm text-fg-tertiary">
              No active findings across any scanner.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

// --------------------------------------------------------------------------
// Compact virtualized table for medium/low/info sections — handles the
// thousands-of-findings case without tanking the main thread.
// --------------------------------------------------------------------------
function CompactTable({ findings }: { findings: Finding[] }) {
  return (
    <div
      className="border border-border rounded-sm overflow-hidden"
      style={{ height: Math.min(420, Math.max(200, findings.length * 36 + 40)) }}
    >
      <TableVirtuoso
        data={findings}
        components={{
          Table: (props) => (
            <table {...props} className="w-full border-collapse text-xs font-mono" />
          ),
          TableHead: (props) => (
            <thead {...props} className="bg-bg-tertiary" />
          ),
          TableRow: ({ item: _item, ...rest }) => (
            <tr {...rest} className="border-t border-border hover:bg-bg-secondary/40 transition-colors" />
          ),
        }}
        fixedHeaderContent={() => (
          <tr className="text-[10px] uppercase tracking-wider text-fg-tertiary">
            <th className="text-left px-3 py-2 font-normal w-14">Sev</th>
            <th className="text-left px-3 py-2 font-normal">File</th>
            <th className="text-left px-3 py-2 font-normal w-16 tabular-nums">Line</th>
            <th className="text-left px-3 py-2 font-normal w-32">Rule</th>
            <th className="text-left px-3 py-2 font-normal w-16">Age</th>
            <th className="text-left px-3 py-2 font-normal w-10">↗</th>
          </tr>
        )}
        itemContent={(_idx, f) => (
          <>
            <td className="px-3 py-2">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ background: SEVERITY_COLORS[f.severity] }}
                aria-label={SEVERITY_LABELS[f.severity]}
              />
            </td>
            <td className="px-3 py-2 text-fg-primary truncate max-w-[480px]" title={f.file}>
              {f.file || '—'}
            </td>
            <td className="px-3 py-2 text-fg-secondary tabular-nums">
              {f.line || '—'}
            </td>
            <td className="px-3 py-2 text-fg-tertiary truncate max-w-[320px]" title={f.rule}>
              {f.rule}
            </td>
            <td className="px-3 py-2 text-fg-tertiary tabular-nums">
              {f.age_days > 0 ? `${f.age_days}d` : '—'}
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
