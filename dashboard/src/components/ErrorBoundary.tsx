import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  // Optional render-override for callers who want a custom fallback.
  fallback?: (err: Error, retry: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

// Class component because hooks can't catch render errors.
// Wraps every route so one broken page doesn't kill the shell.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface to console for dev debugging; in production this is the
    // only signal a user sees if they open DevTools after a crash.
    console.error('[ErrorBoundary]', error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }
      return <FriendlyError error={this.state.error} onRetry={() => window.location.reload()} />;
    }
    return this.props.children;
  }
}

export function FriendlyError({ error, onRetry, title }: { error: Error; onRetry: () => void; title?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <p className="font-display italic text-4xl text-fg-primary mb-3">
        {title || 'Something went wrong.'}
      </p>
      <p className="text-sm font-mono text-fg-secondary mb-6 max-w-md">
        The dashboard ran into an unexpected error. Refreshing usually fixes it.
        If it persists, the scan data file may be malformed.
      </p>
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={onRetry}
          className="px-4 py-2 text-xs font-mono uppercase tracking-wider border border-border rounded-sm text-fg-primary hover:bg-bg-secondary transition-colors"
        >
          Retry
        </button>
        <a
          href="#/"
          className="text-xs font-mono uppercase tracking-wider text-fg-tertiary hover:text-fg-secondary transition-colors"
        >
          Back to overview
        </a>
      </div>
      <details className="text-left max-w-lg">
        <summary className="cursor-pointer text-[11px] font-mono uppercase tracking-wider text-fg-tertiary hover:text-fg-secondary transition-colors">
          Technical details
        </summary>
        <pre className="mt-3 px-3 py-2 text-[11px] font-mono text-fg-tertiary border border-border bg-bg-secondary rounded-sm overflow-x-auto">
          {error.message}
        </pre>
      </details>
    </div>
  );
}
