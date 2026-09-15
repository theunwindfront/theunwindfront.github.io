/* ઔષધિ (Aushadhi) — USP product identification, Gujarati output.
   Everything (key, PDF, history) stays on the device. */

import { CONFIG } from './config.js';

const $ = (id) => document.getElementById(id);

/* ---------------------------------------------------------------
   IndexedDB — the "memory" the app finds on every launch.
   Stores: meta (the user's key), source (the default USP PDF), history.
---------------------------------------------------------------- */
const DB_NAME = 'aushadhi';
const DB_VER = 1;
let dbp;

function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
        const r = indexedDB.open(DB_NAME, DB_VER);
        r.onupgradeneeded = () => {
            const d = r.result;
            if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
            if (!d.objectStoreNames.contains('source')) d.createObjectStore('source');
            if (!d.objectStoreNames.contains('history')) {
                d.createObjectStore('history', { keyPath: 'id' }).createIndex('at', 'at');
            }
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
    });
    return dbp;
}

async function put(store, val, key) {
    const d = await db();
    return new Promise((res, rej) => {
        const t = d.transaction(store, 'readwrite');
        t.objectStore(store).put(val, key);
        t.oncomplete = res;
        t.onerror = () => rej(t.error);
    });
}

async function get(store, key) {
    const d = await db();
    return new Promise((res, rej) => {
        const r = d.transaction(store, 'readonly').objectStore(store).get(key);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
    });
}

async function del(store, key) {
    const d = await db();
    return new Promise((res, rej) => {
        const t = d.transaction(store, 'readwrite');
        t.objectStore(store).delete(key);
        t.oncomplete = res;
        t.onerror = () => rej(t.error);
    });
}

async function allHistory() {
    const d = await db();
    return new Promise((res, rej) => {
        const r = d.transaction('history', 'readonly').objectStore('history').getAll();
        r.onsuccess = () => res((r.result || []).sort((a, b) => b.at - a.at));
        r.onerror = () => rej(r.error);
    });
}

async function clearStore(store) {
    const d = await db();
    return new Promise((res, rej) => {
        const t = d.transaction(store, 'readwrite');
        t.objectStore(store).clear();
        t.oncomplete = res;
        t.onerror = () => rej(t.error);
    });
}

/* ---------------------------------------------------------------
   App state
---------------------------------------------------------------- */
const state = {
    apiKey: CONFIG.apiKey || '',
    source: null,     // { name, pages:[{page, text}], addedAt }
    front: null,      // { dataUrl, mime, b64 }
    back: null,
    lastResult: null,
    chat: [],
    chatImage: null,
};

const GEMINI_URL = (model) =>
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

/* ---------------------------------------------------------------
   Small helpers
---------------------------------------------------------------- */
let toastTimer;
function toast(msg, ms = 2600) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Render a safe subset of markdown the model tends to emit. */
function mdToHtml(md) {
    const lines = esc(md).split('\n');
    let out = '', list = false;
    for (let raw of lines) {
        const line = raw.trim();
        if (!line) { if (list) { out += '</ul>'; list = false; } continue; }
        if (/^#{1,4}\s/.test(line)) {
            if (list) { out += '</ul>'; list = false; }
            out += `<h3>${line.replace(/^#{1,4}\s/, '')}</h3>`;
        } else if (/^[-*•]\s/.test(line)) {
            if (!list) { out += '<ul>'; list = true; }
            out += `<li>${inline(line.replace(/^[-*•]\s/, ''))}</li>`;
        } else {
            if (list) { out += '</ul>'; list = false; }
            out += `<p>${inline(line)}</p>`;
        }
    }
    if (list) out += '</ul>';
    return out;
}

const inline = (s) => s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

/* Downscale a captured photo so uploads stay small and fast. */
function readImage(file, maxSide = 1280) {
    return new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => {
            const img = new Image();
            img.onload = () => {
                let { width: w, height: h } = img;
                const scale = Math.min(1, maxSide / Math.max(w, h));
                w = Math.round(w * scale); h = Math.round(h * scale);
                const c = document.createElement('canvas');
                c.width = w; c.height = h;
                c.getContext('2d').drawImage(img, 0, 0, w, h);
                const dataUrl = c.toDataURL('image/jpeg', 0.82);
                res({ dataUrl, mime: 'image/jpeg', b64: dataUrl.split(',')[1] });
            };
            img.onerror = rej;
            img.src = fr.result;
        };
        fr.onerror = rej;
        fr.readAsDataURL(file);
    });
}

/* ---------------------------------------------------------------
   PDF → searchable page index (NotebookLM-style grounding source)
---------------------------------------------------------------- */
/* Below this many characters a page is treated as image-only (a scan), so we
   keep a rendered picture of it for the vision model to read. */
const TEXT_FLOOR = 60;

async function indexPdf(file, onProgress) {
    const pdfjsLib = window.pdfjsLib ||
        await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';

    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

    const pages = [];
    let scanned = 0;

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);

        const tc = await page.getTextContent();
        const text = tc.items.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim();

        /* A page with little or no text is a scan — render it so the vision
           model can read it later. Text pages stay text-only: far smaller,
           and searching them is what makes lookup fast. */
        const thin = text.length < TEXT_FLOOR;
        const entry = { page: i, text };
        if (thin) {
            entry.image = await renderPage(page, 1000);
            scanned++;
        }
        if (text || entry.image) pages.push(entry);

        onProgress?.(Math.round((i / pdf.numPages) * 100));
    }

    /* Index once, here — every later scan searches this instead of sending
       the book to the model. Costs nothing but a moment of local work. */
    const index = buildIndex(pages);

    return {
        name: file.name,
        pages,
        index,
        addedAt: Date.now(),
        scanned,
        terms: Object.keys(index).length,
    };
}

/* Render one PDF page to a JPEG data URL. */
async function renderPage(page, maxSide = 1000) {
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2, maxSide / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');

    /* White ground: PDFs assume paper, and transparency reads as black. */
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL('image/jpeg', 0.75);
}

/* Read scanned pages once, so a picture-only book becomes searchable.

   A fully scanned 150-page book has no text to index, which would leave every
   scan guessing from a handful of page images. Instead we OCR each page ONCE
   here, at upload, and index the result. That costs one request per page up
   front — then every later scan is as cheap as a text PDF.

   Pages are read in small batches to stay under the per-minute rate limit. */
