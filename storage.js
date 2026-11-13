/**
 * Persistence layer using localStorage with schema versioning,
 * migrations, rolling backup, and corrupted-storage recovery.
 */

export const STORAGE_KEY = 'factGarden_v1';
export const BACKUP_KEY = 'factGarden_backup_v1';
export const CORRUPT_KEY_PREFIX = 'factGarden_corrupt_';
export const CURRENT_SCHEMA_VERSION = 1;

export function createDefaultState(now = Date.now()) {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    profile: { name: '', createdAt: now },
    settings: {
      sessionMinutes: 8,
      fastThresholdMs: 4000,
      newPerSession: 3,
      sound: false,
      garden: true,
      pinOrQuestion: 'question',
      pinCode: '',
      inverseMode: false,
      divisionMode: false,
      unlockOverride: null,
      softCapEnabled: true,
      placementDone: false
    },
    facts: {},
    sessions: [],
    currentSession: null,
    streak: { days: 0, lastDay: '' },
    badges: [],
    unlockedGroups: ['x0x1'],
    lastSavedAt: 0
  };
}

/**
 * Migrate older or partial state objects to CURRENT_SCHEMA_VERSION.
 */
export function migrateState(raw) {
  if (!raw || typeof raw !== 'object') {
    return createDefaultState();
  }
  const defaults = createDefaultState(raw.profile?.createdAt || Date.now());
  let state = { ...raw };

  // Stub for future v0 -> v1 migrations
  if (!state.schemaVersion || state.schemaVersion < 1) {
    state.schemaVersion = 1;
  }

  return {
    ...defaults,
    ...state,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    profile: { ...defaults.profile, ...(state.profile || {}) },
    settings: { ...defaults.settings, ...(state.settings || {}) },
    facts: state.facts && typeof state.facts === 'object' ? state.facts : {},
    sessions: Array.isArray(state.sessions) ? state.sessions : [],
    currentSession: state.currentSession ?? null,
    streak: { ...defaults.streak, ...(state.streak || {}) },
    badges: Array.isArray(state.badges) ? state.badges : [],
    unlockedGroups: Array.isArray(state.unlockedGroups) && state.unlockedGroups.length > 0
      ? state.unlockedGroups
      : ['x0x1']
  };
}

/**
 * Create a storage manager bound to `store` (defaults to window.localStorage).
 */
export function createStorage(store = typeof localStorage !== 'undefined' ? localStorage : null) {
  let persistRequested = false;

  function requestPersistence() {
    if (persistRequested) return;
    persistRequested = true;
    try {
      if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.persist === 'function') {
        navigator.storage.persist().catch(() => {});
      }
    } catch {
      // Ignore environments without navigator.storage
    }
  }

  function load() {
    if (!store) return createDefaultState();
    let rawStr = null;
    try {
      rawStr = store.getItem(STORAGE_KEY);
      if (!rawStr) {
        requestPersistence();
        return createDefaultState();
      }
      const parsed = JSON.parse(rawStr);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Invalid state shape');
      }
      return migrateState(parsed);
    } catch {
      // Back up corrupted raw string under a separate key and recover gracefully
      if (rawStr) {
        try {
          store.setItem(`${CORRUPT_KEY_PREFIX}${Date.now()}`, rawStr);
        } catch {
          // Ignore quota errors during recovery
        }
      }
      // Try rolling backup before falling back to fresh state
      try {
        const backupStr = store.getItem(BACKUP_KEY);
        if (backupStr) {
          const backupParsed = JSON.parse(backupStr);
          if (backupParsed && typeof backupParsed === 'object' && !Array.isArray(backupParsed)) {
            return migrateState(backupParsed);
          }
        }
      } catch {
        // Fall through to fresh state
      }
      return createDefaultState();
    }
  }

  function save(state) {
    if (!store) return false;
    requestPersistence();
    const toSave = {
      ...state,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      lastSavedAt: Date.now()
    };
    const json = JSON.stringify(toSave);
    try {
      // Keep rolling backup of the previous good state
      const prev = store.getItem(STORAGE_KEY);
      if (prev) {
        store.setItem(BACKUP_KEY, prev);
      }
      store.setItem(STORAGE_KEY, json);
      return true;
    } catch {
      return false;
    }
  }

  function exportJson(state) {
    return JSON.stringify(migrateState(state), null, 2);
  }

  function importJson(jsonString) {
    const parsed = JSON.parse(jsonString);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid backup file format.');
    }
    if (typeof parsed.facts !== 'object' || !Array.isArray(parsed.sessions)) {
      throw new Error('Backup file is missing required fact or session data.');
    }
    const migrated = migrateState(parsed);
    save(migrated);
    return migrated;
  }

  function resetAll() {
    const fresh = createDefaultState();
    save(fresh);
    return fresh;
  }

  return { load, save, exportJson, importJson, resetAll };
}
