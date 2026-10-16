/* Lector: paginación de texto, páginas escaneadas, animación de pasar hoja, marcadores y búsqueda. */
const Reader = (() => {
  const $ = (id) => document.getElementById(id);
  const el = {
    root: $('reader'), stage: $('r-stage'), book: $('r-book'), left: $('r-left'), right: $('r-right'),
    measure: $('r-measure'), loading: $('r-loading'), loadingText: $('r-loading-text'),
    title: $('r-title'), author: $('r-author'), prev: $('r-prev'), next: $('r-next'),
    slider: $('r-slider'), pageLabel: $('r-pagelabel'), percent: $('r-percent'), timeLeft: $('r-timeleft'),
    bookmarkBtn: $('r-bookmark'), bmList: $('bm-list'),
    panels: { settings: $('p-settings'), bookmarks: $('p-bookmarks'), search: $('p-search') },
  };
  const measureContent = el.measure.querySelector('.page-content');
  const FONTS = {
    literata: '"Literata", Georgia, serif',
    georgia: 'Georgia, "Times New Roman", serif',
    inter: '"Inter", system-ui, sans-serif',
    atkinson: '"Atkinson Hyperlegible", system-ui, sans-serif',
  };
  const MARGINS = { s: '6%', m: '9%', l: '13%' };
  const CHARS_PER_MIN = 230 * 5.7;

  let S = null;       // sesión de lectura activa
  let onCloseCb = null;

  /* ---------- Utilidades ---------- */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const toast = (msg) => window.toast && window.toast(msg);

  // Expresión regular que ignora acentos, para resaltar resultados de búsqueda.
  function accentRegex(term) {
    const map = { a: 'aáàäâã', e: 'eéèëê', i: 'iíìïî', o: 'oóòöôõ', u: 'uúùüû', n: 'nñ', c: 'cç' };
    const src = fold(term).split('').map((ch) => {
      const set = map[ch];
      if (set) return `[${set}${set.toUpperCase()}]`;
      return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('');
    return new RegExp(src, 'gi');
  }

  /* ---------- Sonido de página (sintetizado) ---------- */
  let actx, flipBuffer;
  function playFlip() {
    if (!Store.prefs.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const sr = actx.sampleRate, dur = 0.38;
      if (!flipBuffer) {
        flipBuffer = actx.createBuffer(1, Math.floor(sr * dur), sr);
        const d = flipBuffer.getChannelData(0);
        let last = 0;
        for (let i = 0; i < d.length; i++) {
          const t = i / d.length;
          const env = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.7)), 2) * (1 - t * 0.6);
          last = last * 0.55 + (Math.random() * 2 - 1) * 0.45; // ruido "marrón" suave
          d[i] = last * env * (0.6 + 0.4 * Math.sin(t * 40));
        }
      }
      const now = actx.currentTime;
      const src = actx.createBufferSource();
      src.buffer = flipBuffer;
      src.playbackRate.value = 0.9 + Math.random() * 0.25;
      const bp = actx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 0.8;
      bp.frequency.setValueAtTime(1400, now);
      bp.frequency.exponentialRampToValueAtTime(4200, now + dur);
      const g = actx.createGain();
      g.gain.value = 0.5;
      src.connect(bp).connect(g).connect(actx.destination);
      src.start();
    } catch { /* audio no disponible */ }
  }

  /* ---------- Texto: limpieza del OCR ---------- */
  function parseText(raw) {
    raw = raw.replace(/\r\n?/g, '\n').replace(/\f/g, '\n\n');
    let blocks = raw.split(/\n[ \t]*\n+/);

    // Algunos OCR no separan párrafos con líneas en blanco: se reconstruyen por heurística.
    if (blocks.length < raw.length / 5000) {
      const lines = raw.split('\n');
      const lens = lines.map((l) => l.trim().length).filter((n) => n > 20).sort((a, b) => a - b);
      const median = lens[Math.floor(lens.length / 2)] || 60;
      blocks = [];
      let buf = [];
      for (const line of lines) {
        const t = line.trim();
        if (!t) { if (buf.length) { blocks.push(buf.join('\n')); buf = []; } continue; }
        buf.push(t);
        if (/[.!?:»"”]$/.test(t) && t.length < median * 0.8) { blocks.push(buf.join('\n')); buf = []; }
      }
      if (buf.length) blocks.push(buf.join('\n'));
    }

    const out = [];
    for (let b of blocks) {
      b = b.replace(/(\p{L})[-¬]\n\s*(\p{Ll})/gu, '$1$2').replace(/[ \t]*\n[ \t]*/g, ' ').replace(/\s{2,}/g, ' ').trim();
      if (!b) continue;
      if (/^[\divxlcdm.\-—–*·\s]{1,10}$/i.test(b)) continue; // números de página sueltos
      if (b.length < 3 && !/\p{L}{2}/u.test(b)) continue;
      const letters = b.replace(/[^\p{L}]/gu, '');
      const heading = b.length < 70 && letters.length >= 3 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
      out.push({ t: b, h: heading });
    }
    return out;
  }

  /* ---------- Tipografía y tamaño ---------- */
  function applyPrefs() {
    const p = Store.prefs;
    el.root.dataset.theme = p.theme;
    el.root.style.setProperty('--read-font', FONTS[p.font] || FONTS.literata);
    el.root.style.setProperty('--read-size', `${p.size}px`);
    el.root.style.setProperty('--read-lh', p.lh);
    el.root.style.setProperty('--read-pad', MARGINS[p.margin] || MARGINS.m);
    el.root.classList.toggle('justify', !!p.justify);
  }

  function layout() {
    const r = el.stage.getBoundingClientRect();
    const mobile = r.width < 640;
    const availW = r.width - (mobile ? 16 : 130);
    const availH = r.height - (mobile ? 16 : 40);
    const pref = Store.prefs.layout;
    let spread = pref === 'double' ? availW > 420 : pref === 'single' ? false : availW > 880 && availW / availH > 1.2;
    const ratio = S && S.mode === 'scan' ? S.scanRatio || 0.68 : 0.7;
    const maxW = spread ? availW / 2 : availW;
    let pageH = availH;
    let pageW = Math.min(pageH * ratio, maxW, S && S.mode === 'text' ? 640 : 2000);
    if (S && S.mode === 'scan') pageH = Math.min(availH, pageW / ratio);
    else if (!spread && mobile) pageW = maxW; // en móvil el texto usa toda la pantalla
    pageW = Math.floor(pageW);
    pageH = Math.floor(pageH);
    const changed = !S.pageW || S.pageW !== pageW || S.pageH !== pageH || S.spread !== spread;
    S.pageW = pageW;
    S.pageH = pageH;
    S.spread = spread;
    el.root.style.setProperty('--page-w', `${pageW}px`);
    el.root.style.setProperty('--page-h', `${pageH}px`);
    el.book.classList.toggle('single', !spread);
    return changed;
  }

  /* ---------- Paginación ---------- */
  function fillMeasure(p, c) {
    const paras = S.paras;
    measureContent.innerHTML = '';
    const fits = () => measureContent.scrollHeight <= measureContent.clientHeight;
    let first = true;
    while (p < paras.length) {
      const para = paras[p];
      const text = para.t.slice(c);
      const node = document.createElement('p');
      if (para.h) node.className = 'h';
      else if (c > 0) node.className = 'cont';
      node.textContent = text;
      measureContent.appendChild(node);
      if (fits()) { p++; c = 0; first = false; continue; }
      if (para.h && !first) return { p, c };
      // El párrafo no cabe completo: búsqueda binaria del último corte por palabra que cabe.
      let lo = 1, hi = Math.min(text.length, 6000), best = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        let cut = text.lastIndexOf(' ', mid);
        if (cut <= 0) cut = mid;
        node.textContent = text.slice(0, cut);
        if (fits()) { best = cut; lo = mid + 1; } else hi = mid - 1;
      }
      if (!best) {
        if (!first) return { p, c };
        best = Math.max(1, text.indexOf(' ', 1) > 0 ? text.indexOf(' ', 1) : text.length);
      }
      let nc = c + best;
      while (nc < para.t.length && para.t[nc] === ' ') nc++;
      return nc >= para.t.length ? { p: p + 1, c: 0 } : { p, c: nc };
    }
    return { p, c };
  }

  async function paginate(targetPos, overlayText) {
    const token = ++S.pagToken;
    S.pages = [];
    S.paginating = true;
    S.ready = false;
    if (overlayText) showLoading(overlayText);
    const fam = (FONTS[Store.prefs.font] || '').split(',')[0];
    try { await document.fonts.load(`${Store.prefs.size}px ${fam}`); } catch { /* sin fuentes web */ }
    if (token !== S.pagToken) return;

    let p = 0, c = 0;
    const step = () => {
      if (!S || token !== S.pagToken) return;
      const t0 = performance.now();
      while (p < S.paras.length && performance.now() - t0 < 16) {
        const start = S.offsets[p] + c;
        const next = fillMeasure(p, c);
        S.pages.push({ p, c, ep: next.p, ec: next.c, start });
        p = next.p; c = next.c;
      }
      const done = p >= S.paras.length;
      if (done) S.paginating = false;
      const last = S.pages[S.pages.length - 1];
      if (!S.ready && (done || (last && last.start > targetPos && S.pages.length > (S.spread ? 3 : 2)))) {
        S.ready = true;
        hideLoading();
        goTo(pageForPos(targetPos), { silent: true });
      } else if (S.ready) {
        updateUI();
        if (S.spread && !S.flip) {
          // Rellena la página derecha si quedó vacía mientras se paginaba.
          if (!el.right.dataset.idx || +el.right.dataset.idx >= S.pages.length - 1) renderSpread(true);
        }
      } else if (overlayText) {
        el.loadingText.textContent = `${overlayText} ${Math.round(((last?.start || 0) / Math.max(1, targetPos)) * 100)}%`;
      }
      if (!done) setTimeout(step, 0);
    };
    step();
  }

  function pageForPos(pos) {
    const pages = S.pages;
    let lo = 0, hi = pages.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (pages[mid].start <= pos) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  /* ---------- Conteos y posiciones ---------- */
  const count = () => (S.mode === 'text' ? S.pages.length : S.item.pages);
  const done = () => S.mode === 'scan' || !S.paginating;
  const lastIndex = () => (done() ? count() : count() - 1); // el índice count() es la página "Fin"
  const norm = (i) => (S.spread ? i - (i % 2) : i);
  const span = () => (S.spread ? 2 : 1);
  const posOf = (i) => (S.mode === 'text' ? S.pages[i]?.start ?? S.totalChars : i);

  function percentAt(i) {
    if (S.mode === 'text') return S.totalChars ? clamp(posOf(i) / S.totalChars, 0, 1) : 0;
    return S.item.pages > 1 ? clamp(i / (S.item.pages - 1), 0, 1) : 0;
  }

  /* ---------- Renderizado de páginas ---------- */
  function pageText(i) {
    const pg = S.pages[i];
    if (!pg) return '';
    const parts = [];
    for (let p = pg.p; p <= pg.ep && p < S.paras.length; p++) {
      const from = p === pg.p ? pg.c : 0;
      const to = p === pg.ep ? pg.ec : S.paras[p].t.length;
      if (to <= from) continue;
      parts.push(S.paras[p].t.slice(from, to));
    }
    return parts.join(' ');
  }

  function textPageHTML(i) {
    const pg = S.pages[i];
    const hl = S.highlight ? accentRegex(S.highlight) : null;
    let html = '';
    for (let p = pg.p; p <= pg.ep && p < S.paras.length; p++) {
      const para = S.paras[p];
      const from = p === pg.p ? pg.c : 0;
      const to = p === pg.ep ? pg.ec : para.t.length;
      if (to <= from) continue;
      const cls = [];
      if (para.h) cls.push('h');
      else if (from > 0) cls.push('cont');
      if (to < para.t.length) cls.push('split');
      let txt = esc(para.t.slice(from, to));
      if (hl) txt = txt.replace(hl, (m) => `<mark>${m}</mark>`);
      html += `<p${cls.length ? ` class="${cls.join(' ')}"` : ''}>${txt}</p>`;
    }
    return `<div class="page-content">${html}</div><span class="folio">${i + 1}</span>`;
  }

  function scanWidth() {
    const need = S.pageW * Math.min(window.devicePixelRatio || 1, 2);
    return [400, 600, 800, 1000, 1200, 1600].find((w) => w >= need) || 1600;
  }

  function scanPageHTML(i) {
    const src = API.pageImage(S.ia, i, scanWidth());
    return `<div class="scan"><img src="${src}" alt="Página ${i + 1}" decoding="async" draggable="false" onload="this.classList.add('loaded')" onerror="this.classList.add('loaded')"><div class="spinner"></div></div>`;
  }

  function endPageHTML() {
    return `<div class="endpage"><div><strong>Fin</strong>${esc(S.book.title)}<div class="ornament">❦</div></div></div>`;
  }

  function pageHTML(i) {
    if (i < 0) return '';
    if (i >= count()) return done() && i === count() ? endPageHTML() : '';
    return S.mode === 'text' ? textPageHTML(i) : scanPageHTML(i);
  }

  function isBookmarked(i) {
    const bms = Store.getReading(S.ia)?.bookmarks || [];
    if (i < 0 || i >= count()) return false;
    if (S.mode === 'scan') return bms.some((b) => b.mode === 'scan' && b.pos === i);
    const a = S.pages[i].start, b = S.pages[i + 1]?.start ?? Infinity;
    return bms.some((m) => m.mode === 'text' && m.pos >= a && m.pos < b);
  }

  function setPage(node, i) {
    node.innerHTML = pageHTML(i) + (isBookmarked(i) ? '<div class="ribbon"></div>' : '');
    node.dataset.idx = i;
  }

  function renderSpread(keepBlank) {
    if (S.spread) { setPage(el.left, S.cur); setPage(el.right, S.cur + 1); }
    else setPage(el.right, S.cur);
    if (!keepBlank) preload();
    updateUI();
  }

  function preload() {
    if (S.mode !== 'scan') return;
    const w = scanWidth();
    for (let k = 1; k <= 4; k++) {
      const i = S.cur + span() - 1 + k;
      if (i < S.item.pages) new Image().src = API.pageImage(S.ia, i, w);
    }
    if (S.cur > 0) new Image().src = API.pageImage(S.ia, S.cur - 1, w);
  }

  /* ---------- UI de progreso ---------- */
  function updateUI() {
    const n = count();
    const shownLast = Math.min(S.cur + span(), n);
    const est = S.mode === 'text' && S.paginating && S.pages.length > 4
      ? `~${Math.round(S.totalChars / (S.pages[S.pages.length - 1].start / (S.pages.length - 1)))}`
      : n;
    const label = S.cur >= n
      ? 'Fin'
      : S.spread && shownLast > S.cur + 1 ? `Págs. ${S.cur + 1}–${shownLast} de ${est}` : `Pág. ${S.cur + 1} de ${est}`;
    el.pageLabel.textContent = label;
    const pct = S.cur >= n ? 1 : percentAt(S.cur);
    el.percent.textContent = `${Math.round(pct * 100)}%`;
    el.slider.max = Math.max(0, lastIndex());
    el.slider.value = S.cur;
    el.slider.style.setProperty('--pct', `${pct * 100}%`);
    if (S.mode === 'text') {
      const left = (S.totalChars - posOf(Math.min(S.cur + span(), n))) / CHARS_PER_MIN;
      el.timeLeft.textContent = left <= 1 ? '' : left < 60 ? `≈ ${Math.round(left)} min restantes` : `≈ ${Math.floor(left / 60)} h ${Math.round(left % 60)} min restantes`;
    } else el.timeLeft.textContent = '';
    el.prev.disabled = S.cur <= 0;
    el.next.disabled = S.cur + span() > lastIndex() && done();
    const marked = isBookmarked(S.cur) || (S.spread && isBookmarked(S.cur + 1));
    el.bookmarkBtn.classList.toggle('on', marked);
  }

  let saveTimer;
  function saveProgress() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!S || !S.ready) return;
      const patch = { mode: S.mode, percent: S.cur >= count() ? 1 : percentAt(S.cur), book: S.book };
      if (S.mode === 'text') patch.textPos = posOf(Math.min(S.cur, count() - 1));
      else patch.scanPage = S.cur;
      Store.updateReading(S.ia, patch);
    }, 300);
  }

  /* ---------- Navegación ---------- */
  function canGo(dir) {
    if (dir < 0) return S.cur > 0;
    return S.cur + span() <= lastIndex();
  }

  function goTo(i, { silent } = {}) {
    if (!S) return;
    if (S.flip) { S.flip.cancel(); }
    S.cur = clamp(norm(i), 0, norm(Math.max(0, lastIndex())));
    renderSpread();
    if (!silent) {
      el.book.animate([{ opacity: 0.4, transform: 'scale(.99)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
    }
    saveProgress();
  }

  function createFlip(dir) {
    const spread = S.spread, cur = S.cur;
    const target = cur + dir * span();
    const fl = document.createElement('div');
    fl.className = 'flipper';
    const mkFace = (side) => {
      const f = document.createElement('div');
      f.className = `face ${side}`;
      fl.appendChild(f);
      return f;
    };
    const front = mkFace('front'), back = mkFace('back');
    const fillFace = (face, i, side) => {
      face.innerHTML = pageHTML(i) + '<div class="shade"></div>';
      face.classList.add(side);
    };
    let angle, restore = () => {};
    if (spread && dir > 0) {
      setPage(el.right, target + 1);
      fl.style.left = `${S.pageW}px`;
      fl.style.transformOrigin = 'left center';
      fillFace(front, cur + 1, 'pr');
      fillFace(back, target, 'pl');
      angle = (p) => -180 * p;
      restore = () => setPage(el.right, cur + 1);
    } else if (spread && dir < 0) {
      setPage(el.left, target);
      fl.style.left = '0px';
      fl.style.transformOrigin = 'right center';
      fillFace(front, cur, 'pl');
      fillFace(back, target + 1, 'pr');
      angle = (p) => 180 * p;
      restore = () => setPage(el.left, cur);
    } else if (dir > 0) {
      setPage(el.right, target);
      fl.style.left = '0px';
      fl.style.transformOrigin = 'left center';
      fillFace(front, cur, 'pr');
      back.classList.add('blank');
      back.innerHTML = '<div class="shade"></div>';
      angle = (p) => -180 * p;
      restore = () => setPage(el.right, cur);
    } else {
      fl.style.left = '0px';
      fl.style.transformOrigin = 'left center';
      fillFace(front, target, 'pr');
      back.classList.add('blank');
      back.innerHTML = '<div class="shade"></div>';
      angle = (p) => -180 * (1 - p);
    }
    el.book.appendChild(fl);
    const fs = front.querySelector('.shade'), bs = back.querySelector('.shade');
    const flip = {
      p: 0, dir, target,
      set(p) {
        this.p = p;
        const a = angle(p);
        const t = Math.abs(a) / 180;
        const lift = Math.sin(t * Math.PI) * 30;
        fl.style.transform = `translateZ(${lift}px) rotateY(${a}deg)`;
        fs.style.opacity = t < 0.5 ? t * 1.5 : 0;
        bs.style.opacity = t > 0.5 ? (1 - t) * 1.3 : 0;
        if (!spread) fl.style.opacity = t > 0.5 ? Math.max(0, 1 - (t - 0.5) * 2.2) : 1;
      },
      commit() {
        fl.remove();
        S.flip = null;
        S.cur = target;
        renderSpread();
        saveProgress();
      },
      cancel() {
        fl.remove();
        S.flip = null;
        restore();
      },
    };
    flip.set(0);
    S.flip = flip;
    return flip;
  }

  function animateFlip(flip, to, dur, ease, cb) {
    const from = flip.p;
    const t0 = performance.now();
    const tick = (now) => {
      if (S?.flip !== flip) return;
      const k = Math.min(1, (now - t0) / dur);
      flip.set(from + (to - from) * ease(k));
      if (k < 1) requestAnimationFrame(tick);
      else cb();
    };
    requestAnimationFrame(tick);
  }

  function go(dir, fast) {
    if (!S || !S.ready) return;
    if (S.flip) { S.queue = dir; return; }
    if (!canGo(dir)) {
      if (dir > 0 && !done()) toast('Preparando más páginas…');
      el.book.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${dir * -8}px)` }, { transform: 'translateX(0)' }], { duration: 250 });
      return;
    }
    S.highlight = null;
    if (!Store.prefs.anim) {
      S.cur += dir * span();
      renderSpread();
      saveProgress();
      return;
    }
    playFlip();
    const flip = createFlip(dir);
    animateFlip(flip, 1, fast ? 400 : 720, easeInOut, () => {
      flip.commit();
      if (S && S.queue) { const q = S.queue; S.queue = 0; requestAnimationFrame(() => go(q, true)); }
    });
  }

  /* ---------- Arrastre de la hoja ---------- */
  let drag = null;
  el.book.addEventListener('pointerdown', (e) => {
    if (!S || !S.ready || S.flip || e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, t: performance.now(), flip: null, p: 0 };
    el.book.setPointerCapture(e.pointerId);
  });
  el.book.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.flip) {
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy)) return;
      const dir = dx < 0 ? 1 : -1;
      if (!canGo(dir) || S.flip) { drag.dead = true; return; }
      if (!Store.prefs.anim) { go(dir); drag.dead = true; return; }
      S.highlight = null;
      drag.dir = dir;
      drag.flip = createFlip(dir);
      playFlip();
    }
    const range = S.spread ? S.pageW * 1.6 : S.pageW * 1.1;
    drag.p = clamp((drag.dir > 0 ? -dx : dx) / range, 0, 1);
    drag.flip.set(drag.p);
  });
  const endDrag = (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.flip) {
      const quick = performance.now() - d.t < 280 && d.p > 0.06;
      const complete = d.p > 0.35 || quick;
      animateFlip(d.flip, complete ? 1 : 0, 320, easeOut, () => (complete ? d.flip.commit() : d.flip.cancel()));
    } else if (!d.dead && e.type === 'pointerup' && Math.abs(e.clientX - d.x) < 6) {
      const r = el.book.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      if (S.spread) go(x < 0.5 ? -1 : 1);
      else go(x < 0.33 ? -1 : 1);
    }
  };
  el.book.addEventListener('pointerup', endDrag);
  el.book.addEventListener('pointercancel', endDrag);

  el.prev.addEventListener('click', () => go(-1));
  el.next.addEventListener('click', () => go(1));
  el.slider.addEventListener('input', () => {
    const i = norm(+el.slider.value);
    el.pageLabel.textContent = i >= count() ? 'Fin' : `Ir a pág. ${i + 1}`;
  });
  el.slider.addEventListener('change', () => { S.highlight = null; goTo(+el.slider.value); });

  // Rueda del ratón / trackpad horizontal
  let wheelLock = 0;
  el.stage.addEventListener('wheel', (e) => {
    if (!S || !S.ready || e.target.closest('.rpanel')) return;
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(d) < 25 || performance.now() < wheelLock) return;
    wheelLock = performance.now() + 600;
    go(d > 0 ? 1 : -1);
  }, { passive: true });

  /* ---------- Carga ---------- */
  function showLoading(text, actionsHTML = '') {
    el.loading.hidden = false;
    el.loading.innerHTML = `<div class="book-loader"><span></span><span></span><span></span></div><p id="r-loading-text">${esc(text)}</p>${actionsHTML}`;
    el.loadingText = $('r-loading-text');
  }
  function showError(text, actionsHTML) {
    el.loading.hidden = false;
    el.loading.innerHTML = `<p>${esc(text)}</p>${actionsHTML || ''}`;
  }
  function hideLoading() { el.loading.hidden = true; }

  async function open(book, ia) {
    if (S) S.pagToken++;
    S = { book, ia, pagToken: 0, cur: 0, pages: [], ready: false, mode: null, queue: 0 };
    leaveEmbed();
    applyPrefs();
    el.title.textContent = book.title;
    el.author.textContent = book.author || '';
    el.left.innerHTML = el.right.innerHTML = '';
    closePanels();
    el.root.hidden = false;
    document.body.classList.add('no-scroll');
    showLoading('Abriendo libro…');
    try {
      S.item = await API.getItem(ia);
    } catch {
      showError('No se pudo obtener este libro de Internet Archive.', `<button class="btn btn-primary" onclick="Reader.close()">Volver</button>`);
      return;
    }
    if (S?.ia !== ia) return;
    const item = S.item;
    if (item.restricted || (!item.textFile && !item.pages)) {
      showError('Esta edición no es de dominio público: solo se puede pedir prestada en Internet Archive.',
        `<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><a class="btn btn-primary" href="${API.iaUrl(ia)}" target="_blank" rel="noopener">Ver en Internet Archive</a><button class="btn btn-ghost" onclick="Reader.close()">Volver</button></div>`);
      return;
    }
    const saved = Store.getReading(ia);
    const hasText = !!item.textFile, hasScan = item.pages > 0;
    document.querySelector('#r-mode input[value=text]').disabled = !hasText;
    document.querySelector('#r-mode input[value=scan]').disabled = !hasScan;
    let mode = saved?.mode || (hasText ? 'text' : 'scan');
    if (mode === 'text' && !hasText) mode = 'scan';
    if (mode === 'scan' && !hasScan) mode = 'text';
    Store.updateReading(ia, { book, mode, percent: saved?.percent || 0 });
    await setMode(mode, saved);
  }

  async function setMode(mode, saved) {
    if (!S) return;
    const prevPct = S.ready ? (S.cur >= count() ? 1 : percentAt(S.cur)) : null;
    S.pagToken++;
    if (S.flip) S.flip.cancel();
    S.mode = mode;
    S.ready = false;
    el.root.classList.toggle('scan-mode', mode === 'scan');
    document.querySelector(`#r-mode input[value=${mode}]`).checked = true;
    layout();

    if (mode === 'scan') {
      const start = prevPct != null ? Math.round(prevPct * (S.item.pages - 1)) : saved?.scanPage ?? Math.round((saved?.percent || 0) * (S.item.pages - 1));
      S.ready = true;
      hideLoading();
      // Ajusta la proporción a la del primer escaneo.
      const probe = new Image();
      probe.onload = () => {
        if (!S || S.mode !== 'scan' || !probe.naturalWidth) return;
        const r = probe.naturalWidth / probe.naturalHeight;
        if (Math.abs(r - (S.scanRatio || 0.68)) > 0.02) { S.scanRatio = clamp(r, 0.45, 1); if (layout()) renderSpread(); }
      };
      probe.src = API.pageImage(S.ia, Math.min(start + 1, S.item.pages - 1), 400);
      goTo(start, { silent: true });
      return;
    }

    if (!S.paras) {
      showLoading('Descargando texto…');
      try {
        const raw = await API.getText(S.item, (f) => {
          if (el.loadingText) el.loadingText.textContent = `Descargando texto… ${Math.round(f * 100)}%`;
        });
        if (!S || S.mode !== 'text') return;
        S.paras = parseText(raw);
      } catch {
        S.paras = [];
      }
      if (!S.paras.length) {
        toast('El texto de este libro no está disponible; mostrando las páginas originales.');
        document.querySelector('#r-mode input[value=text]').disabled = true;
        if (S.item.pages) return setMode('scan', saved);
        showError('No se pudo cargar el contenido de este libro.', `<button class="btn btn-primary" onclick="Reader.close()">Volver</button>`);
        return;
      }
      S.offsets = new Array(S.paras.length);
      let acc = 0;
      S.paras.forEach((p, i) => { S.offsets[i] = acc; acc += p.t.length + 1; });
      S.totalChars = acc;
    }
    const target = prevPct != null ? Math.floor(prevPct * S.totalChars) : saved?.textPos ?? 0;
    paginate(target, 'Preparando páginas…');
  }

  function repaginate() {
    if (!S || !S.ready || S.mode !== 'text') return;
    const pos = posOf(Math.min(S.cur, count() - 1));
    paginate(pos, 'Reorganizando páginas…');
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    if (!S || el.root.hidden) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!S || !S.mode) return;
      if (layout()) {
        if (S.mode === 'text') repaginate();
        else goTo(S.cur, { silent: true });
      }
    }, 200);
  });

  /* ---------- Visor de Google Books (vista previa oficial) ---------- */
  const embedBox = $('r-embed');
  function leaveEmbed() {
    el.root.classList.remove('embed-mode');
    embedBox.hidden = true;
    embedBox.innerHTML = '';
  }

  function openEmbed(book) {
    if (S) S.pagToken++;
    S = { book, ia: book.key, embed: true, pagToken: 0, pages: [], ready: false };
    applyPrefs();
    closePanels();
    el.title.textContent = book.title;
    el.author.textContent = `${book.author || ''} · ${book.full ? 'Google Books' : 'Vista previa de Google Books'}`;
    el.root.classList.add('embed-mode');
    el.root.hidden = false;
    document.body.classList.add('no-scroll');
    showLoading('Abriendo visor de Google Books…');
    embedBox.hidden = false;
    embedBox.innerHTML = `
      <iframe src="${API.googleEmbedUrl(book.gbId)}" title="${esc(book.title)}" allowfullscreen></iframe>
      <p>${book.full ? 'Libro gratuito' : 'Vista previa limitada ofrecida por Google: algunas páginas pueden estar ocultas'} · <a href="${esc(book.infoLink || '#')}" target="_blank" rel="noopener">Abrir en Google Books ↗</a></p>`;
    embedBox.querySelector('iframe').addEventListener('load', hideLoading, { once: true });
    setTimeout(hideLoading, 6000);
    Store.updateReading(book.key, { book, mode: 'embed', percent: Store.getReading(book.key)?.percent || 0 });
  }

  function close() {
    if (!S) return;
    if (S.embed) {
      S = null;
      leaveEmbed();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      el.root.hidden = true;
      document.body.classList.remove('no-scroll');
      onCloseCb && onCloseCb();
      return;
    }
    saveProgress();
    clearTimeout(saveTimer);
    if (S.ready) {
      const patch = { mode: S.mode, percent: S.cur >= count() ? 1 : percentAt(S.cur) };
      if (S.mode === 'text') patch.textPos = posOf(Math.min(S.cur, count() - 1));
      else patch.scanPage = S.cur;
      Store.updateReading(S.ia, patch);
    }
    S.pagToken++;
    S = null;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    el.root.hidden = true;
    document.body.classList.remove('no-scroll');
    onCloseCb && onCloseCb();
  }

  /* ---------- Marcadores ---------- */
  function toggleBookmark() {
    if (!S || !S.ready || S.cur >= count()) return;
    const r = Store.getReading(S.ia) || {};
    let bms = r.bookmarks || [];
    const visible = [S.cur, S.cur + 1].slice(0, span()).filter((i) => i < count());
    const marked = visible.filter(isBookmarked);
    if (marked.length) {
      bms = bms.filter((b) => !marked.some((i) => {
        if (S.mode === 'scan') return b.mode === 'scan' && b.pos === i;
        const a = S.pages[i].start, z = S.pages[i + 1]?.start ?? Infinity;
        return b.mode === 'text' && b.pos >= a && b.pos < z;
      }));
      toast('Marcador eliminado');
    } else {
      const i = S.cur;
      bms.push({
        mode: S.mode,
        pos: posOf(i),
        percent: percentAt(i),
        page: i + 1,
        snippet: S.mode === 'text' ? pageText(i).slice(0, 140) : `Página escaneada ${i + 1}`,
        created: Date.now(),
      });
      toast('Página marcada');
    }
    Store.updateReading(S.ia, { bookmarks: bms });
    renderSpread(true);
    renderBookmarks();
  }

  function renderBookmarks() {
    if (!S) return;
    const bms = (Store.getReading(S.ia)?.bookmarks || []).slice().sort((a, b) => a.percent - b.percent);
    if (!bms.length) {
      el.bmList.innerHTML = '<li class="bm-empty">Aún no tienes marcadores.<br>Pulsa el icono de cinta o la tecla B.</li>';
      return;
    }
    el.bmList.innerHTML = bms.map((b, k) => `
      <li>
        <button class="go" data-k="${k}"><b>${b.mode === 'text' ? 'Texto' : 'Páginas'} · ${Math.round(b.percent * 100)}%</b><span class="snippet">${esc(b.snippet || '')}</span></button>
        <button class="iconbtn" data-del="${k}" aria-label="Eliminar marcador"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      </li>`).join('');
    el.bmList.onclick = async (e) => {
      const go = e.target.closest('[data-k]'), del = e.target.closest('[data-del]');
      if (del) {
        const b = bms[+del.dataset.del];
        const all = (Store.getReading(S.ia)?.bookmarks || []).filter((x) => x !== b && !(x.created === b.created));
        Store.updateReading(S.ia, { bookmarks: all });
        renderBookmarks();
        renderSpread(true);
      } else if (go) {
        const b = bms[+go.dataset.k];
        jumpTo(b.mode, b.pos, b.percent);
        if (window.innerWidth < 640) closePanels();
      }
    };
  }

  async function jumpTo(mode, pos, percent) {
    if (mode !== S.mode) {
      const okMode = !document.querySelector(`#r-mode input[value=${mode}]`).disabled;
      if (okMode) {
        if (mode === 'scan') { await setMode('scan'); goTo(pos); return; }
        S.ready = false;
        await setMode('text', { textPos: pos });
        return;
      }
      // Modo no disponible: aproximar por porcentaje.
      pos = S.mode === 'text' ? Math.floor(percent * S.totalChars) : Math.round(percent * (S.item.pages - 1));
    }
    goTo(S.mode === 'text' ? pageForPos(pos) : pos);
  }

  /* ---------- Búsqueda en el libro ---------- */
  function searchInBook(term) {
    const list = $('rs-list'), countEl = $('rs-count');
    list.innerHTML = '';
    term = term.trim();
    if (!term) { countEl.textContent = ''; return; }
    if (S.mode !== 'text' || !S.paras) {
      countEl.textContent = 'La búsqueda funciona en el modo Texto.';
      return;
    }
    if (!S.folded) S.folded = S.paras.map((p) => fold(p.t));
    const q = fold(term);
    const results = [];
    for (let p = 0; p < S.folded.length && results.length < 300; p++) {
      let idx = S.folded[p].indexOf(q);
      while (idx !== -1 && results.length < 300) {
        results.push({ p, idx });
        idx = S.folded[p].indexOf(q, idx + q.length);
      }
    }
    countEl.textContent = results.length ? `${results.length >= 300 ? '300+' : results.length} resultados` : 'Sin resultados.';
    const re = accentRegex(term);
    list.innerHTML = results.map((r, k) => {
      const t = S.paras[r.p].t;
      const a = Math.max(0, r.idx - 50), z = Math.min(t.length, r.idx + q.length + 70);
      const snip = (a > 0 ? '…' : '') + esc(t.slice(a, z)).replace(re, (m) => `<mark>${m}</mark>`) + (z < t.length ? '…' : '');
      const pct = Math.round(((S.offsets[r.p] + r.idx) / S.totalChars) * 100);
      return `<li><button data-k="${k}"><b>${pct}%</b><span class="snippet">${snip}</span></button></li>`;
    }).join('');
    list.onclick = (e) => {
      const b = e.target.closest('[data-k]');
      if (!b) return;
      const r = results[+b.dataset.k];
      const pos = S.offsets[r.p] + r.idx;
      if (S.paginating && pos > S.pages[S.pages.length - 1].start) { toast('Aún se están preparando esas páginas, intenta en un momento.'); return; }
      S.highlight = term;
      goTo(pageForPos(pos));
      if (window.innerWidth < 640) closePanels();
    };
  }

  /* ---------- Paneles y ajustes ---------- */
  function closePanels() { Object.values(el.panels).forEach((p) => (p.hidden = true)); }
  function togglePanel(name) {
    const p = el.panels[name];
    const willOpen = p.hidden;
    closePanels();
    p.hidden = !willOpen;
    if (willOpen && name === 'bookmarks') renderBookmarks();
    if (willOpen && name === 'search') setTimeout(() => $('rs-input').focus(), 50);
  }
  el.root.querySelectorAll('[data-close-panel]').forEach((b) => b.addEventListener('click', closePanels));
  $('r-settings-btn').addEventListener('click', () => togglePanel('settings'));
  $('r-bookmarks-btn').addEventListener('click', () => togglePanel('bookmarks'));
  $('r-search-btn').addEventListener('click', () => togglePanel('search'));
  $('r-bookmark').addEventListener('click', toggleBookmark);
  $('r-close').addEventListener('click', close);
  $('rs-form').addEventListener('submit', (e) => { e.preventDefault(); searchInBook($('rs-input').value); });
  $('r-fullscreen').addEventListener('click', toggleFullscreen);
  document.querySelectorAll('#r-mode input').forEach((r) => r.addEventListener('change', () => {
    if (S && r.checked && r.value !== S.mode) setMode(r.value);
  }));

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.root.requestFullscreen?.().catch(() => toast('Pantalla completa no disponible'));
  }
  let chromeTimer;
  el.root.addEventListener('mousemove', () => {
    if (!document.fullscreenElement) return;
    el.root.classList.add('show-chrome');
    clearTimeout(chromeTimer);
    chromeTimer = setTimeout(() => el.root.classList.remove('show-chrome'), 1800);
  });

  // Controles de ajustes
  function syncSettingsUI() {
    const p = Store.prefs;
    document.querySelectorAll('#s-theme button').forEach((b) => b.classList.toggle('active', b.dataset.theme === p.theme));
    $('s-size').value = p.size;
    $('s-size-out').textContent = `${p.size}px`;
    $('s-font').value = p.font;
    $('s-lh').value = p.lh;
    $('s-lh-out').textContent = (+p.lh).toFixed(1);
    document.querySelectorAll('#s-margin input').forEach((r) => (r.checked = r.value === p.margin));
    document.querySelectorAll('#s-layout input').forEach((r) => (r.checked = r.value === p.layout));
    $('s-justify').checked = p.justify;
    $('s-anim').checked = p.anim;
    $('s-sound').checked = p.sound;
  }
  let typoTimer;
  function setTypo(k, v) {
    Store.setPref(k, v);
    applyPrefs();
    syncSettingsUI();
    clearTimeout(typoTimer);
    typoTimer = setTimeout(repaginate, 250);
  }
  document.querySelectorAll('#s-theme button').forEach((b) => b.addEventListener('click', () => {
    Store.setPref('theme', b.dataset.theme); applyPrefs(); syncSettingsUI();
  }));
  $('s-size').addEventListener('input', (e) => setTypo('size', +e.target.value));
  $('s-size-down').addEventListener('click', () => setTypo('size', clamp(Store.prefs.size - 1, 14, 30)));
  $('s-size-up').addEventListener('click', () => setTypo('size', clamp(Store.prefs.size + 1, 14, 30)));
  $('s-font').addEventListener('change', (e) => setTypo('font', e.target.value));
  $('s-lh').addEventListener('input', (e) => setTypo('lh', +e.target.value));
  document.querySelectorAll('#s-margin input').forEach((r) => r.addEventListener('change', () => setTypo('margin', r.value)));
  $('s-justify').addEventListener('change', (e) => setTypo('justify', e.target.checked));
  document.querySelectorAll('#s-layout input').forEach((r) => r.addEventListener('change', () => {
    Store.setPref('layout', r.value);
    if (S && S.mode && layout()) { S.mode === 'text' ? repaginate() : goTo(S.cur, { silent: true }); }
  }));
  $('s-anim').addEventListener('change', (e) => Store.setPref('anim', e.target.checked));
  $('s-sound').addEventListener('change', (e) => { Store.setPref('sound', e.target.checked); if (e.target.checked) playFlip(); });
  syncSettingsUI();
  applyPrefs();

  // Teclado
  document.addEventListener('keydown', (e) => {
    if (el.root.hidden || !S) return;
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName) && document.activeElement.type !== 'range' && document.activeElement.type !== 'radio' && document.activeElement.type !== 'checkbox';
    if (e.key === 'Escape') {
      if (Object.values(el.panels).some((p) => !p.hidden)) closePanels();
      else if (!document.fullscreenElement) close();
      return;
    }
    if (typing || S.embed) return;
    switch (e.key) {
      case 'ArrowRight': case 'PageDown': case ' ': e.preventDefault(); go(1); break;
      case 'ArrowLeft': case 'PageUp': e.preventDefault(); go(-1); break;
      case 'Home': goTo(0); break;
      case 'End': goTo(lastIndex()); break;
      case 'b': case 'B': toggleBookmark(); break;
      case 'f': case 'F': toggleFullscreen(); break;
      default:
    }
  });

  return {
    open,
    openEmbed,
    close,
    onClose(cb) { onCloseCb = cb; },
    get isOpen() { return !!S; },
  };
})();