const OCR_BATCH = 4;

async function ocrPages(pages, onProgress) {
    const todo = pages.filter((p) => p.image && !p.text);
    if (!todo.length) return 0;

    let done = 0;
    for (let i = 0; i < todo.length; i += OCR_BATCH) {
        const batch = todo.slice(i, i + OCR_BATCH);

        await Promise.all(batch.map(async (p) => {
            try {
                p.text = (await callVision({
                    messages: [{
                        role: 'user',
                        content: [
                            { type: 'text', text: 'Transcribe all text in this page exactly. Text only, no commentary.' },
                            imgPartRaw(p.image),
                        ],
                    }],
                })).trim();
                p.ocr = true;
            } catch {
                /* A page that fails to read stays an image; it can still be
                   sent to the model directly later. */
            }
            onProgress?.(++done, todo.length);
        }));
    }
    return todo.filter((p) => p.ocr).length;
}

/* Build a lookup index once, at upload time.

   This is what makes a 150-page book affordable: the index is computed here,
   locally, and every later scan searches it instead of sending pages to the
   model. Indexing costs no tokens at all — it is plain text processing.

   For each page we keep the distinctive terms (brand names, salts, strengths)
   with the page numbers they appear on, so a lookup is a map hit rather than
   a scan of the whole book. */
function buildIndex(pages) {
    const index = new Map();   // term -> Set of page numbers

    for (const p of pages) {
        if (!p.text) continue;
        for (const t of terms(p.text)) {
            let hit = index.get(t);
            if (!hit) index.set(t, (hit = new Set()));
            hit.add(p.page);
        }
    }

    /* A term on almost every page (headers, the book's own title) tells us
       nothing about which page a product is on, so drop it. */
    const ceiling = Math.max(3, Math.floor(pages.length * 0.4));
    for (const [t, set] of index) if (set.size > ceiling) index.delete(t);

    return Object.fromEntries([...index].map(([t, set]) => [t, [...set]]));
}

/* Words that appear on every pharma page and so identify nothing. */
const STOP = new Set([
    'tablet', 'tablets', 'capsule', 'capsules', 'strip', 'pack', 'packs',
    'mfg', 'exp', 'batch', 'mrp', 'inclusive', 'taxes', 'storage', 'store',
    'below', 'protect', 'light', 'moisture', 'keep', 'reach', 'children',
    'schedule', 'prescription', 'registered', 'trademark', 'marketed',
    'manufactured', 'india', 'limited', 'ltd', 'pvt', 'private', 'company',
    'page', 'usp', 'product', 'book', 'name', 'salt', 'company', 'each',
    'contains', 'composition', 'dosage', 'use', 'uses', 'rate', 'price',
    'number', 'code', 'ref', 'reference', 'category', 'the', 'and', 'for',
    'with', 'this', 'that', 'from', 'per',
]);

/* Normalise a token so the same drug matches across spelling variants.

   Medicine text is noisy: OCR reads O as 0 and l as 1, strengths appear as
   "650mg", "650 mg" and "650MG", and plurals come and go. Folding all of
   that into one form is what makes the lookup actually hit. */
function normalize(w) {
    let t = w.toLowerCase()
        .replace(/[0o]/g, '0')     // DOLO / DOL0 / D0L0 → the same key
        .replace(/[1il]/g, '1')    // AZILIDE / AZ1L1DE
        .replace(/[5s]/g, '5');    // 5UN / SUN
    if (t.length > 4 && t.endsWith('s')) t = t.slice(0, -1);
    return t;
}

/* Tokens worth indexing, with strengths split out so "650mg" also matches
   a page that writes "650 mg". */
function terms(text) {
    const out = new Set();
    const raw = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];

    const FORM_CODES = new Set(['ec', 'sc', 'wp', 'wg', 'sl', 'sg', 'sp',
        'cs', 'od', 'ew', 'fs', 'me', 'ze', 'gr', 'dp']);

    for (const w of raw) {
        if (FORM_CODES.has(w)) { out.add(w); continue; }
        if (w.length < 3 || STOP.has(w)) continue;
        out.add(normalize(w));

        /* "650mg" → also index "650" and "mg650" so spacing never matters. */
        const m = w.match(/^(\d+)\s*(mg|ml|mcg|gm|g|kg|iu|ltr|lt|l)$/);
        if (m) { out.add(m[1]); out.add(m[2] + m[1]); }
    }

    /* Agrochemicals are identified by strength + formulation code, e.g.
       "15% EC", "17.8% SL", "75% WP". Capture those as single keys so
       TOLFERA 15% EC cannot be confused with CYPERUNI 10% EC. */
    const form = text.toLowerCase();
    for (const m of form.matchAll(/(\d+(?:\.\d+)?)\s*%\s*(ec|sc|wp|wg|sl|sg|sp|cs|od|ew|fs|me|ze|gr|dp)\b/g)) {
        out.add(m[1] + '%' + m[2]);   // "15%ec"
        out.add(m[1] + 'pct');        // "15pct"
        out.add(m[2]);                // "ec"
    }
    /* A bare percentage still carries signal on its own. */
    for (const m of form.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) out.add(m[1] + 'pct');

    /* Adjacent pairs catch multi-word names like "pan d" or "dolo 650". */
    const words = raw.filter((w) => w.length >= 3 && !STOP.has(w));
    for (let i = 0; i < words.length - 1; i++) {
        out.add(normalize(words[i]) + '~' + normalize(words[i + 1]));
    }
    return out;
}

/* Edit distance, capped: cheap enough to run over candidate terms only. */
function close(a, b, max = 1) {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > max) return false;

    let i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) { i++; j++; continue; }
        if (++edits > max) return false;
        if (a.length > b.length) i++;
        else if (a.length < b.length) j++;
        else { i++; j++; }
    }
    return edits + (a.length - i) + (b.length - j) <= max;
}

