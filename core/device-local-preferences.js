import {resolveDeviceLocalStorage} from './device-local-preference.js';

export const THEME_PREFERENCE_KEY = 'bioweave_ui_theme';
export const FLOATING_LAUNCHER_POSITION_KEY = 'bioweave-floating-launcher-position';

function warn(code) {
  console.warn(`[BioWeave] ${code}`);
}

function readValue(storageRef, key, failureCode) {
  if (typeof storageRef?.getItem !== 'function') {
    warn(failureCode);
    return null;
  }
  try {
    return storageRef.getItem(key);
  } catch {
    warn(failureCode);
    return null;
  }
}

function writeValue(storageRef, key, value, failureCode) {
  if (typeof storageRef?.setItem !== 'function') {
    warn(failureCode);
    return false;
  }
  try {
    storageRef.setItem(key, value);
    return true;
  } catch {
    warn(failureCode);
    return false;
  }
}

function normalizeLauncherPosition(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const x = Number(raw.x ?? raw.left);
  const y = Number(raw.y ?? raw.top);
  return Number.isFinite(x) && Number.isFinite(y) ? {x, y} : null;
}

export function createDeviceLocalPreferences({documentRef, windowRef, storageRef} = {}) {
  const resolvedStorage = resolveDeviceLocalStorage({documentRef, windowRef, storageRef});

  return {
    readTheme() {
      return readValue(resolvedStorage, THEME_PREFERENCE_KEY, 'THEME_STORAGE_READ_FAILED');
    },

    writeTheme(value) {
      if (!writeValue(resolvedStorage, THEME_PREFERENCE_KEY, value, 'THEME_STORAGE_WRITE_FAILED')) return;
      const readback = readValue(resolvedStorage, THEME_PREFERENCE_KEY, 'THEME_STORAGE_VERIFY_FAILED');
      if (readback !== value) warn('THEME_STORAGE_VERIFY_FAILED');
    },

    readLauncherPosition() {
      const raw = readValue(resolvedStorage, FLOATING_LAUNCHER_POSITION_KEY, 'FLOATING_LAUNCHER_POSITION_READ_FAILED');
      if (raw === null || raw === undefined) return null;
      try {
        return normalizeLauncherPosition(JSON.parse(raw));
      } catch {
        warn('FLOATING_LAUNCHER_POSITION_READ_FAILED');
        return null;
      }
    },

    writeLauncherPosition(position) {
      let serialized;
      try {
        serialized = JSON.stringify(position);
      } catch {
        warn('FLOATING_LAUNCHER_POSITION_WRITE_FAILED');
        return;
      }
      writeValue(resolvedStorage, FLOATING_LAUNCHER_POSITION_KEY, serialized, 'FLOATING_LAUNCHER_POSITION_WRITE_FAILED');
    },
  };
}
