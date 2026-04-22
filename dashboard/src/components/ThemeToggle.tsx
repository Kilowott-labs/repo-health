import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { getCurrentTheme, toggleTheme, type Theme } from '../lib/theme';

// Icon-only toggle that sits in the header. State syncs with DOM
// after mount so hydration matches the pre-paint class set by
// index.html.
export function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>('dark');

  useEffect(() => {
    setThemeState(getCurrentTheme());
  }, []);

  const onClick = () => {
    setThemeState(toggleTheme());
  };

  const isDark = theme === 'dark';
  const Icon = isDark ? Sun : Moon;

  return (
    <button
      type="button"
      onClick={onClick}
      className="p-1.5 rounded-sm text-fg-tertiary hover:text-fg-primary hover:bg-bg-secondary transition-colors"
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
    >
      <Icon size={16} strokeWidth={1.5} />
    </button>
  );
}