/* Pages matching these search terms, via the prebuilt index. */
function lookup(source, searchText, limit = MAX_PAGES_SENT) {
    const idx = source?.index;
    if (!idx) return null;

    const total = source.pages.length || 1;
    const keys = Object.keys(idx);
    const score = new Map();
    const hitTerms = new Map();   // page -> distinct terms matched

    const credit = (n, weight, term) => {
        score.set(n, (score.get(n) || 0) + weight);
        if (!hitTerms.has(n)) hitTerms.set(n, new Set());
        hitTerms.get(n).add(term);
    };

    for (const t of terms(searchText)) {
        let pages = idx[t];
        let penalty = 1;

        /* Nothing exact — try a near-spelling. This is what rescues OCR
           slips like DOL0 for DOLO, or a missing letter in a long salt name. */
        if (!pages && t.length >= 5) {
            const near = keys.find((k) => k.length >= 5 && close(k, t));
            if (near) { pages = idx[near]; penalty = 0.6; }
        }
        if (!pages) continue;

        /* Rarer terms identify a product; terms on many pages do not.
           (Classic IDF — a brand name on 1 page far outweighs a word on 50.) */
        const idf = Math.log(1 + total / pages.length);
        /* A two-word phrase ("dolo~650") is a much stronger signal. */
        const phrase = t.includes('~') ? 2.5 : 1;

        /* Cross-referencing a competitor's product: the customer's BRAND is
           absent from our book, but the technical name and its strength are
           what make two products equivalent. Weight those hardest. */
        const technical = /^\d+(\.\d+)?%(ec|sc|wp|wg|sl|sg|sp|cs|od|ew|fs|me|ze|gr|dp)$/.test(t)
            ? 3          // "15%ec" — strength + formulation together
            : t.length >= 8 ? 1.8   // long chemical names: tolfenpyrad, imidacloprid
                : 1;

        for (const n of pages) credit(n, idf * phrase * technical * penalty, t);
    }
    if (!score.size) return null;

    /* A page matching several different terms beats one matching the same
       common word repeatedly, so scale by how many distinct terms landed. */
    for (const [n, set] of hitTerms) {
        score.set(n, score.get(n) * (1 + Math.log(set.size)));
    }

    const ranked = [...score].sort((a, b) => b[1] - a[1]);

    /* The dealer needs options, not just the single best hit: if the exact
       equivalent is out of stock or priced wrong, they want the next closest
       product to offer. So keep a looser tail than a pure "best match" search
       would — the model then labels each one as exact or partial. */
    const top = ranked[0][1];
    const best = ranked.filter(([, v]) => v >= top * 0.12)
        .slice(0, limit).map(([n]) => n);

    return source.pages.filter((p) => best.includes(p.page))
        .sort((a, b) => a.page - b.page);
}

/* Products sharing the customer's category or crop, for when nothing shares
   its technical. A dealer can still offer "same job, different chemistry"
   rather than turning the customer away. */
function similarPages(source, searchText, exclude = [], limit = 4) {
    if (!source?.pages?.length) return [];

    /* Category and use words carry the "what is it for" signal. */
    const KIND = /insecticide|fungicide|herbicide|miticide|acaricide|nematicide|plant growth|pgr|bio|organic|antibiotic|analgesic|antacid|antifungal/gi;
    const wanted = new Set((searchText.match(KIND) || []).map((w) => w.toLowerCase().trim())
        .filter(Boolean));
    if (!wanted.size) return [];

    const out = [];
    for (const p of source.pages) {
        if (!p.text || exclude.includes(p.page)) continue;
        const low = p.text.toLowerCase();
        if ([...wanted].some((w) => low.includes(w))) out.push(p);
        if (out.length >= limit) break;
    }
    return out;
}

/* Pick the pages most likely to contain the product, so we send a
   focused slice of the book instead of the whole thing. */
/* How much of the book one request may carry.

   A 150-page book is far too big to send on every scan — it would spend the
   whole daily quota in a few lookups. Instead the PDF is indexed ONCE at
   upload time (see buildIndex), and each scan searches that index locally
   and sends only the handful of pages that actually match. These budgets are
   the ceiling for that handful, not the whole book. */
const TEXT_BUDGET = 120_000;   // characters ≈ 30k tokens per request
const IMAGE_BUDGET = 3;        // page pictures per request
const MAX_PAGES_SENT = 8;      // matched pages per request

function relevantPages(source, searchText, limit = MAX_PAGES_SENT) {
    if (!source?.pages?.length) return [];

    /* Prebuilt index: a map hit instead of scanning every page. */
    const viaIndex = lookup(source, searchText, limit);
    if (viaIndex?.length) return viaIndex;

    const textPages = source.pages.filter((p) => p.text);
    const imagePages = source.pages.filter((p) => p.image);
    const toks = [...terms(searchText)];

    /* No usable text anywhere (a scanned book that was not read at upload).
       Sample evenly across the whole book rather than only the first pages,
       so the product at least has a chance of being in the sample. */
    if (!textPages.length) {
        if (imagePages.length <= IMAGE_BUDGET) return imagePages;
        const step = imagePages.length / IMAGE_BUDGET;
        return Array.from({ length: IMAGE_BUDGET },
            (_, i) => imagePages[Math.floor(i * step)]);
    }

    if (!toks.length) return bookSlice(source);

    const scored = textPages.map((p) => {
        const lower = p.text.toLowerCase();
        let score = 0;
        for (const t of new Set(toks)) {
            const hits = lower.split(t).length - 1;
            if (hits) score += hits + t.length / 4;
        }
        return { ...p, score };
    });

    const hit = scored.filter((p) => p.score > 0).sort((a, b) => b.score - a.score);
    const ranked = hit.length ? hit : scored;

    /* Best matches first, stopping at the budget. On a big book this is a
       few pages out of hundreds, which is what keeps each scan cheap. */
    const out = [];
    let used = 0;
    for (const p of ranked.slice(0, Math.min(limit, MAX_PAGES_SENT))) {
        if (used + p.text.length > TEXT_BUDGET) break;
        used += p.text.length;
        out.push(p);
    }

    /* Text search found nothing — the answer may be on a scanned page, so
       include page images for the model to look at. */
    if (!hit.length && imagePages.length) {
        out.push(...imagePages.slice(0, IMAGE_BUDGET));
    }
    return out.sort((a, b) => a.page - b.page);
}

/* The whole book, as far as one request can carry it.

   Gemini accepts ~1M input tokens. Text is roughly 4 characters per token, so
   a budget in characters keeps us safely inside that without counting tokens.
   Page images are the expensive part (~1100 tokens each), so they are capped
   separately and only included when a page has no text of its own. */
