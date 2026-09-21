export const FLOATING_LAUNCHER_THEMES = Object.freeze({
  MIDNIGHT_INDIGO: 'midnight-indigo',
  MIST_VIOLET: 'mist-violet',
  DEEP_TEAL: 'deep-teal',
});

export const DEFAULT_FLOATING_LAUNCHER_THEME = FLOATING_LAUNCHER_THEMES.MIDNIGHT_INDIGO;

const VALID_THEMES = new Set(Object.values(FLOATING_LAUNCHER_THEMES));

export function normalizeFloatingLauncherTheme(value) {
  return VALID_THEMES.has(value) ? value : DEFAULT_FLOATING_LAUNCHER_THEME;
}
