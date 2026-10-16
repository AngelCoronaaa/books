/* Persistencia local: favoritos, progreso de lectura, marcadores y preferencias. */
const Store = (() => {
  const KEY = 'folio:v1';
  const defaults = {
    favorites: {},   // workKey -> resumen del libro
    reading: {},     // iaId -> { book, mode, textPos, scanPage, percent, updated, bookmarks: [] }
    prefs: {
      theme: 'sepia', size: 19, font: 'literata', lh: 1.6, margin: 'm',
      layout: 'auto', justify: true, anim: true, sound: true, appTheme: null,
    },
  };

  let state;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    state = raw ? { ...defaults, ...raw, prefs: { ...defaults.prefs, ...(raw.prefs || {}) } } : structuredClone(defaults);
  } catch {
    state = structuredClone(defaults);
  }

  let saveTimer;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* almacenamiento lleno o bloqueado */ }
    }, 150);
  }

  return {
    get prefs() { return state.prefs; },
    setPref(k, v) { state.prefs[k] = v; save(); },

    isFavorite(key) { return !!state.favorites[key]; },
    toggleFavorite(book) {
      if (state.favorites[book.key]) delete state.favorites[book.key];
      else state.favorites[book.key] = { ...book, added: Date.now() };
      save();
      return !!state.favorites[book.key];
    },
    favorites() { return Object.values(state.favorites).sort((a, b) => b.added - a.added); },

    getReading(ia) { return state.reading[ia]; },
    updateReading(ia, patch) {
      const cur = state.reading[ia] || { bookmarks: [] };
      state.reading[ia] = { ...cur, ...patch, updated: Date.now() };
      save();
      return state.reading[ia];
    },
    removeReading(ia) { delete state.reading[ia]; save(); },
    readingList() { return Object.entries(state.reading).map(([ia, r]) => ({ ia, ...r })).sort((a, b) => b.updated - a.updated); },
  };
})();