function bookSlice(source) {
    if (!source?.pages?.length) return [];

    const out = [];
    let used = 0;
    let imgs = 0;

    for (const p of source.pages) {
        if (p.text) {
            if (used + p.text.length > TEXT_BUDGET) continue;
            used += p.text.length;
            out.push(p);
        } else if (p.image && imgs < IMAGE_BUDGET) {
            imgs++;
            out.push(p);
        }
    }
    return out;
}

/* Page images to attach to a request, capped to keep the payload sane. */
const pageImages = (pages, max = IMAGE_BUDGET) =>
    pages.filter((p) => p.image).slice(0, max);

const clip = (t, n = 2600) => (t.length > n ? t.slice(0, n) + '…' : t);

function sourceBlock(pages) {
    if (!pages.length) return '(કોઈ સ્રોત નથી)';
    return pages.map((p) => p.text
        ? `[પાનું ${p.page}]\n${p.text}`
        : `[પાનું ${p.page}] — આ પાનું ચિત્ર તરીકે જોડેલું છે, તેને વાંચો.`
    ).join('\n\n---\n\n');
}

/* ---------------------------------------------------------------
   Model calls
---------------------------------------------------------------- */
const SYSTEM = `તમે ડીલર/વેપારી માટે પ્રોડક્ટ મેચિંગ સહાયક છો.

ગ્રાહક બીજી કંપનીની પ્રોડક્ટનો ફોટો લાવે છે. તમારે આપેલી કૅટલોગ બુકમાંથી
તેની સમકક્ષ પ્રોડક્ટ શોધી આપવાની છે.

મુખ્ય નિયમ — ટેકનિકલ નામથી મેચ કરો, બ્રાન્ડથી નહીં:
• બ્રાન્ડ નામ કંપનીએ કંપનીએ જુદાં હોય છે; ટેકનિકલ (સક્રિય ઘટક), તેની ટકાવારી
  અને ફોર્મ્યુલેશન (EC/SC/WP/WG/SL) એક જ હોય તો પ્રોડક્ટ સમકક્ષ ગણાય.
  દા.ત. Tolfenpyrad 15% EC = Tolfenpyrad 15% EC, ભલે બ્રાન્ડ જુદી હોય.
• બુકનું બ્રાન્ડ નામ અને ફોટાનું બ્રાન્ડ નામ ક્યારેય ભેળવશો નહીં —
  બંને અલગ અલગ સ્પષ્ટ બતાવો.

મેચનું સ્તર આ રીતે નક્કી કરો:
• "સંપૂર્ણ મેચ" — ટેકનિકલ, ટકાવારી અને ફોર્મ્યુલેશન ત્રણેય સરખાં.
• "આંશિક મેચ" — ટેકનિકલ સરખું પણ ટકાવારી કે ફોર્મ્યુલેશન જુદું.
• "મળી નથી" — બુકમાં આ ટેકનિકલની કોઈ પ્રોડક્ટ નથી. ખોટી પ્રોડક્ટ ન સૂચવો.

બીજા નિયમો:
1. જવાબ ગુજરાતીમાં. બ્રાન્ડ/ટેકનિકલ નામ મૂળ સ્વરૂપે રાખો.
2. દરેક દાવા પછી કૌંસમાં પાનાનો નંબર લખો, દા.ત. (પાનું 12).
3. બુકમાં ન હોય તે ધારી ન લો — લખો "બુકમાં મળી નથી".
4. એકથી વધુ સમકક્ષ હોય તો બધી ટૂંકમાં બતાવો.

ફોર્મેટ:
### ગ્રાહકની પ્રોડક્ટ (ફોટા પરથી)
- **બ્રાન્ડ:** …
- **ટેકનિકલ:** … (ટકાવારી + ફોર્મ્યુલેશન સાથે)
- **કંપની:** …
- **પૅક:** …

### આપણી સમકક્ષ પ્રોડક્ટ
- **બ્રાન્ડ:** … (પાનું N)
- **ટેકનિકલ:** … (પાનું N)
- **પૅક:** … (પાનું N)
- **MRP:** … (પાનું N)
- **મેચ:** સંપૂર્ણ મેચ / આંશિક મેચ / મળી નથી — કારણ સાથે

### બીજા વિકલ્પો
આપેલાં પાનાંમાંથી બીજી મળતી આવતી પ્રોડક્ટ ક્રમમાં બતાવો (વધુમાં વધુ ૩):

1. **બ્રાન્ડ** — ટેકનિકલ — પૅક — MRP (પાનું N) — મેચ: સંપૂર્ણ/આંશિક/સમાન કામ
2. …

ક્રમ આ રીતે રાખો: પહેલાં સરખું ટેકનિકલ, પછી સરખી ટકાવારી, પછી એક જ
કૅટેગરી (દા.ત. બંને Insecticide) ની પ્રોડક્ટ.
"સમાન કામ" એટલે ટેકનિકલ જુદું પણ કામ એક જ — તેમાં સ્પષ્ટ લખો કે ટેકનિકલ
જુદું છે. બુકમાં કશું મળતું ન આવે તો "બીજો વિકલ્પ નથી" લખો.
ક્યારેય એવી પ્રોડક્ટ ન બતાવો જે આપેલાં પાનાંમાં નથી.`;

