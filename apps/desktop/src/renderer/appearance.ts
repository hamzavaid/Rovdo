/**
 * Persists Light/Dark/System preference through the preload API.
 * System mode follows OS changes; resolved theme tokens are applied on the document root.
 */
import { useEffect, useState } from 'react';
import type { Appearance } from '@rovdo/shared';
export function useAppearance() {
  const [appearance, setChoice] = useState<Appearance>('system');
  const [systemDark, setSystemDark] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void window.rovdo
      ?.intelligenceCommand({ op: 'view' })
      .then((r) => {
        if (active && r.ok) setChoice(r.view.appearance);
      })
      .catch(() => {
        if (active) setError('Appearance settings unavailable');
      });
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(media.matches);
    media.addEventListener('change', update);
    return () => {
      active = false;
      media.removeEventListener('change', update);
    };
  }, []);
  const resolved = appearance === 'system' ? (systemDark ? 'dark' : 'light') : appearance;
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.appearance = appearance;
  }, [appearance, resolved]);
  async function setAppearance(mode: Appearance) {
    try {
      const r = await window.rovdo!.intelligenceCommand({ op: 'appearance', mode });
      if (r.ok) {
        setChoice(r.view.appearance);
        setError('');
      } else setError('Appearance could not be saved');
    } catch {
      setError('Appearance settings unavailable');
    }
  }
  return { appearance, resolved, setAppearance, error };
}
