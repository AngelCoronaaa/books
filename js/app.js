/* Interfaz principal: búsqueda en varias fuentes, filtros, resultados, ficha del libro y biblioteca. */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s = '') => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const SUBJECTS = [
    ['fiction', 'Ficción'], ['technology', 'Tecnología'], ['computers', 'Programación e informática'],
    ['dystopias', 'Distopías'], ['science fiction', 'Ciencia ficción'], ['poetry', 'Poesía'],
    ['mystery', 'Misterio'], ['history', 'Historia'], ['philosophy', 'Filosofía'], ['science', 'Ciencia'],
    ['economics', 'Economía y negocios'], ['psychology', 'Psicología'], ['drama', 'Teatro'],
    ['short stories', 'Cuentos'], ['adventure', 'Aventura'], ['love', 'Romance'], ['biography', 'Biografía'],
    ['juvenile fiction', 'Infantil y juvenil'],
  ];
  const LANG_NAMES = { all: 'Español e inglés', es: 'Español', en: 'Inglés' };
  const AVAIL_NAMES = { full: 'Lectura completa gratis', preview: 'Gratis, préstamo o vista previa', all: 'Todo el catálogo' };
  const SOURCE_NAMES = { all: 'Todas las fuentes', ol: 'Open Library', google: 'Google Books' };
  const SORT_NAMES = { editions: 'Más populares', old: 'Más antiguos', new: 'Más recientes', title: 'Título', random: 'Al azar' };

  const DEFAULTS = { q: '', lang: 'all', source: 'all', avail: 'preview', subject: '', author: '', yearFrom: '', yearTo: '', sort: '' };
  const f = { ...DEFAULTS };
  let loading = false, hasMore = false, controller = null, srcState = {}, seen = new Set();

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
    const thumbIa = b.ia || b.borrowIa;
    const src = b.coverSrc || (b.cover ? `${API.coverUrl(b.cover, size)}?default=false` : thumbIa ? API.iaThumb(thumbIa) : '');
    const langs = (b.langs || []).map((l) => `<span class="badge">${API.LANG_LABELS[l]}</span>`).join('');
    return `
      <div class="cover" style="background:linear-gradient(155deg,hsl(${h} 42% 40%),hsl(${(h + 35) % 360} 48% 20%))">
        <div class="fallback"><strong>${esc(b.title)}</strong><small>${esc(b.author || '')}</small></div>
        ${src ? `<img src="${src}" alt="" loading="lazy" onload="this.naturalWidth>1&&this.classList.add('loaded')" onerror="this.remove()">` : ''}
        ${badges ? `<div class="badges">${accessBadge(b)}${langs}</div>` : ''}
      </div>`;
  }
  function accessBadge(b) {
    if (b.ia || (b.source === 'google' && b.full && b.viewable)) return '<span class="badge free">GRATIS</span>';
    if (b.source === 'google' && b.viewable) return '<span class="badge preview">VISTA PREVIA</span>';
    if (b.borrowIa) return '<span class="badge borrow">PRÉSTAMO</span>';
    return '';
  }
  const summary = (b) => ({
    source: b.source || 'ol', key: b.key, title: b.title, author: b.author, cover: b.cover, coverSrc: b.coverSrc,
    year: b.year, langs: b.langs, ia: b.ia, borrowIa: b.borrowIa, editionKey: b.editionKey,
    gbId: b.gbId, viewable: b.viewable, full: b.full, infoLink: b.infoLink,
    description: b.description ? b.description.slice(0, 2000) : undefined, subjects: b.subjects, publisher: b.publisher, pageCount: b.pageCount,
  });

  /* ---------- Filtros ---------- */
  const subjSelect = $('f-subject');
  subjSelect.insertAdjacentHTML('beforeend', SUBJECTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join(''));
  $('subject-chips').innerHTML = SUBJECTS.slice(0, 12).map(([v, l]) => `<button class="chip" data-subject="${v}">${l}</button>`).join('');

  function syncControls() {
    $('search-input').value = f.q;
    document.querySelectorAll('#f-lang input').forEach((r) => (r.checked = r.value === f.lang));
    document.querySelectorAll('#f-source input').forEach((r) => (r.checked = r.value === f.source));
    document.querySelectorAll('#f-avail input').forEach((r) => (r.checked = r.value === f.avail));
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
    if (f.source !== 'all') tags.push(['source', SOURCE_NAMES[f.source]]);
    if (f.avail !== 'preview') tags.push(['avail', AVAIL_NAMES[f.avail]]);
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
  document.querySelectorAll('#f-source input').forEach((r) => r.addEventListener('change', () => { f.source = r.value; runSearch(); }));
  document.querySelectorAll('#f-avail input').forEach((r) => r.addEventListener('change', () => { f.avail = r.value; runSearch(); }));
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
      f[k] = p.get(k);
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
        ${b.source === 'google' ? '<p class="source">Google Books</p>' : ''}
      </button>`;
  }
  const skeletons = (n) => Array.from({ length: n }, () => '<div class="card skeleton"><div class="cover"></div><div class="line"></div><div class="line short"></div></div>').join('');

  const resultsByKey = new Map();

  function isDefaultView() { return !f.q && !f.subject && !f.author && !f.yearFrom && !f.yearTo; }

  const fold = (t = '') => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ ]/g, '').trim();
  const dedupeKey = (b) => `${fold(b.title).slice(0, 40)}|${fold(b.author).split(' ')[0]}`;

  // Intercala los resultados de cada fuente para que se mezclen en la cuadrícula.
  function interleave(lists) {
    const out = [];
    const max = Math.max(0, ...lists.map((l) => l.length));
    for (let i = 0; i < max; i++) lists.forEach((l) => { if (l[i]) out.push(l[i]); });
    return out;
  }

  const emptyHTML = `<div class="empty"><svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14zM20 17v4H6.5"/></svg><h3>No encontramos libros</h3><p>Prueba con otras palabras, cambia la disponibilidad o quita algunos filtros.</p></div>`;

  async function runSearch(more = false) {
    if (!more) {
      controller?.abort();
      srcState = {};
      (f.source === 'all' ? ['ol', 'google'] : [f.source]).forEach((s) => (srcState[s] = { page: 0, hasMore: true, total: 0 }));
      seen = new Set();
      grid.innerHTML = skeletons(12);
      sentinel.innerHTML = '';
      writeHash();
      renderActiveFilters();
      $('hero').hidden = !!f.q;
      $('results-title').textContent = f.q ? `Resultados para “${f.q}”` : f.subject ? SUBJECTS.find(([v]) => v === f.subject)?.[1] || f.subject : isDefaultView() ? 'Los más leídos' : 'Resultados';
      $('results-count').textContent = 'Buscando…';
    }
    controller = new AbortController();
    const { signal } = controller;
    loading = true;
    if (more) sentinel.innerHTML = '<div class="spinner"></div>';
    const query = { ...f };
    if (isDefaultView() && !query.sort) query.sort = 'editions';

    const active = Object.entries(srcState).filter(([, st]) => st.hasMore);
    const lists = await Promise.all(active.map(async ([name, st]) => {
      st.page++;
      try {
        const res = name === 'ol' ? await API.search(query, st.page, signal) : await API.searchGoogle(query, st.page, signal);
        st.total = res.total;
        st.hasMore = res.hasMore;
        st.error = null;
        return res.docs;
      } catch (err) {
        st.hasMore = false;
        st.error = err.name === 'AbortError' ? 'abort' : err.code === 'quota' ? 'quota' : 'error';
        return [];
      }
    }));
    if (signal.aborted) return;
    loading = false;

    const docs = interleave(lists).filter((d) => {
      const k = dedupeKey(d);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    docs.forEach((d) => resultsByKey.set(d.key, d));
    if (!more) grid.innerHTML = '';

    const states = Object.entries(srcState);
    const failed = states.filter(([, st]) => st.error === 'error' || st.error === 'quota');
    if (!more && srcState.google?.error === 'quota') {
      grid.insertAdjacentHTML('beforeend', '<p class="notice">Google Books no respondió porque se agotó su cuota de consultas anónimas. Puedes añadir una API key gratuita en <code>js/config.js</code> para ver más libros modernos con vista previa.</p>');
    }
    if (!more && failed.length === states.length && !docs.length) {
      grid.innerHTML = '';
      $('results-count').textContent = '';
      sentinel.innerHTML = '<div style="text-align:center"><p>No se pudo conectar con las fuentes de libros.</p><button class="btn btn-primary" id="retry">Reintentar</button></div>';
      return;
    }
    if (!docs.length && !more) grid.insertAdjacentHTML('beforeend', emptyHTML);
    else grid.insertAdjacentHTML('beforeend', docs.map(cardHTML).join(''));

    const total = states.reduce((n, [, st]) => n + (st.total || 0), 0);
    hasMore = states.some(([, st]) => st.hasMore);
    $('results-count').textContent = total ? `${total.toLocaleString('es')} resultados · ${LANG_NAMES[f.lang]} · ${AVAIL_NAMES[f.avail].toLowerCase()}` : '';
    sentinel.innerHTML = hasMore ? '<button class="btn btn-ghost" id="load-more">Cargar más</button>' : grid.querySelector('.card') ? '<span class="small">Has llegado al final</span>' : '';
  }

  sentinel.addEventListener('click', (e) => {
    if (e.target.id === 'load-more') runSearch(true);
    if (e.target.id === 'retry') runSearch();
  });
  new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && hasMore && !loading && !$('view-explore').hidden) runSearch(true);
  }, { rootMargin: '600px' }).observe(sentinel);

  grid.addEventListener('click', (e) => {
    const c = e.target.closest('.card[data-key]');
    if (c) openDetail(resultsByKey.get(c.dataset.key));
  });

  /* ---------- Ficha del libro ---------- */
  const modal = $('book-modal'), body = $('modal-body');
  let lastFocus = null;

  function bindFav(b) {
    $('m-fav').addEventListener('click', (e) => {
      const on = Store.toggleFavorite(summary(b));
      e.currentTarget.textContent = on ? '♥ En favoritos' : '♡ Añadir a favoritos';
      toast(on ? 'Añadido a favoritos' : 'Quitado de favoritos');
      if (!$('view-library').hidden) renderLibrary();
    });
  }

  function showModal() {
    modal.hidden = false;
    document.body.classList.add('no-scroll');
    modal.querySelector('.modal-close').focus();
  }

  function openGoogleDetail(b) {
    const fav = Store.isFavorite(b.key);
    const langs = (b.langs || []).map((l) => (l === 'spa' ? 'Español' : 'Inglés')).join(', ');
    body.innerHTML = `
      <div>${coverHTML(b, 'L')}</div>
      <div class="m-info">
        <h2 id="m-title">${esc(b.title)}</h2>
        <p class="m-author">${esc(b.author)}</p>
        <div class="m-meta">
          ${b.year ? `<span>Publicado <b>${b.year}</b></span>` : ''}
          ${langs ? `<span>Idioma <b>${langs}</b></span>` : ''}
          ${b.pageCount ? `<span><b>${b.pageCount}</b> páginas</span>` : ''}
          ${b.publisher ? `<span>Editorial <b>${esc(b.publisher)}</b></span>` : ''}
          <span>Fuente <b>Google Books</b></span>
        </div>
        <p class="m-desc">${b.description ? esc(b.description) : '<span class="muted">Sin descripción disponible.</span>'}</p>
        <div class="m-subjects">${(b.subjects || []).map((x) => `<button data-subj="${esc(x)}">${esc(x)}</button>`).join('')}</div>
        <div class="m-actions">
          ${b.viewable ? `<button class="btn btn-primary" data-embed>${b.full ? 'Leer gratis' : 'Leer vista previa'}</button>` : ''}
          <button class="btn btn-ghost" id="m-fav">${fav ? '♥ En favoritos' : '♡ Añadir a favoritos'}</button>
          <a class="btn btn-ghost" href="${esc(b.infoLink)}" target="_blank" rel="noopener">Google Books ↗</a>
        </div>
        <p class="m-note">${b.viewable
          ? b.full ? 'Libro gratuito: se abre completo en el visor oficial de Google Books.' : 'Libro con derechos de autor: Google muestra una vista previa con una parte de las páginas. Para leerlo entero, búscalo en préstamo o en tu librería.'
          : 'Google no ofrece vista previa de este libro.'}</p>
      </div>`;
    showModal();
    bindFav(b);
    body.onclick = (e) => {
      if (e.target.closest('[data-embed]')) { closeDetail(); Reader.openEmbed(summary(b)); return; }
      const s = e.target.closest('[data-subj]');
      if (s) searchSubject(s.dataset.subj);
    };
  }

  function searchSubject(subj) {
    closeDetail();
    Object.assign(f, { q: '', subject: subj.toLowerCase() });
    syncControls();
    showView('explore');
    runSearch();
  }

  function openDetail(b) {
    if (!b) return;
    lastFocus = document.activeElement;
    if (b.source === 'google') { openGoogleDetail(b); return; }
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
          ${!b.ia && b.borrowIa ? `<a class="btn btn-primary" href="${API.olBorrowUrl(b)}" target="_blank" rel="noopener">Pedir prestado ↗</a>` : ''}
          ${!b.ia ? '<button class="btn btn-ghost" id="m-gpreview">Vista previa en Google</button>' : ''}
          <button class="btn btn-ghost" id="m-fav">${fav ? '♥ En favoritos' : '♡ Añadir a favoritos'}</button>
          <a class="btn btn-ghost" href="${API.olUrl(b.key)}" target="_blank" rel="noopener">Open Library ↗</a>
        </div>
        ${!b.ia && b.borrowIa ? '<p class="m-note" style="margin-bottom:18px">Este libro tiene derechos de autor. Open Library lo presta gratis durante 1 hora o 14 días con una cuenta gratuita, igual que una biblioteca.</p>' : ''}
        <div class="m-editions" id="m-editions">
          <h4>Ediciones escaneadas</h4>
          <div class="spinner"></div>
        </div>
      </div>`;
    showModal();
    bindFav(b);
    $('m-gpreview')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Buscando…';
      try {
        const vol = await API.findGooglePreview(b.title, b.author);
        if (vol) { closeDetail(); Reader.openEmbed(summary(vol)); return; }
        btn.textContent = 'Sin vista previa';
        toast('Google Books no tiene vista previa de este libro.');
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Vista previa en Google';
        toast(err.code === 'quota' ? 'Google Books alcanzó su límite de consultas. Añade una API key en js/config.js.' : 'No se pudo conectar con Google Books.');
      }
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
            <button class="btn ${e.recommended ? 'btn-primary' : 'btn-ghost'}" data-read="${esc(e.ia)}">${e.recommended ? 'Leer' : 'Abrir'}</button>
          </li>`).join('')}</ul>
        ${b.ia ? '' : '<p class="m-note" style="margin-top:10px">Algunas ediciones solo están disponibles en préstamo; te avisaremos si es el caso.</p>'}`;
    }).catch(() => { $('m-editions').innerHTML = ''; });

    body.onclick = (e) => {
      const r = e.target.closest('[data-read]');
      if (r) { closeDetail(); Reader.open(summary({ ...b, ia: r.dataset.read }), r.dataset.read); return; }
      const s = e.target.closest('[data-subj]');
      if (s) searchSubject(s.dataset.subj);
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
          ${coverHTML({ ...r.book, ia: r.mode === 'embed' ? null : r.ia }, 'S', { badges: false })}
          <div style="flex:1;min-width:0">
            <h3>${esc(r.book.title)}</h3>
            <p>${esc(r.book.author || '')}</p>
            <div class="progress"><span style="width:${Math.round((r.percent || 0) * 100)}%"></span></div>
            <div class="meta">${r.mode === 'embed' ? 'Google Books' : `${Math.round((r.percent || 0) * 100)}%`} · ${timeAgo(r.updated)}${r.bookmarks?.length ? ` · ${r.bookmarks.length} marcador${r.bookmarks.length > 1 ? 'es' : ''}` : ''}</div>
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
    if (!it) return;
    const r = Store.getReading(it.dataset.ia);
    if (r.mode === 'embed') Reader.openEmbed(r.book);
    else Reader.open(r.book, it.dataset.ia);
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
