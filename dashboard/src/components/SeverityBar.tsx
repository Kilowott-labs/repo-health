import type { SeverityCounts } from '../lib/types';
import { SEVERITIES } from '../lib/types';
import { SEVERITY_COLORS, SEVERITY_LABELS } from '../lib/format';

interface Props {
  counts: SeverityCounts;
  height?: number;           // px — thin (4) for cards, tall (24) for detail pages
  showLabels?: boolean;      // floating severity labels under the bar
  className?: string;
}

// Horizontal stacked proportion bar. Shared between RepoCard (4px strip)
// and the Repo detail page (24px with labels).
export function SeverityBar({ counts, height = 4, showLabels = false, className = '' }: Props) {
  const total = SEVERITIES.reduce((s, k) => s + (counts[k] || 0), 0);
  const empty = total === 0;

  return (
    <div className={className}>
      <div
        className="w-full flex overflow-hidden rounded-sm"
        style={{ height: `${height}px`, background: 'var(--c-bg-tertiary)' }}
        role="img"
        aria-label={empty ? 'No findings' : 'Severity distribution'}
      >
        {empty ? (
          <span className="w-full h-full" style={{ background: 'var(--c-border)' }} />
        ) : (
          SEVERITIES.map(sev => {
            const c = counts[sev] || 0;
            if (c === 0) return null;
            const pct = (c / total) * 100;
            return (
              <span
                key={sev}
                style={{ width: `${pct}%`, background: SEVERITY_COLORS[sev] }}
                title={`${SEVERITY_LABELS[sev]}: ${c}`}
              />
            );
          })
        )}
      </div>
      {showLabels && !empty && (
        <div className="flex justify-between mt-2 text-[10px] font-mono uppercase tracking-wider text-fg-tertiary">
          {SEVERITIES.map(sev => {
            const c = counts[sev] || 0;
            if (c === 0) return null;
            return (
              <span key={sev} className="flex items-center gap-1">
                <span className="inline-block w-1 h-1 rounded-full" style={{ background: SEVERITY_COLORS[sev] }} />
                {SEVERITY_LABELS[sev]} {c}
              </span>
            );
          })}
        </div>
      )}
      {showLabels && empty && (
        <div className="mt-2 text-[10px] font-mono uppercase tracking-wider text-fg-tertiary">
          No findings
        </div>
      )}
    </div>
  );
}
