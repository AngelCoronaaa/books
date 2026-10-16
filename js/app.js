/* Interfaz principal: búsqueda, filtros, resultados, ficha del libro y biblioteca. */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s = '') => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const SUBJECTS = [
    ['fiction', 'Ficción'], ['poetry', 'Poesía'], ['drama', 'Teatro'], ['short stories', 'Cuentos'],
    ['adventure', 'Aventura'], ['love', 'Romance'], ['mystery', 'Misterio'], ['science fiction', 'Ciencia ficción'],
    ['history', 'Historia'], ['philosophy', 'Filosofía'], ['science', 'Ciencia'], ['biography', 'Biografía'],
    ['juvenile fiction', 'Infantil y juvenil'], ['religion', 'Religión'],
  ];
  const LANG_NAMES = { all: 'Español e inglés', es: 'Español', en: 'Inglés' };
  const SORT_NAMES = { editions: 'Más populares', old: 'Más antiguos', new: 'Más recientes', title: 'Título', random: 'Al azar' };

  const DEFAULTS = { q: '', lang: 'all', readable: true, subject: '', author: '', yearFrom: '', yearTo: '', sort: '' };
  const f = { ...DEFAULTS };
  let page = 1, loading = false, hasMore = false, controller = null, total = 0;

  /* ---------- Toast ---------- */
  let toastTimer;
  window.toast = (msg) => {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  };

  /* ---------- Tema de la app ---------- */
  function applyAppTheme() {
    const t = Store.prefs.appTheme;
    if (t) document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }
  $('app-theme').addEventListener('click', () => {
    const dark = Store.prefs.appTheme ? Store.prefs.appTheme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    Store.setPref('appTheme', dark ? 'light' : 'dark');
    applyAppTheme();
  });
  applyAppTheme();

  /* ---------- Portadas ---------- */
  function hue(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h % 360;
  }
  function coverHTML(b, size = 'M', { badges = true } = {}) {
    const h = hue(b.title || '');
    const src = b.cover ? `${API.coverUrl(b.cover, size)}?default=false` : b.ia ? API.iaThumb(b.ia) : '';
    const langs = (b.langs || []).map((l) => `<span class="badge">${API.LANG_LABELS[l]}</span>`).join('');
    return `
      <div class="cover" style="background:linear-gradient(155deg,hsl(${h} 42% 40%),hsl(${(h + 35) % 360} 48% 20%))">
        <div class="fallback"><strong>${esc(b.title)}</strong><small>${esc(b.author || '')}</small></div>
        ${src ? `<img src="${src}" alt="" loading="lazy" onload="this.naturalWidth>1&&this.classList.add('loaded')" onerror="this.remove()">` : ''}
        ${badges ? `<div class="badges">${b.ia ? '<span class="badge free">GRATIS</span>' : ''}${langs}</div>` : ''}
      </div>`;
  }
  const summary = (b) => ({ key: b.key, title: b.title, author: b.author, cover: b.cover, year: b.year, langs: b.langs, ia: b.ia });

  /* ---------- Filtros ---------- */
  const subjSelect = $('f-subject');
  subjSelect.insertAdjacentHTML('beforeend', SUBJECTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join(''));
  $('subject-chips').innerHTML = SUBJECTS.slice(0, 10).map(([v, l]) => `<button class="chip" data-subject="${v}">${l}</button>`).join('');

  function syncControls() {
    $('search-input').value = f.q;
    document.querySelectorAll('#f-lang input').forEach((r) => (r.checked = r.value === f.lang));
    $('f-readable').checked = f.readable;
    subjSelect.value = f.subject;
    $('f-author').value = f.author;
    $('f-year-from').value = f.yearFrom;
    $('f-year-to').value = f.yearTo;
    $('f-sort').value = f.sort;
    document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.subject === f.subject));
  }

  function renderActiveFilters() {
    const tags = [];
    const x = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    if (f.q) tags.push(['q', `“${f.q}”`]);
    if (f.lang !== 'all') tags.push(['lang', LANG_NAMES[f.lang]]);
    if (f.subject) tags.push(['subject', SUBJECTS.find(([v]) => v === f.subject)?.[1] || f.subject]);
    if (f.author) tags.push(['author', `Autor: ${f.author}`]);
    if (f.yearFrom || f.yearTo) tags.push(['year', `${f.yearFrom || '…'} – ${f.yearTo || '…'}`]);
    if (f.sort) tags.push(['sort', SORT_NAMES[f.sort]]);
    if (!f.readable) tags.push(['readable', 'Incluye no disponibles']);
    $('active-filters').innerHTML = tags.map(([k, l]) => `<button class="tag" data-clear="${k}">${esc(l)} ${x}</button>`).join('');
  }
  $('active-filters').addEventListener('click', (e) => {
    const t = e.target.closest('[data-clear]');
    if (!t) return;
    const k = t.dataset.clear;
    if (k === 'year') { f.yearFrom = ''; f.yearTo = ''; } else f[k] = DEFAULTS[k];
    syncControls();
    runSearch();
  });

  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const debouncedSearch = debounce(() => runSearch(), 450);

  document.querySelectorAll('#f-lang input').forEach((r) => r.addEventListener('change', () => { f.lang = r.value; runSearch(); }));
  $('f-readable').addEventListener('change', (e) => { f.readable = e.target.checked; runSearch(); });
  subjSelect.addEventListener('change', (e) => { f.subject = e.target.value; syncControls(); runSearch(); });
  $('f-sort').addEventListener('change', (e) => { f.sort = e.target.value; runSearch(); });
  $('f-author').addEventListener('input', (e) => { f.author = e.target.value.trim(); debouncedSearch(); });
  $('f-year-from').addEventListener('input', (e) => { f.yearFrom = e.target.value; debouncedSearch(); });
  $('f-year-to').addEventListener('input', (e) => { f.yearTo = e.target.value; debouncedSearch(); });
  $('clear-filters').addEventListener('click', () => { Object.assign(f, DEFAULTS, { q: f.q }); syncControls(); runSearch(); });
  $('subject-chips').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    f.subject = f.subject === c.dataset.subject ? '' : c.dataset.subject;
    syncControls();
    runSearch();
    document.querySelector('.layout').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    f.q = $('search-input').value.trim();
    showView('explore');
    runSearch();
    $('search-input').blur();
  });

  // Filtros en móvil
  const openFilters = (open) => { $('filters').classList.toggle('open', open); $('filters-scrim').classList.toggle('open', open); };
  $('open-filters').addEventListener('click', () => openFilters(true));
  $('close-filters').addEventListener('click', () => openFilters(false));
  $('filters-scrim').addEventListener('click', () => openFilters(false));

  /* ---------- URL ---------- */
  function writeHash() {
    const p = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v !== DEFAULTS[k]) p.set(k, String(v)); });
    const h = p.toString();
    history.replaceState(null, '', h ? `#${h}` : location.pathname + location.search);
  }
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    Object.keys(DEFAULTS).forEach((k) => {
      if (!p.has(k)) return;
      f[k] = k === 'readable' ? p.get(k) === 'true' : p.get(k);
    });
  }

  /* ---------- Resultados ---------- */
  const grid = $('results'), sentinel = $('sentinel');

  function cardHTML(b, i = 0) {
    return `
      <button class="card" data-key="${esc(b.key)}" style="animation-delay:${Math.min(i, 12) * 30}ms">
        ${coverHTML(b)}
        <h3>${esc(b.title)}</h3>
        <p>${esc(b.author)}${b.year ? ` · ${b.year}` : ''}</p>
      </button>`;
  }
  const skeletons = (n) => Array.from({ length: n }, () => '<div class="card skeleton"><div class="cover"></div><div class="line"></div><div class="line short"></div></div>').join('');

  const resultsByKey = new Map();

  function isDefaultView() { return !f.q && !f.subject && !f.author && !f.yearFrom && !f.yearTo; }

  async function runSearch(more = false) {
    if (!more) {
      page = 1;
      controller?.abort();
      grid.innerHTML = skeletons(12);
      sentinel.innerHTML = '';
      writeHash();
      renderActiveFilters();
      $('hero').hidden = !!f.q;
      $('results-title').textContent = f.q ? `Resultados para “${f.q}”` : f.subject ? SUBJECTS.find(([v]) => v === f.subject)?.[1] || 'Resultados' : isDefaultView() ? 'Clásicos más leídos' : 'Resultados';
      $('results-count').textContent = 'Buscando…';
    }
    controller = new AbortController();
    loading = true;
    if (more) sentinel.innerHTML = '<div class="spinner"></div>';
    const query = { ...f };
    if (isDefaultView() && !query.sort) query.sort = 'editions';
    try {
      const res = await API.search(query, page, controller.signal);
      total = res.total;
      hasMore = res.hasMore;
      if (!more) grid.innerHTML = '';
      res.docs.forEach((d) => resultsByKey.set(d.key, d));
      if (!res.docs.length && !more) {
        grid.innerHTML = `<div class="empty"><svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14zM20 17v4H6.5"/></svg><h3>No encontramos libros</h3><p>Prueba con otras palabras o quita algunos filtros.</p></div>`;
      } else {
        grid.insertAdjacentHTML('beforeend', res.docs.map(cardHTML).join(''));
      }
      $('results-count').textContent = total ? `${total.toLocaleString('es')} obras · ${LANG_NAMES[f.lang]}${f.readable ? ' · lectura gratuita' : ''}` : '';
      sentinel.innerHTML = hasMore ? '<button class="btn btn-ghost" id="load-more">Cargar más</button>' : res.docs.length ? '<span class="small">Has llegado al final</span>' : '';
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!more) grid.innerHTML = '';
      $('results-count').textContent = '';
      sentinel.innerHTML = '<div style="text-align:center"><p>No se pudo conectar con Open Library.</p><button class="btn btn-primary" id="retry">Reintentar</button></div>';
    } finally {
      loading = false;
    }
  }

  sentinel.addEventListener('click', (e) => {
    if (e.target.id === 'load-more') { page++; runSearch(true); }
    if (e.target.id === 'retry') runSearch(page > 1);
  });
  new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && hasMore && !loading && !$('view-explore').hidden) { page++; runSearch(true); }
  }, { rootMargin: '600px' }).observe(sentinel);

  grid.addEventListener('click', (e) => {
    const c = e.target.closest('.card[data-key]');
    if (c) openDetail(resultsByKey.get(c.dataset.key));
  });

  /* ---------- Ficha del libro ---------- */
  const modal = $('book-modal'), body = $('modal-body');
  let lastFocus = null;

  function openDetail(b) {
    if (!b) return;
    lastFocus = document.activeElement;
    const fav = Store.isFavorite(b.key);
    const langs = (b.allLangs || b.langs || []).map((l) => (l === 'spa' ? 'Español' : 'Inglés')).join(', ');
    const progress = b.ia && Store.getReading(b.ia);
    body.innerHTML = `
      <div>${coverHTML(b, 'L')}</div>
      <div class="m-info">
        <h2 id="m-title">${esc(b.title)}</h2>
        <p class="m-author">${esc(b.author)}</p>
        <div class="m-meta">
          ${b.year ? `<span>Publicado <b>${b.year}</b></span>` : ''}
          ${langs ? `<span>Idiomas <b>${langs}</b></span>` : ''}
          ${b.editionCount ? `<span><b>${b.editionCount}</b> ediciones</span>` : ''}
        </div>
        <p class="m-desc" id="m-desc"><span class="muted">Cargando descripción…</span></p>
        <div class="m-subjects" id="m-subjects"></div>
        <div class="m-actions">
          ${b.ia ? `<button class="btn btn-primary" data-read="${esc(b.ia)}">${progress?.percent > 0.01 ? `Continuar (${Math.round(progress.percent * 100)}%)` : 'Leer ahora'}</button>` : ''}
          <button class="btn btn-ghost" id="m-fav">${fav ? '♥ En favoritos' : '♡ Añadir a favoritos'}</button>
          <a class="btn btn-ghost" href="${API.olUrl(b.key)}" target="_blank" rel="noopener">Open Library ↗</a>
        </div>
        <div class="m-editions" id="m-editions">
          <h4>Ediciones escaneadas</h4>
          <div class="spinner"></div>
        </div>
      </div>`;
    modal.hidden = false;
    document.body.classList.add('no-scroll');
    modal.querySelector('.modal-close').focus();

    $('m-fav').addEventListener('click', (e) => {
      const on = Store.toggleFavorite(summary(b));
      e.currentTarget.textContent = on ? '♥ En favoritos' : '♡ Añadir a favoritos';
      toast(on ? 'Añadido a favoritos' : 'Quitado de favoritos');
      if (!$('view-library').hidden) renderLibrary();
    });

    API.getWork(b.key).then((w) => {
      if (modal.hidden) return;
      $('m-desc').innerHTML = w.description ? esc(w.description) : '<span class="muted">Sin descripción disponible.</span>';
      $('m-subjects').innerHTML = w.subjects.map((s) => `<button data-subj="${esc(s)}">${esc(s)}</button>`).join('');
    }).catch(() => { $('m-desc').innerHTML = '<span class="muted">Sin descripción disponible.</span>'; });

    API.getScannedEditions(b.key, f.lang).then((eds) => {
      if (modal.hidden) return;
      const box = $('m-editions');
      if (b.ia && !eds.some((e) => e.ia === b.ia)) eds.unshift({ ia: b.ia, title: b.editionTitle || b.title, langs: b.langs, year: '', recommended: true });
      eds.forEach((e) => { if (e.ia === b.ia) e.recommended = true; });
      eds.sort((a, z) => (z.recommended ? 1 : 0) - (a.recommended ? 1 : 0));
      if (!eds.length) {
        box.innerHTML = `<h4>Ediciones escaneadas</h4><p class="m-note">No hay ediciones digitalizadas en ${f.lang === 'all' ? 'español o inglés' : LANG_NAMES[f.lang].toLowerCase()} para esta obra.</p>`;
        return;
      }
      box.innerHTML = `<h4>Ediciones escaneadas (${eds.length})</h4>
        <ul class="ed-list">${eds.slice(0, 40).map((e) => `
          <li>
            ${(e.langs || []).filter((l) => API.LANG_LABELS[l]).map((l) => `<span class="badge">${API.LANG_LABELS[l]}</span>`).join('')}
            <span class="ed-title" title="${esc(e.title)}">${esc(e.title)}${e.year ? ` · ${e.year}` : ''}${e.publisher ? ` · ${esc(e.publisher)}` : ''}</span>
            <button class="btn ${e.recommended ? 'btn-primary' : 'btn-ghost'}" data-read="${esc(e.ia)}">${e.recommended ? 'Leer' : 'Probar'}</button>
          </li>`).join('')}</ul>
        ${b.ia ? '' : '<p class="m-note" style="margin-top:10px">Algunas ediciones solo están disponibles en préstamo; te avisaremos si es el caso.</p>'}`;
    }).catch(() => { $('m-editions').innerHTML = ''; });

    body.onclick = (e) => {
      const r = e.target.closest('[data-read]');
      if (r) { closeDetail(); Reader.open(summary({ ...b, ia: r.dataset.read }), r.dataset.read); return; }
      const s = e.target.closest('[data-subj]');
      if (s) {
        closeDetail();
        Object.assign(f, { q: '', subject: s.dataset.subj.toLowerCase() });
        syncControls();
        showView('explore');
        runSearch();
      }
    };
  }

  function closeDetail() {
    modal.hidden = true;
    document.body.classList.remove('no-scroll');
    lastFocus?.focus?.();
  }
  modal.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeDetail(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeDetail(); });

  /* ---------- Biblioteca ---------- */
  function timeAgo(t) {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'hace un momento';
    if (m < 60) return `hace ${m} min`;
    const h = Math.round(m / 60);
    if (h < 24) return `hace ${h} h`;
    const d = Math.round(h / 24);
    return d === 1 ? 'ayer' : `hace ${d} días`;
  }

  function renderLibrary() {
    const reading = Store.readingList().filter((r) => r.book);
    $('shelf-reading').innerHTML = reading.length
      ? reading.map((r) => `
        <div class="reading-item" role="button" tabindex="0" data-ia="${esc(r.ia)}">
          ${coverHTML({ ...r.book, ia: r.ia }, 'S', { badges: false })}
          <div style="flex:1;min-width:0">
            <h3>${esc(r.book.title)}</h3>
            <p>${esc(r.book.author || '')}</p>
            <div class="progress"><span style="width:${Math.round((r.percent || 0) * 100)}%"></span></div>
            <div class="meta">${Math.round((r.percent || 0) * 100)}% · ${timeAgo(r.updated)}${r.bookmarks?.length ? ` · ${r.bookmarks.length} marcador${r.bookmarks.length > 1 ? 'es' : ''}` : ''}</div>
          </div>
          <button class="iconbtn remove" data-remove="${esc(r.ia)}" aria-label="Quitar de la lista" title="Quitar de la lista"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
        </div>`).join('')
      : '<div class="empty">Todavía no has empezado ningún libro. <a href="#" data-nav="explore">Explora el catálogo</a>.</div>';

    const favs = Store.favorites();
    favs.forEach((b) => resultsByKey.set(b.key, { ...b, allLangs: b.langs }));
    $('shelf-favs').innerHTML = favs.length
      ? favs.map(cardHTML).join('')
      : '<div class="empty">Marca libros con ♡ para guardarlos aquí.</div>';
  }

  $('shelf-reading').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) { Store.removeReading(rm.dataset.remove); renderLibrary(); return; }
    const it = e.target.closest('[data-ia]');
    if (it) { const r = Store.getReading(it.dataset.ia); Reader.open(r.book, it.dataset.ia); }
  });
  $('shelf-reading').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-ia]')) e.target.click();
  });
  $('shelf-favs').addEventListener('click', (e) => {
    const c = e.target.closest('.card[data-key]');
    if (c) openDetail(resultsByKey.get(c.dataset.key));
  });

  /* ---------- Navegación ---------- */
  function showView(name) {
    $('view-explore').hidden = name !== 'explore';
    $('view-library').hidden = name !== 'library';
    document.querySelectorAll('.navbtn').forEach((b) => b.classList.toggle('active', b.dataset.nav === name));
    if (name === 'library') renderLibrary();
    window.scrollTo({ top: 0 });
  }
  document.addEventListener('click', (e) => {
    const n = e.target.closest('[data-nav]');
    if (!n) return;
    e.preventDefault();
    if (n.classList.contains('brand')) { Object.assign(f, DEFAULTS); syncControls(); runSearch(); }
    showView(n.dataset.nav);
  });

  Reader.onClose(() => { if (!$('view-library').hidden) renderLibrary(); });

  /* ---------- Inicio ---------- */
  readHash();
  syncControls();
  runSearch();
})();