async function callVision({ messages, signal, attempt = 0, onRetry }) {
    /* Proxy mode keeps the key server-side; otherwise call Gemini directly. */
    if (CONFIG.proxyUrl) return callProxy({ messages, signal });

    if (!state.apiKey) throw new Error('API કી સેટ થયેલી નથી.');

    let r;
    try {
        r = await fetch(GEMINI_URL(CONFIG.model || 'gemini-3.5-flash-lite'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': state.apiKey,
            },
            signal,
            body: JSON.stringify(toGemini(messages)),
        });
    } catch {
        throw new Error('ઇન્ટરનેટ સાથે જોડાણ થયું નહીં.');
    }

    if (!r.ok) {
        let detail = '';
        try { detail = (await r.json())?.error?.message || ''; } catch { }
        if (r.status === 400 && /API key/i.test(detail)) throw new Error('API કી ખોટી છે.');
        if (r.status === 403) throw new Error('આ કીને પરવાનગી નથી.');
        if (r.status === 429) {
            const perDay = /per day|daily|PerDay/i.test(detail);

            /* A per-minute burst clears on its own (15 RPM on Flash-Lite), so
               wait out the hint and try once more rather than failing. The
               daily cap does not clear, so that one goes straight to the user. */
            if (!perDay && attempt === 0) {
                const hint = parseInt((detail.match(/(\d+)\s*s(?:econds)?/i) || [])[1] || '0', 10);
                const wait = Math.min(Math.max(hint, 5), 30);
                onRetry?.(wait);
                await new Promise((res) => setTimeout(res, wait * 1000));
                return callVision({ messages, signal, attempt: 1, onRetry });
            }

            throw new Error(perDay
                ? 'આજની મફત મર્યાદા પૂરી થઈ. કાલે ફરી પ્રયત્ન કરો, અથવા સેટિંગમાં પોતાની API કી ઉમેરો.'
                : 'મર્યાદા પૂરી થઈ. થોડી વાર પછી પ્રયત્ન કરો.');
        }

        /* Google retires model IDs; the 404 names the replacement. Surface it
           plainly so the fix is obvious. */
        if (r.status === 404 && /model/i.test(detail)) {
            const next = (detail.match(/models\/([\w.-]+)/g) || [])
                .map((m) => m.replace('models/', ''))
                .find((m) => m !== (CONFIG.model || ''));
            throw new Error(next
                ? `આ મોડેલ બંધ થઈ ગયું છે. config.js માં model: '${next}' કરો.`
                : 'આ મોડેલ હવે ઉપલબ્ધ નથી. config.js માં મોડેલ બદલો.');
        }

        throw new Error(`સર્વર ભૂલ (${r.status}). ${clip(detail, 120)}`);
    }

    const j = await r.json();
    const cand = j.candidates?.[0];
    const text = cand?.content?.parts?.map((x) => x.text).filter(Boolean).join('');

    if (!text) {
        if (cand?.finishReason === 'SAFETY') throw new Error('જવાબ અટકાવાયો.');
        throw new Error('જવાબ ખાલી આવ્યો.');
    }
    return cand.finishReason === 'MAX_TOKENS' ? `${text}\n\n_(જવાબ અધૂરો છે.)_` : text;
}

/* Talk to the Worker. The key lives there, never here. */
async function callProxy({ messages, signal }) {
    let r;
    try {
        r = await fetch(CONFIG.proxyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal,
            body: JSON.stringify(toGemini(messages)),
        });
    } catch {
        throw new Error('સર્વર સાથે જોડાણ થયું નહીં. ઇન્ટરનેટ તપાસો.');
    }

    if (!r.ok) {
        let msg = '';
        try { msg = (await r.json()).error || ''; } catch { }
        if (r.status === 429) throw new Error(msg || 'મર્યાદા પૂરી થઈ. થોડી વાર પછી પ્રયત્ન કરો.');
        throw new Error(msg || `સર્વર ભૂલ (${r.status}).`);
    }

    const j = await r.json();
    const text = j.candidates?.[0]?.content?.parts
        ?.map((x) => x.text).filter(Boolean).join('');
    if (!text) throw new Error('જવાબ ખાલી આવ્યો.');
    return text;
}

/* OpenAI-style messages → Gemini's contents/systemInstruction shape. */
function toGemini(messages) {
    const sys = messages.filter((m) => m.role === 'system')
        .map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n\n');

    const contents = messages.filter((m) => m.role !== 'system').map((m) => {
        const parts = [];
        if (typeof m.content === 'string') {
            parts.push({ text: m.content });
        } else {
            for (const c of m.content) {
                if (c.type === 'text') parts.push({ text: c.text });
                else if (c.type === 'image_url') {
                    const [meta, b64] = c.image_url.url.split(',');
                    parts.push({
                        inlineData: {
                            mimeType: (meta.match(/data:([^;]+)/) || [, 'image/jpeg'])[1],
                            data: b64,
                        },
                    });
                }
            }
        }
        return { role: m.role === 'assistant' ? 'model' : 'user', parts };
    });

    return {
        contents,
        ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}),
        generationConfig: {
            temperature: 0.2,
            /* Gemini 3.x spends part of this budget on internal reasoning
               (~700 tokens here), so leave room or the answer gets cut off
               mid-sentence with finishReason MAX_TOKENS. */
            maxOutputTokens: 3000,
        },
    };
}

