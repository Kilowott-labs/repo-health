import { useMemo } from 'react';
import type { DashboardData, FindingRow } from '../lib/types';
import { SEVERITY_ORDER } from '../lib/types';
import { FindingsTable } from './Findings';
import { NumberStyled } from '../components/NumberStyled';

interface Props {
  data: DashboardData;
}

const SLA_DAYS = 30;

export function Sla({ data }: Props) {
  const overdue: FindingRow[] = useMemo(() => {
    const out: FindingRow[] = [];
    for (const r of data.repos) {
      for (const f of r.findings) {
        if (f.status === 'open' && f.age_days > SLA_DAYS) {
          out.push({ ...f, repo: r.name });
        }
      }
    }
    // Oldest first.
    return out.sort((a, b) => {
      const ageCmp = b.age_days - a.age_days;
      if (ageCmp !== 0) return ageCmp;
      return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    });
  }, [data.repos]);

  const reposAffected = useMemo(
    () => new Set(overdue.map(f => f.repo)).size,
    [overdue]
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="fade-up">
        <h1 className="font-display italic text-4xl md:text-5xl leading-[1.05] text-fg-primary mb-2">
          SLA breaches
        </h1>
        <p className="text-sm font-mono text-fg-tertiary">
          Findings open &gt;{SLA_DAYS} days · action required
        </p>
      </header>

      {overdue.length === 0 ? (
        <section
          className="fade-up border border-border bg-bg-secondary rounded-sm px-8 py-20 text-center"
          style={{ animationDelay: '40ms' }}
        >
          <p className="font-display italic text-5xl text-fg-primary mb-4">All clear.</p>
          <p className="text-sm font-mono text-fg-tertiary">
            No SLA breaches — every open finding is under {SLA_DAYS} days old.
          </p>
        </section>
      ) : (
        <>
          <section
            className="fade-up flex items-baseline gap-6 border border-border bg-bg-secondary rounded-sm px-5 py-4"
            style={{ animationDelay: '40ms' }}
          >
            <span className="text-3xl">
              <NumberStyled value={overdue.length} format={false} className="text-sev-high" />
              <span className="ml-2 text-[11px] font-mono uppercase tracking-wider text-fg-tertiary not-italic align-middle">
                overdue findings
              </span>
            </span>
            <span className="text-fg-tertiary">·</span>
            <span className="text-3xl">
              <NumberStyled value={reposAffected} format={false} className="text-fg-primary" />
              <span className="ml-2 text-[11px] font-mono uppercase tracking-wider text-fg-tertiary not-italic align-middle">
                {reposAffected === 1 ? 'repo affected' : 'repos affected'}
              </span>
            </span>
          </section>
          <FindingsTable rows={overdue} />
        </>
      )}
    </div>
  );
}
