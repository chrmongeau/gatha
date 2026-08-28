import { readText, writeText, type StorageLike } from './storage';

/**
 * Dark or light.
 *
 * Dark is the app's resting state and its default, because the Sitting screen
 * is looked at in a dim room and a bright screen there is actively wrong
 * (SPEC.md §9). Light exists because a passage read in daylight is not, and §9
 * allows the reading views to lift.
 *
 * `system` is offered so that `prefers-color-scheme` is genuinely respected
 * (SPEC.md §12) — but it is not the default, because the app's own resting
 * state is low-luminance whatever the phone is set to.
 */
export type ThemePreference = 'dark' | 'light' | 'system';
export type Theme = 'dark' | 'light';

const KEY = 'gatha.theme';

/** What the OS is set to; the app only asks when the preference is `system`. */
export function resolveTheme(preference: ThemePreference, prefersLight: boolean): Theme {
  if (preference === 'system') return prefersLight ? 'light' : 'dark';
  return preference;
}

export function loadPreference(storage: StorageLike | null): ThemePreference {
  const raw = readText(storage, KEY);
  return raw === 'light' || raw === 'system' || raw === 'dark' ? raw : 'dark';
}

export function savePreference(preference: ThemePreference, storage: StorageLike | null): void {
  writeText(storage, KEY, preference);
}

const LIGHT_QUERY = '(prefers-color-scheme: light)';

/** Ground colours, so the browser's own chrome matches the page. */
const THEME_COLOUR: Record<Theme, string> = { dark: '#121511', light: '#d8cfba' };

/**
 * Put the resolved theme on the root element, where the stylesheet reads it.
 *
 * `system` is resolved here rather than in CSS so the stylesheet needs no media
 * query and no duplicated block — one place decides, and the same decision is
 * made by the inline script in index.html before the first paint.
 */
export function applyTheme(preference: ThemePreference): Theme {
  const prefersLight = window.matchMedia(LIGHT_QUERY).matches;
  const theme = resolveTheme(preference, prefersLight);
  document.documentElement.dataset.theme = theme;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta !== null) meta.setAttribute('content', THEME_COLOUR[theme]);
  return theme;
}

/** Follow the OS while, and only while, the preference is to follow it. */
export function watchSystemTheme(current: () => ThemePreference): () => void {
  const query = window.matchMedia(LIGHT_QUERY);
  const onChange = (): void => {
    if (current() === 'system') applyTheme('system');
  };
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
  };
}