function imgPart(img) {
    return { type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.b64}` } };
}

/* A data URL that is already complete (rendered PDF page). */
function imgPartRaw(dataUrl) {
    return { type: 'image_url', image_url: { url: dataUrl } };
}

/* ---------------------------------------------------------------
   Scan flow
---------------------------------------------------------------- */
async function runScan() {
    if (!state.front && !state.back) return toast('ઓછામાં ઓછો એક ફોટો જોઈએ.');
    if (!canScan()) return toast('ફોટો ઓળખવાની સુવિધા હાલ બંધ છે.');

    const btn = $('scanBtn');
    btn.disabled = true;
    btn.classList.add('busy');
    $('scanLabel').innerHTML = '<span class="spin"></span>તપાસી રહ્યું છે…';

    $('resultCard').hidden = false;
    $('resultBody').innerHTML =
        '<div class="skeleton"></div><div class="skeleton w70"></div><div class="skeleton w45"></div>';
    $('sources').hidden = true;
    $('resultCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    try {
        let labelText;

        const bigBook = (state.source?.pages?.length || 0) > 12;

        if (CONFIG.singlePass && !bigBook) {
            /* Small book: send it whole in one call and let the model match.
               Halves quota use per scan. */
            labelText = '';
        } else {
            /* Pass 1 — read the labels so we know what to look up. */
            const parts = [{
                type: 'text',
                text: 'આ પ્રોડક્ટના ફોટામાંથી લખો: ૧) બ્રાન્ડ નામ ૨) ટેકનિકલ/સક્રિય ઘટકનું '
                    + 'નામ, તેની ટકાવારી અને ફોર્મ્યુલેશન કોડ (EC/SC/WP/WG/SL વગેરે) ૩) કંપની '
                    + '૪) પૅક સાઇઝ ૫) MRP. ફક્ત વાંચેલું લખાણ આપો.',
            }];
            if (state.front) parts.push(imgPart(state.front));
            if (state.back) parts.push(imgPart(state.back));

            labelText = await callVision({
                messages: [{ role: 'user', content: parts }],
            });
        }

        /* Answer, grounded in the matching PDF pages. Without a first pass we
           have no search terms, so widen the slice and let the model find the
           product itself. */
        /* With label text we search the index and send only what matches —
           this is what keeps a 150-page book cheap. Without it (small book,
           single pass) we send the book itself. */
        let pages = labelText
            ? relevantPages(state.source, labelText)
            : bookSlice(state.source);

        /* Add same-category products so the dealer always has something to
           offer, even when no product shares the exact technical. */
        if (labelText) {
            const also = similarPages(state.source, labelText,
                pages.map((p) => p.page));
            if (also.length) pages = [...pages, ...also].sort((a, b) => a.page - b.page);
        }
        const bookImages = pageImages(pages);
        const parts2 = [{
            type: 'text',
            text: `USP બુકના સંબંધિત પાનાં:\n\n${sourceBlock(pages)}\n\n`
                + (labelText
                    ? `ફોટામાંથી વાંચેલું લખાણ:\n${labelText}\n\n`
                    : `ફોટામાં દેખાતું લખાણ જાતે વાંચો અને ઉપરનાં પાનાં સાથે મેળવો.\n\n`)
                + (bookImages.length
                    ? `નીચે પહેલાં પ્રોડક્ટના ફોટા છે, પછી બુકનાં પાનાંનાં ચિત્રો `
                      + `(પાનું ${bookImages.map((p) => p.page).join(', ')}).\n\n`
                    : '')
                + `હવે ઉપરના ફોર્મેટમાં પ્રોડક્ટ ઓળખો.`,
        }];
        if (state.front) parts2.push(imgPart(state.front));
        if (state.back) parts2.push(imgPart(state.back));
        /* Scanned book pages travel as pictures the model can read. */
        for (const bp of bookImages) parts2.push(imgPartRaw(bp.image));

        const answer = await callVision({
            messages: [
                { role: 'system', content: SYSTEM },
                { role: 'user', content: parts2 },
            ],
            onRetry: (secs) => {
                $('scanLabel').innerHTML =
                    `<span class="spin"></span>મર્યાદા — ${secs}s રાહ જુઓ…`;
            },
        });

        showResult(answer, pages);
        await saveHistory(answer, pages, labelText);

        state.chat = [{
            role: 'system',
            content: `${SYSTEM}\n\nસંદર્ભ પાનાં:\n${sourceBlock(pages)}\n\nફોટાનું લખાણ:\n${labelText}`,
        }, { role: 'assistant', content: answer }];
        $('chatCard').hidden = false;
    } catch (e) {
        $('resultBody').innerHTML = `<p style="color:var(--err)">${esc(e.message)}</p>`;
    } finally {
        btn.disabled = false;
        btn.classList.remove('busy');
        $('scanLabel').textContent = 'ઓળખો';
    }
}

function showResult(text, pages) {
    state.lastResult = text;
    $('resultCard').hidden = false;
    $('resultBody').innerHTML = mdToHtml(text);

    const cited = new Set((text.match(/પાનું\s*(\d+)/g) || [])
        .map((m) => parseInt(m.replace(/\D/g, ''), 10)));
    const show = pages.filter((p) => cited.has(p.page));
    const list = show.length ? show : pages.slice(0, 6);

    if (list.length) {
        $('sourceList').innerHTML = list.map((p) => p.text
            ? `<div class="src"><b>પાનું ${p.page}</b><br>${esc(clip(p.text, 240))}</div>`
            : `<div class="src"><b>પાનું ${p.page}</b>` +
              (p.image ? `<img class="src-img" src="${p.image}" alt="પાનું ${p.page}" loading="lazy">` : '') +
              `</div>`).join('');
        $('sources').hidden = false;
    }
}

/* ---------------------------------------------------------------
   Chat over the same source
---------------------------------------------------------------- */
async function sendChat(e) {
    e.preventDefault();
    const q = $('chatInput').value.trim();
    if (!q && !state.chatImage) return;

    const img = state.chatImage;
    addMsg('me', q, img?.dataUrl);
    $('chatInput').value = '';
    clearChatImage();

    const content = [];
    if (q) content.push({ type: 'text', text: q });
    if (img) content.push(imgPart(img));
    state.chat.push({ role: 'user', content: content.length > 1 || img ? content : q });

    const bubble = addMsg('ai', '…');
    try {
        const extra = relevantPages(state.source, q, 16);
        const msgs = [...state.chat];
        if (extra.length) {
            const pics = pageImages(extra, 4);
            if (pics.length) {
                /* Scanned pages have to be seen, so send them as content. */
                msgs.splice(1, 0, {
                    role: 'user',
                    content: [
                        { type: 'text', text: `સંબંધિત પાનાં:\n${sourceBlock(extra)}` },
                        ...pics.map((p) => imgPartRaw(p.image)),
                    ],
                });
            } else {
                msgs.splice(1, 0, {
                    role: 'system',
                    content: `આ પ્રશ્ન માટે સંબંધિત પાનાં:\n${sourceBlock(extra)}`,
                });
            }
        }
        const reply = await callVision({ messages: msgs });
        bubble.innerHTML = mdToHtml(reply);
        state.chat.push({ role: 'assistant', content: reply });
    } catch (err) {
        bubble.innerHTML = `<p style="color:var(--err)">${esc(err.message)}</p>`;
    }
    $('chatLog').scrollTop = $('chatLog').scrollHeight;
}

function addMsg(who, text, imgUrl) {
    const d = document.createElement('div');
    d.className = `msg ${who}`;
    d.innerHTML = (imgUrl ? `<img src="${imgUrl}" alt="">` : '') +
        (text ? (who === 'me' ? `<p>${esc(text)}</p>` : mdToHtml(text)) : '');
    $('chatLog').append(d);
    $('chatLog').scrollTop = $('chatLog').scrollHeight;
    return d;
}

function clearChatImage() {
    state.chatImage = null;
    $('chatAttach').hidden = true;
    $('chatImage').value = '';
}

/* ---------------------------------------------------------------
   History
---------------------------------------------------------------- */
async function saveHistory(answer, pages, labelText) {
    const name = (answer.match(/\*\*પ્રોડક્ટ:\*\*\s*(.+)/) || [])[1]?.trim()
        || labelText.split('\n')[0].slice(0, 40) || 'અજાણી પ્રોડક્ટ';
    await put('history', {
        id: crypto.randomUUID(),
        at: Date.now(),
        name: name.replace(/[*_`]/g, ''),
        answer,
        pages: pages.map((p) => ({ page: p.page, text: clip(p.text || '', 400) })),
        thumb: state.front?.dataUrl || state.back?.dataUrl || '',
    });
}

