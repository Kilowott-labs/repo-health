import type { Severity } from '../lib/types';
import { SEVERITY_COLORS, SEVERITY_LABELS } from '../lib/format';

interface Props {
  severity: Severity;
  count?: number;
  variant?: 'full' | 'compact' | 'dot';
  className?: string;
}

// Three variants so the same primitive reads correctly in any context:
//   - full: dot + label + optional count  (Overview cards, detail pages)
//   - compact: colored count only         (table rows)
//   - dot: colored dot, tooltipped        (sparse legends)
export function SeverityBadge({ severity, count, variant = 'full', className = '' }: Props) {
  const color = SEVERITY_COLORS[severity];
  const label = SEVERITY_LABELS[severity];

  if (variant === 'dot') {
    return (
      <span
        className={`inline-block w-2 h-2 rounded-full ${className}`}
        style={{ background: color }}
        title={label}
        aria-label={label}
      />
    );
  }

  if (variant === 'compact') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 font-mono text-xs tabular-nums ${className}`}
        title={label}
      >
        <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
        {count ?? 0}
      </span>
    );
  }

  // full
  return (
    <span
      className={`inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider ${className}`}
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
      <span className="text-fg-secondary">{label}</span>
      {count !== undefined && (
        <span className="text-fg-primary tabular-nums">{count}</span>
      )}
    </span>
  );
}
