import type { Finding } from '../lib/types';
import { SEVERITY_COLORS, SEVERITY_LABELS } from '../lib/format';
import { RelativeTime } from './RelativeTime';

interface Props {
  finding: Finding;
  className?: string;
}

// Expanded finding card — used by Repo route's critical/high sections
// where we want every detail visible at first glance. Medium/low go
// into the virtualized compact table instead.
export function FindingRow({ finding, className = '' }: Props) {
  const color = SEVERITY_COLORS[finding.severity];

  return (
    <article
      className={`border border-border bg-bg-secondary rounded-sm px-5 py-4 hover:border-fg-tertiary transition-colors ${className}`}
      style={{ borderLeftWidth: '2px', borderLeftColor: color }}
    >
      <header className="flex items-start justify-between gap-4 mb-2">
        <h3 className="font-sans text-fg-primary leading-snug">
          {finding.title || finding.rule}
        </h3>
        <span
          className="shrink-0 text-[10px] font-mono uppercase tracking-widest"
          style={{ color }}
        >
          {SEVERITY_LABELS[finding.severity]}
        </span>
      </header>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs font-mono text-fg-tertiary">
        <span className="text-fg-secondary">
          {finding.file}
          {finding.line ? `:${finding.line}` : ''}
        </span>
        <span className="text-fg-tertiary">·</span>
        <span>{finding.scanner}</span>
        <span className="text-fg-tertiary">·</span>
        <span>{finding.rule}</span>
        {finding.first_seen && (
          <>
            <span className="text-fg-tertiary">·</span>
            <span>
              first seen <RelativeTime iso={finding.first_seen} />
              {finding.age_days > 30 && (
                <span className="ml-2 text-sev-high">SLA +{finding.age_days}d</span>
              )}
            </span>
          </>
        )}
      </div>
      <footer className="flex items-center gap-3 mt-3">
        {finding.gh_issue && (
          <a
            href={finding.gh_issue}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-mono text-fg-secondary hover:text-accent transition-colors"
          >
            Open in GitHub ↗
          </a>
        )}
        <button
          type="button"
          className="text-xs font-mono text-fg-tertiary hover:text-fg-secondary transition-colors"
          title="Not wired yet — ships in 5b"
          disabled
        >
          Mark false positive
        </button>
        <span className="ml-auto text-[10px] font-mono text-fg-tertiary tabular-nums">
          {finding.id}
        </span>
      </footer>
    </article>
  );
}