async function renderHistory() {
    const items = await allHistory();
    const box = $('historyList');
    if (!items.length) {
        box.innerHTML = '<p class="empty">હજી કોઈ સ્કેન નથી.</p>';
        return;
    }
    box.innerHTML = '';
    for (const it of items) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'hist';
        b.innerHTML =
            (it.thumb ? `<img src="${it.thumb}" alt="">` : '') +
            `<span class="hist-txt"><span class="hist-name">${esc(it.name)}</span>` +
            `<span class="hist-date">${new Date(it.at).toLocaleString('gu-IN')}</span></span>`;
        b.addEventListener('click', () => {
            showResult(it.answer, it.pages || []);
            $('historyDlg').close();
            $('resultCard').scrollIntoView({ behavior: 'smooth' });
        });
        box.append(b);
    }
}

/* ---------------------------------------------------------------
   Settings + setup state
---------------------------------------------------------------- */
function openSettings() {
    if (CONFIG.allowUserKey) $('apiKey').value = state.apiKey;
    syncKeyUi();
    $('settingsDlg').showModal();
}

function syncKeyUi() {
    $('keyField').hidden = !CONFIG.allowUserKey;
    const note = $('modelNote');
    if (!note) return;
    note.textContent = CONFIG.proxyUrl
        ? 'સર્વર દ્વારા ચાલે છે — કોઈ કી જરૂરી નથી.'
        : state.apiKey
            ? 'Google Gemini વપરાય છે.'
            : 'API કી સેટ થયેલી નથી.';
}

/* Photo identification needs the hosted model. */
const canScan = () => !!CONFIG.proxyUrl || !!state.apiKey;

function refreshSetup() {
    const needKey = !canScan();
    const hasPdf = !!state.source?.pages?.length;

    $('stepKey').hidden = !CONFIG.allowUserKey;
    $('stepKey').classList.toggle('done', !needKey);
    $('stepPdf').classList.toggle('done', hasPdf);
    $('setupBanner').hidden = !needKey && hasPdf;

    if (hasPdf) {
        $('pdfStatus').hidden = false;
        const sc = state.source.scanned || 0;
        $('pdfName').textContent = `${state.source.name} — ${state.source.pages.length} પાનાં`
            + (sc ? ` (${sc} ચિત્ર)` : '');
        $('pdfZoneText').textContent = 'બીજી PDF પસંદ કરો';
    } else {
        $('pdfStatus').hidden = true;
        $('pdfZoneText').textContent = 'PDF પસંદ કરો';
    }

    $('scanBtn').disabled = !(state.front || state.back) || !canScan();

    /* Text Q&A works without a scan (and without a key, via the on-device
       model), so open the chat as soon as there is a source to answer from. */
    if (hasPdf && $('chatCard').hidden) {
        $('chatCard').hidden = false;
        if (!state.chat.length) {
            state.chat = [{
                role: 'system',
                content: `${SYSTEM}\n\nસ્રોત: ${state.source.name}`,
            }];
        }
    }
    $('scanHint').textContent = !canScan()
        ? 'ફોટો ઓળખવાની સુવિધા હાલ બંધ છે — નીચે લખીને પ્રશ્ન પૂછો.'
        : hasPdf
            ? 'બંને બાજુના ફોટા આપવાથી પરિણામ વધુ સચોટ મળે છે.'
            : 'USP PDF ઉમેરશો તો જવાબ બુક પ્રમાણે મળશે.';
}

function setShot(which, img) {
    state[which] = img;
    const slot = $(which === 'front' ? 'frontSlot' : 'backSlot');
    slot.classList.add('filled');
    slot.innerHTML = `<img src="${img.dataUrl}" alt="">` +
        `<span class="badge">${which === 'front' ? 'આગળ' : 'પાછળ'}</span>`;
    refreshSetup();
}

