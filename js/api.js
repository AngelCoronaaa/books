/* Cliente de Open Library e Internet Archive. */
const API = (() => {
  const OL = 'https://openlibrary.org';
  const IA = 'https://archive.org';
  const LANG_CODES = { es: 'spa', en: 'eng' };
  const LANG_LABELS = { spa: 'ES', eng: 'EN' };
  const PAGE_SIZE = 24;

  const FIELDS = [
    'key', 'title', 'subtitle', 'author_name', 'first_publish_year', 'cover_i', 'language',
    'ebook_access', 'edition_count', 'ia',
    'editions', 'editions.key', 'editions.title', 'editions.language', 'editions.ia',
    'editions.ebook_access', 'editions.cover_i', 'editions.publish_year',
  ].join(',');

  const cache = new Map();
  async function getJSON(url, { signal } = {}) {
    if (cache.has(url)) return cache.get(url);
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    cache.set(url, data);
    return data;
  }

  // Quita la sintaxis de Solr que rompería la consulta del usuario.
  const clean = (s) => s.replace(/[:\[\]{}()^~\\]/g, ' ').replace(/\s+/g, ' ').trim();

  function buildQuery(f) {
    const parts = [];
    if (f.q && clean(f.q)) parts.push(clean(f.q));
    if (f.author && clean(f.author)) parts.push(`author:"${clean(f.author).replace(/"/g, '')}"`);
    if (f.subject) parts.push(`subject:"${f.subject}"`);
    if (f.lang === 'es' || f.lang === 'en') parts.push(`language:${LANG_CODES[f.lang]}`);
    else parts.push('(language:spa OR language:eng)');
    if (f.readable) parts.push('ebook_access:public');
    const from = parseInt(f.yearFrom, 10), to = parseInt(f.yearTo, 10);
    if (from || to) parts.push(`first_publish_year:[${from || '*'} TO ${to || '*'}]`);
    return parts.join(' ');
  }

  function normalizeDoc(d, f) {
    const ed = d.editions?.docs?.[0];
    const langs = (d.language || []).filter((l) => LANG_LABELS[l]);
    const edLangs = (ed?.language || []).filter((l) => LANG_LABELS[l]);
    const readableIa = ed && ed.ebook_access === 'public' && ed.ia?.[0];
    return {
      key: d.key,
      title: d.title,
      subtitle: d.subtitle || '',
      author: (d.author_name || []).slice(0, 3).join(', ') || 'Autor desconocido',
      year: d.first_publish_year || null,
      cover: ed?.cover_i || d.cover_i || null,
      langs: edLangs.length ? edLangs : langs,
      allLangs: langs,
      editionCount: d.edition_count || 0,
      ia: readableIa || null,
      editionKey: ed?.key || null,
      editionTitle: ed?.title || d.title,
      access: ed?.ebook_access || d.ebook_access || 'no_ebook',
      filterLang: f.lang,
    };
  }

  async function search(f, page = 1, signal) {
    const params = new URLSearchParams({
      q: buildQuery(f),
      fields: FIELDS,
      limit: PAGE_SIZE,
      page,
    });
    if (f.sort) params.set('sort', f.sort);
    if (f.lang === 'es' || f.lang === 'en') params.set('lang', f.lang);
    const data = await getJSON(`${OL}/search.json?${params}`, { signal });
    return {
      total: data.numFound ?? data.num_found ?? 0,
      docs: (data.docs || []).map((d) => normalizeDoc(d, f)),
      hasMore: page * PAGE_SIZE < (data.numFound ?? 0),
    };
  }

  async function getWork(key) {
    const w = await getJSON(`${OL}${key}.json`);
    let desc = w.description;
    if (desc && typeof desc === 'object') desc = desc.value;
    if (desc) desc = desc.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\r/g, '').split(/\n-{3,}/)[0].trim();
    return {
      description: desc || '',
      subjects: (w.subjects || []).slice(0, 12),
    };
  }

  // Ediciones con escaneo en Internet Archive, filtradas por idioma.
  async function getScannedEditions(key, lang) {
    const data = await getJSON(`${OL}${key}/editions.json?limit=100`);
    const wanted = lang === 'es' ? ['spa'] : lang === 'en' ? ['eng'] : ['spa', 'eng'];
    return (data.entries || [])
      .filter((e) => e.ocaid)
      .map((e) => ({
        key: e.key,
        ia: e.ocaid,
        title: e.title,
        year: (e.publish_date || '').match(/\d{4}/)?.[0] || '',
        publisher: (e.publishers || [])[0] || '',
        langs: (e.languages || []).map((l) => l.key.split('/').pop()),
      }))
      .filter((e) => !e.langs.length || e.langs.some((l) => wanted.includes(l)));
  }

  // Metadatos del ítem de Internet Archive: páginas, texto OCR y si es de acceso libre.
  async function getItem(id) {
    const data = await getJSON(`${IA}/metadata/${encodeURIComponent(id)}`);
    if (!data || !data.metadata) throw new Error('not_found');
    const m = data.metadata;
    const files = data.files || [];
    const txt = files.find((f) => /_djvu\.txt$/.test(f.name));
    const restricted = String(m['access-restricted-item']) === 'true';
    return {
      id,
      title: Array.isArray(m.title) ? m.title[0] : m.title,
      pages: parseInt(m.imagecount, 10) || 0,
      rtl: m['page-progression'] === 'rl',
      textFile: !restricted && txt ? txt.name : null,
      textSize: txt ? parseInt(txt.size, 10) : 0,
      restricted,
      // Servidores de almacenamiento directos: la redirección de /download/ no siempre envía cabeceras CORS.
      hosts: [...new Set([data.server, data.d1, data.d2].filter(Boolean))],
      dir: data.dir || '',
    };
  }

  async function getText(item, onProgress) {
    const path = item.textFile.split('/').map(encodeURIComponent).join('/');
    const urls = item.dir ? item.hosts.map((h) => `https://${h}${item.dir}/${path}`) : [];
    urls.push(`${IA}/download/${encodeURIComponent(item.id)}/${path}`);
    let res;
    for (const url of urls) {
      try {
        res = await fetch(url);
        if (res.ok) break;
      } catch { res = null; }
    }
    if (!res || !res.ok) throw new Error('text_unavailable');
    const total = parseInt(res.headers.get('content-length'), 10) || 0;
    if (!res.body || !total || !onProgress) return res.text();
    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      onProgress(loaded / total);
    }
    const blob = new Blob(chunks);
    return new TextDecoder('utf-8').decode(await blob.arrayBuffer());
  }

  const coverUrl = (id, size = 'M') => (id ? `https://covers.openlibrary.org/b/id/${id}-${size}.jpg` : null);
  const iaThumb = (ia) => (ia ? `${IA}/services/img/${encodeURIComponent(ia)}` : null);
  const pageImage = (ia, n, w) => `${IA}/download/${encodeURIComponent(ia)}/page/n${n}_w${w}.jpg`;
  const olUrl = (key) => `${OL}${key}`;
  const iaUrl = (ia) => `${IA}/details/${encodeURIComponent(ia)}`;

  return { search, getWork, getScannedEditions, getItem, getText, coverUrl, iaThumb, pageImage, olUrl, iaUrl, LANG_LABELS, PAGE_SIZE };
})();
