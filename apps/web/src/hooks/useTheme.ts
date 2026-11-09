import { useCallback, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

const read = (): Theme => (document.documentElement.classList.contains('dark') ? 'dark' : 'light');

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(read);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem('as-theme', theme);
    } catch {
      /* private mode */
    }
  }, [theme]);
  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  return { theme, toggle };
}