/* ---------------------------------------------------------------
   Boot
---------------------------------------------------------------- */
async function boot() {
    /* Ask the browser not to evict the saved PDF. */
    try { await navigator.storage?.persist?.(); } catch { }

    const meta = (await get('meta', 'settings')) || {};
    /* A key the user saved wins over the one baked into the build. */
    state.apiKey = (CONFIG.allowUserKey && meta.apiKey) || CONFIG.apiKey || '';
    state.source = (await get('source', 'default')) || null;

    /* Theme */
    const applyIcon = () => {
        const dark = document.documentElement.getAttribute('data-theme') === 'dark' ||
            (!document.documentElement.getAttribute('data-theme') &&
                matchMedia('(prefers-color-scheme: dark)').matches);
        $('themeIcon').textContent = dark ? '○' : '●';
    };
    applyIcon();
    $('themeBtn').addEventListener('click', () => {
        const cur = document.documentElement.getAttribute('data-theme') ||
            (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        const next = cur === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem('theme', next); } catch { }
        applyIcon();
    });

    /* Capture — camera or gallery, plus drag-drop and paste on desktop. */
    for (const [id, side] of [['frontInput', 'front'], ['frontPick', 'front'],
                              ['backInput', 'back'], ['backPick', 'back']]) {
        $(id).addEventListener('change', async (e) => {
            if (e.target.files[0]) setShot(side, await readImage(e.target.files[0]));
            e.target.value = '';   // allow re-picking the same file
        });
    }

    /* The slot buttons open whichever input they name. */
    for (const btn of document.querySelectorAll('.shot-act')) {
        btn.addEventListener('click', () => $(btn.dataset.open).click());
    }

    /* Tapping the picture itself opens the gallery. */
    $('frontSlot').addEventListener('click', () => $('frontPick').click());
    $('backSlot').addEventListener('click', () => $('backPick').click());

    /* Drop an image straight onto a slot. */
    for (const [slotId, side] of [['frontSlot', 'front'], ['backSlot', 'back']]) {
        const slot = $(slotId);
        ['dragenter', 'dragover'].forEach((ev) => slot.addEventListener(ev, (e) => {
            e.preventDefault(); slot.classList.add('drag');
        }));
        ['dragleave', 'drop'].forEach((ev) => slot.addEventListener(ev, (e) => {
            e.preventDefault(); slot.classList.remove('drag');
        }));
        slot.addEventListener('drop', async (e) => {
            const f = e.dataTransfer.files[0];
            if (f?.type.startsWith('image/')) setShot(side, await readImage(f));
        });
    }

    /* Paste an image: fills the front slot, then the back. */
    addEventListener('paste', async (e) => {
        const item = [...(e.clipboardData?.items || [])]
            .find((i) => i.type.startsWith('image/'));
        if (!item) return;
        const f = item.getAsFile();
        if (f) setShot(state.front ? 'back' : 'front', await readImage(f));
    });
    $('scanBtn').addEventListener('click', runScan);

    /* Settings */
    $('settingsBtn').addEventListener('click', openSettings);
    $('openSetup').addEventListener('click', openSettings);
    /* Apply a typed key immediately: uploading a scanned PDF in the same
       dialog needs it before Save is pressed. */
    $('apiKey').addEventListener('input', (e) => {
        if (CONFIG.allowUserKey) {
            state.apiKey = e.target.value.trim() || CONFIG.apiKey || '';
            refreshSetup();
            syncKeyUi();
        }
    });

    $('keyReveal').addEventListener('click', () => {
        const f = $('apiKey');
        f.type = f.type === 'password' ? 'text' : 'password';
    });
    $('saveSettings').addEventListener('click', async () => {
        if (CONFIG.allowUserKey) {
            const typed = $('apiKey').value.trim();
            state.apiKey = typed || CONFIG.apiKey || '';
            await put('meta', { apiKey: typed }, 'settings');
        }
        syncKeyUi();
        refreshSetup();
        $('settingsDlg').close();
        toast('સચવાઈ ગયું.');
    });

    /* PDF — indexed once, reused on every launch. */
    const takePdf = async (file) => {
        if (!file || file.type !== 'application/pdf') return toast('PDF ફાઇલ પસંદ કરો.');
        const bar = $('pdfProgress');
        bar.hidden = false; bar.value = 0;
        $('pdfZoneText').textContent = 'વાંચી રહ્યું છે…';
        try {
            const src = await indexPdf(file, (p) => { bar.value = p; });
            if (!src.pages.length) throw new Error('આ PDF વાંચી શકાઈ નહીં.');

            /* Scanned pages carry no text, so searching them locally is
               impossible. Offer to read them once now — costs one request per
               page, and makes every later scan cheap and accurate. */
            const unread = src.pages.filter((p) => p.image && !p.text).length;
            if (unread && canScan()) {
                const go = confirm(
                    `આ PDF માં ${unread} પાનાં ચિત્ર સ્વરૂપે છે.\n\n` +
                    `તેમને એક વાર વાંચી લઈએ? (લગભગ ${unread} વિનંતી વપરાશે)\n` +
                    `પછી દરેક સ્કેન ઝડપી અને સચોટ થશે.\n\n` +
                    `ના પાડશો તો પણ ચાલશે, પણ મોટી બુકમાં પ્રોડક્ટ ન પણ મળે.`);
                if (go) {
                    $('pdfZoneText').textContent = 'પાનાં વાંચી રહ્યું છે…';
                    bar.value = 0;
                    const read = await ocrPages(src.pages, (d, t) => {
                        bar.value = Math.round((d / t) * 100);
                        $('pdfZoneText').textContent = `પાનાં વાંચી રહ્યું છે… ${d}/${t}`;
                    });
                    src.index = buildIndex(src.pages);
                    src.terms = Object.keys(src.index).length;
                    src.ocrPages = read;
                }
            }

            state.source = src;
            await put('source', src, 'default');
            toast(src.ocrPages
                ? `${src.pages.length} પાનાં સચવાયાં (${src.ocrPages} વાંચ્યાં).`
                : src.scanned
                    ? `${src.pages.length} પાનાં સચવાયાં (${src.scanned} ચિત્ર).`
                    : `${src.pages.length} પાનાં સચવાયાં.`);
        } catch (err) {
            toast(err.message);
        } finally {
            bar.hidden = true;
            refreshSetup();
        }
    };

    $('pdfInput').addEventListener('change', (e) => takePdf(e.target.files[0]));
    $('pdfRemove').addEventListener('click', async () => {
        state.source = null;
        await del('source', 'default');
        refreshSetup();
        toast('PDF કાઢી નાખી.');
    });

    const zone = $('pdfZone');
    ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => {
        e.preventDefault(); zone.classList.add('drag');
    }));
    ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => {
        e.preventDefault(); zone.classList.remove('drag');
    }));
    zone.addEventListener('drop', (e) => takePdf(e.dataTransfer.files[0]));

    /* History */
    $('historyBtn').addEventListener('click', async () => {
        await renderHistory();
        $('historyDlg').showModal();
    });
    $('clearHistory').addEventListener('click', async () => {
        await clearStore('history');
        await renderHistory();
        toast('ઇતિહાસ ખાલી કર્યો.');
    });

    /* Chat */
    $('chatForm').addEventListener('submit', sendChat);
    $('chatImage').addEventListener('change', async (e) => {
        if (!e.target.files[0]) return;
        state.chatImage = await readImage(e.target.files[0], 1024);
        $('chatAttachImg').src = state.chatImage.dataUrl;
        $('chatAttach').hidden = false;
    });
    $('chatAttachClear').addEventListener('click', clearChatImage);

    /* Copy */
    $('copyBtn').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(state.lastResult || '');
            toast('નકલ થઈ ગઈ.');
        } catch { toast('નકલ ન થઈ.'); }
    });

    refreshSetup();
}

boot();

/* Register the offline shell (build strips this when not on https). */
if ('serviceWorker' in navigator && location.protocol === 'https:') {
    addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => { }));
}
