import type { CSSProperties } from 'react';

// Skeleton loaders — shimmer animation defined in index.css.
// Respects prefers-reduced-motion (animation falls back to static fill).

export function SkeletonBar({
  width = '100%',
  height = 12,
  className = '',
  style,
}: {
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={`skeleton inline-block ${className}`}
      style={{ width, height, ...style }}
      aria-hidden
    />
  );
}

export function SkeletonCircle({ size = 8 }: { size?: number }) {
  return (
    <span
      className="skeleton inline-block rounded-full"
      style={{ width: size, height: size }}
      aria-hidden
    />
  );
}

// Matches RepoCard silhouette so the layout doesn't shift on data load.
export function SkeletonRepoCard({ delayMs = 0 }: { delayMs?: number }) {
  return (
    <div
      className="flex flex-col gap-4 px-5 py-5 border border-border bg-bg-secondary rounded-sm fade-up"
      style={{ animationDelay: `${delayMs}ms` }}
      aria-hidden
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 space-y-2">
          <SkeletonBar width="60%" height={18} />
          <SkeletonBar width="85%" height={10} />
        </div>
        <SkeletonBar width={48} height={32} />
      </div>
      <div className="flex flex-wrap gap-3">
        <SkeletonBar width={60} height={10} />
        <SkeletonBar width={60} height={10} />
        <SkeletonBar width={60} height={10} />
      </div>
      <SkeletonBar width="100%" height={3} />
      <div className="flex items-center justify-between">
        <SkeletonBar width={120} height={10} />
        <SkeletonBar width={60} height={10} />
      </div>
    </div>
  );
}

export function SkeletonChart({ height = 120 }: { height?: number }) {
  return (
    <div
      className="border border-border bg-bg-secondary rounded-sm px-5 py-5 fade-up"
      aria-hidden
    >
      <SkeletonBar width="30%" height={18} className="mb-2" />
      <SkeletonBar width="50%" height={10} className="mb-4" />
      <SkeletonBar width="100%" height={height} style={{ borderRadius: 2 }} />
    </div>
  );
}

// Full Overview-shaped placeholder shown from mount until data arrives.
export function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-12" aria-busy>
      <section>
        <SkeletonBar width={180} height={10} className="mb-3" />
        <SkeletonBar width="70%" height={48} className="mb-4" />
        <SkeletonBar width="40%" height={12} />
      </section>
      <SkeletonChart />
      <section>
        <SkeletonBar width={180} height={26} className="mb-5" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonRepoCard key={i} delayMs={i * 12} />
          ))}
        </div>
      </section>
    </div>
  );
}
