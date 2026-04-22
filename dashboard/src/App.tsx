import { useEffect, useState, lazy, Suspense } from 'react';
import { Layout } from './components/Layout';
import { ErrorBoundary, FriendlyError } from './components/ErrorBoundary';
import { OverviewSkeleton, SkeletonChart } from './components/Skeleton';
import { Overview } from './routes/Overview';
import { Repo } from './routes/Repo';
import { Findings } from './routes/Findings';
import { Backlog } from './routes/Backlog';
import { loadDashboard } from './lib/data';
import type { DashboardData } from './lib/types';

// Trends pulls the largest chunk of Recharts surface area (stacked
// areas + small multiples) — code-split so the main bundle stays lean.
const Trends = lazy(() =>
  import('./routes/Trends').then(m => ({ default: m.Trends }))
);

export default function App() {
  const [hash, setHash] = useState(
    typeof window !== 'undefined' ? (window.location.hash || '#/') : '#/'
  );
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const onHash = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    loadDashboard()
      .then(setData)
      .catch((e: Error) => setError(e));
  }, []);

  if (error) {
    return (
      <Layout data={null}>
        <FriendlyError
          error={error}
          title="Couldn't load the dashboard."
          onRetry={() => window.location.reload()}
        />
      </Layout>
    );
  }

  if (!data) {
    return (
      <Layout data={null}>
        <OverviewSkeleton />
      </Layout>
    );
  }

  // Hash routing.
  const repoMatch = hash.match(/^#\/repo\/(.+)$/);
  if (repoMatch) {
    const repo = data.repos.find(r => r.name === decodeURIComponent(repoMatch[1]));
    if (!repo) {
      return (
        <Layout data={data}>
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="font-display italic text-4xl text-fg-primary mb-2">Repo not found.</p>
            <a href="#/" className="text-xs font-mono uppercase tracking-wider text-fg-tertiary hover:text-accent transition-colors mt-2">
              ← Back to overview
            </a>
          </div>
        </Layout>
      );
    }
    return (
      <Layout data={data}>
        <ErrorBoundary>
          <Repo repo={repo} />
        </ErrorBoundary>
      </Layout>
    );
  }

  // #/sla remains as an alias for #/backlog so old bookmarks don't 404.
  const route = (hash === '#/sla') ? '#/backlog' : hash;

  let page: React.ReactNode;
  switch (route) {
    case '#/findings':
      page = <Findings data={data} />;
      break;
    case '#/backlog':
      page = <Backlog data={data} />;
      break;
    case '#/trends':
      page = (
        <Suspense fallback={<SkeletonChart height={320} />}>
          <Trends data={data} />
        </Suspense>
      );
      break;
    case '#/':
    case '':
    default:
      page = <Overview data={data} />;
      break;
  }

  return (
    <Layout data={data}>
      <ErrorBoundary>{page}</ErrorBoundary>
    </Layout>
  );
}
