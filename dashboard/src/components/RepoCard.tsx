import type { Repo } from '../lib/types';
import { SEVERITIES } from '../lib/types';
import { SEVERITY_COLORS, SEVERITY_LABELS } from '../lib/format';
import { SeverityBar } from './SeverityBar';
import { RelativeTime } from './RelativeTime';
import { NumberStyled } from './NumberStyled';

interface Props {
  repo: Repo;
  delayMs?: number;
}

export function RepoCard({ repo, delayMs = 0 }: Props) {
  const total = SEVERITIES.reduce((s, k) => s + repo.severity_counts[k], 0);
  const topScanners = Object.entries(repo.scanner_counts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3);

  return (
    <a
      href={`#/repo/${repo.name}`}
      className="group relative flex flex-col gap-4 px-5 py-5 border border-border bg-bg-secondary rounded-sm transition-[border-color,transform] duration-150 ease-out hover:border-fg-tertiary fade-up"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      {/* Header — name + total */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-sans text-lg text-fg-primary tracking-tight truncate">
            {repo.name}
          </h3>
          {repo.description && (
            <p className="mt-1 text-xs text-fg-tertiary leading-snug line-clamp-2">
              {repo.description}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-3xl leading-none">
            <NumberStyled value={total} format={false} className="text-fg-primary" />
          </div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-fg-tertiary mt-1">
            findings
          </div>
        </div>
      </div>

      {/* Severity pill stack */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {SEVERITIES.map(sev => {
          const count = repo.severity_counts[sev];
          if (count === 0) return null;
          return (
            <span key={sev} className="flex items-center gap-1.5 text-xs font-mono tabular-nums">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ background: SEVERITY_COLORS[sev] }}
              />
              <span className="text-fg-secondary">{SEVERITY_LABELS[sev]}</span>
              <span className="text-fg-primary">{count}</span>
            </span>
          );
        })}
      </div>

      {/* Severity proportion bar */}
      <SeverityBar counts={repo.severity_counts} height={3} />

      {/* Footer metadata */}
      <div className="flex items-center justify-between text-[11px] font-mono text-fg-tertiary">
        <span className="flex items-center gap-2">
          {repo.language && (
            <span className="px-1.5 py-0.5 border border-border rounded-sm text-fg-secondary">
              {repo.language}
            </span>
          )}
          <span>
            {topScanners.map(([name, c]) => `${name}:${c}`).join(' · ')}
          </span>
        </span>
        <span>
          <RelativeTime iso={repo.last_scanned_at} />
        </span>
      </div>
    </a>
  );
}
