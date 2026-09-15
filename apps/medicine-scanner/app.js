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

    return { name: file.name, pages, addedAt: Date.now(), scanned };
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

/* Pick the pages most likely to contain the product, so we send a
   focused slice of the book instead of the whole thing. */
function relevantPages(source, terms, limit = 6) {
    if (!source?.pages?.length) return [];

    const textPages = source.pages.filter((p) => p.text);
    const imagePages = source.pages.filter((p) => p.image);
    const toks = terms.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];

    /* No usable text anywhere (a fully scanned book): send page pictures. */
    if (!textPages.length) return imagePages.slice(0, Math.min(limit, 4));

    if (!toks.length) return source.pages.slice(0, limit);

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
    const out = (hit.length ? hit : scored).slice(0, limit);

    /* Text search found nothing — the answer may be on a scanned page, so
       include a few page images for the model to look at. */
    if (!hit.length && imagePages.length) {
        out.push(...imagePages.slice(0, 3));
    }
    return out;
}

/* Page images to attach to a request, capped to keep the payload sane. */
const pageImages = (pages, max = 3) =>
    pages.filter((p) => p.image).slice(0, max);

const clip = (t, n = 2600) => (t.length > n ? t.slice(0, n) + '…' : t);

function sourceBlock(pages) {
    if (!pages.length) return '(કોઈ સ્રોત નથી)';
    return pages.map((p) => p.text
        ? `[પાનું ${p.page}]\n${clip(p.text)}`
        : `[પાનું ${p.page}] — આ પાનું ચિત્ર તરીકે જોડેલું છે, તેને વાંચો.`
    ).join('\n\n---\n\n');
}

/* ---------------------------------------------------------------
   Model calls
---------------------------------------------------------------- */
const SYSTEM = `તમે એક અનુભવી ફાર્મા પ્રોડક્ટ સહાયક છો.
તમને USP પ્રોડક્ટ બુકના અમુક પાનાં અને પ્રોડક્ટના ફોટા આપવામાં આવે છે.

નિયમો:
1. જવાબ ફક્ત અને ફક્ત ગુજરાતીમાં આપો.
2. ફોટામાં દેખાતું નામ, સોલ્ટ, કંપની, બેચ, MRP વાંચો.
3. આપેલા પાનાં સાથે મેળવીને પ્રોડક્ટ ઓળખો.
4. જે માહિતી પાનાંમાં ન હોય તે ધારી ન લો — સ્પષ્ટ લખો કે "બુકમાં મળી નથી".
5. દરેક દાવા પછી કૌંસમાં પાનાનો નંબર લખો, દા.ત. (પાનું 12).
6. કોઈ તબીબી સલાહ ન આપો — ફક્ત બુકમાં જે છે તે માહિતી આપો.

ફોર્મેટ:
### ઓળખ
- **પ્રોડક્ટ:** …
- **સોલ્ટ:** …
- **કંપની:** …
- **પેક:** …
- **MRP:** …

### બુક પ્રમાણે વિગત
(ટૂંકમાં, દરેક મુદ્દા સાથે પાનાનો નંબર)

### ખાતરી
મળેલી ખાતરી: ઊંચી / મધ્યમ / ઓછી — કારણ સાથે.`;

async function callVision({ messages, signal }) {
    /* Proxy mode keeps the key server-side; otherwise call Gemini directly. */
    if (CONFIG.proxyUrl) return callProxy({ messages, signal });

    if (!state.apiKey) throw new Error('API કી સેટ થયેલી નથી.');

    let r;
    try {
        r = await fetch(GEMINI_URL(CONFIG.model || 'gemini-2.0-flash'), {
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
        if (r.status === 429) throw new Error('મફત મર્યાદા પૂરી થઈ. થોડી વાર પછી પ્રયત્ન કરો.');
        throw new Error(`સર્વર ભૂલ (${r.status}). ${clip(detail, 120)}`);
    }

    const j = await r.json();
    const text = j.candidates?.[0]?.content?.parts
        ?.map((x) => x.text).filter(Boolean).join('');
    if (!text) throw new Error('જવાબ ખાલી આવ્યો.');
    return text;
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
        generationConfig: { temperature: 0.2, maxOutputTokens: 1400 },
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
        /* Pass 1 — read the labels so we know what to look up. */
        const parts = [{
            type: 'text',
            text: 'આ ફોટામાં દેખાતું બધું લખાણ જેમનું તેમ લખો (બ્રાન્ડ નામ, સોલ્ટ, કંપની, પેક, MRP). ફક્ત લખાણ, બીજું કંઈ નહીં.',
        }];
        if (state.front) parts.push(imgPart(state.front));
        if (state.back) parts.push(imgPart(state.back));

        const labelText = await callVision({
            messages: [{ role: 'user', content: parts }],
        });

        /* Pass 2 — answer, grounded in the matching PDF pages. */
        const pages = relevantPages(state.source, labelText);
        const bookImages = pageImages(pages);
        const parts2 = [{
            type: 'text',
            text: `USP બુકના સંબંધિત પાનાં:\n\n${sourceBlock(pages)}\n\n`
                + `ફોટામાંથી વાંચેલું લખાણ:\n${labelText}\n\n`
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
    const list = show.length ? show : pages.slice(0, 3);

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
        const extra = relevantPages(state.source, q, 4);
        const msgs = [...state.chat];
        if (extra.length) {
            const pics = pageImages(extra, 2);
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

    /* Capture */
    $('frontInput').addEventListener('change', async (e) => {
        if (e.target.files[0]) setShot('front', await readImage(e.target.files[0]));
    });
    $('backInput').addEventListener('change', async (e) => {
        if (e.target.files[0]) setShot('back', await readImage(e.target.files[0]));
    });
    $('scanBtn').addEventListener('click', runScan);

    /* Settings */
    $('settingsBtn').addEventListener('click', openSettings);
    $('openSetup').addEventListener('click', openSettings);
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
            state.source = src;
            await put('source', src, 'default');
            toast(src.scanned
                ? `${src.pages.length} પાનાં સચવાયાં (${src.scanned} સ્કેન કરેલાં).`
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
