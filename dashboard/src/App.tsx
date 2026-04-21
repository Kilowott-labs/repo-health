import { useEffect, useState } from 'react';
import { Layout } from './components/Layout';
import { Overview } from './routes/Overview';
import { Repo } from './routes/Repo';
import { Findings } from './routes/Findings';
import { Sla } from './routes/Sla';
import { Trends } from './routes/Trends';
import { loadDashboard } from './lib/data';
import type { DashboardData } from './lib/types';

export default function App() {
  const [hash, setHash] = useState(
    typeof window !== 'undefined' ? (window.location.hash || '#/') : '#/'
  );
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onHash = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    loadDashboard()
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) {
    return (
      <Layout data={null}>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="font-display italic text-3xl text-sev-critical mb-2">Failed to load</p>
          <p className="text-xs font-mono text-fg-tertiary">{error}</p>
        </div>
      </Layout>
    );
  }

  if (!data) {
    return (
      <Layout data={null}>
        <div className="flex items-center justify-center py-20">
          <span className="text-sm font-mono text-fg-tertiary animate-pulse">Loading dashboard…</span>
        </div>
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
            <p className="font-display italic text-3xl text-fg-primary mb-2">Repo not found.</p>
            <a href="#/" className="text-xs font-mono text-fg-tertiary hover:text-accent transition-colors">
              ← Back to overview
            </a>
          </div>
        </Layout>
      );
    }
    return (
      <Layout data={data}>
        <Repo repo={repo} />
      </Layout>
    );
  }

  switch (hash) {
    case '#/findings':
      return <Layout data={data}><Findings data={data} /></Layout>;
    case '#/sla':
      return <Layout data={data}><Sla data={data} /></Layout>;
    case '#/trends':
      return <Layout data={data}><Trends data={data} /></Layout>;
    case '#/':
    case '':
    default:
      return <Layout data={data}><Overview data={data} /></Layout>;
  }
}
