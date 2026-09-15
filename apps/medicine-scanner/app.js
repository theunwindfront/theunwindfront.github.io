/* ઔષધિ (Aushadhi) — USP product identification, Gujarati output.
   Everything (key, PDF, history) stays on the device. */

import { CONFIG } from './config.js';

const $ = (id) => document.getElementById(id);

/* ---------------------------------------------------------------
   IndexedDB — the "memory" the app finds on every launch.
   Stores: meta (key/provider), source (the default USP PDF), history.
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
    provider: CONFIG.preferBuiltinForText ? 'builtin' : (CONFIG.provider || 'gemini'),
    apiKey: CONFIG.apiKey || '',
    source: null,     // { name, pages:[{page, text}], addedAt }
    front: null,      // { dataUrl, mime, b64 }
    back: null,
    lastResult: null,
    chat: [],
    chatImage: null,
};

const PROVIDERS = {
    gemini: {
        label: 'Google Gemini',
        url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
        model: 'gemini-2.0-flash',
        keyUrl: 'https://aistudio.google.com/apikey',
        note: 'aistudio.google.com/apikey પરથી મફત કી મેળવો.',
        vision: true,
        shape: 'gemini',
    },
    groq: {
        label: 'Groq',
        url: 'https://api.groq.com/openai/v1/chat/completions',
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        keyUrl: 'https://console.groq.com/keys',
        note: 'console.groq.com/keys પરથી મફત કી મેળવો.',
        vision: true,
        shape: 'openai',
    },
    openrouter: {
        label: 'OpenRouter',
        url: 'https://openrouter.ai/api/v1/chat/completions',
        model: 'meta-llama/llama-4-scout:free',
        keyUrl: 'https://openrouter.ai/keys',
        note: 'openrouter.ai/keys પરથી મફત કી મેળવો.',
        vision: true,
        shape: 'openai',
    },
    builtin: {
        label: 'Chrome બિલ્ટ-ઇન',
        note: 'Chrome 138+ માં કી વગર ચાલે છે. ફોટો વાંચી શકતું નથી — ફક્ત લખેલા પ્રશ્ન માટે.',
        vision: false,
    },
};

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
async function indexPdf(file, onProgress) {
    const pdfjsLib = window.pdfjsLib ||
        await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';

    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent();
        const text = tc.items.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim();
        if (text) pages.push({ page: i, text });
        onProgress?.(Math.round((i / pdf.numPages) * 100));
    }
    return { name: file.name, pages, addedAt: Date.now() };
}

/* Pick the pages most likely to contain the product, so we send a
   focused slice of the book instead of the whole thing. */
function relevantPages(source, terms, limit = 6) {
    if (!source?.pages?.length) return [];
    const toks = terms.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];
    if (!toks.length) return source.pages.slice(0, limit);
    const scored = source.pages.map((p) => {
        const lower = p.text.toLowerCase();
        let score = 0;
        for (const t of new Set(toks)) {
            const hits = lower.split(t).length - 1;
            if (hits) score += hits + t.length / 4;
        }
        return { ...p, score };
    });
    const hit = scored.filter((p) => p.score > 0).sort((a, b) => b.score - a.score);
    return (hit.length ? hit : scored).slice(0, limit);
}

const clip = (t, n = 2600) => (t.length > n ? t.slice(0, n) + '…' : t);

function sourceBlock(pages) {
    if (!pages.length) return '(કોઈ સ્રોત નથી)';
    return pages.map((p) => `[પાનું ${p.page}]\n${clip(p.text)}`).join('\n\n---\n\n');
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

/* Does this turn carry an image? */
function hasImage(messages) {
    return messages.some((m) => Array.isArray(m.content) &&
        m.content.some((c) => c.type === 'image_url'));
}

async function callVision({ messages, signal }) {
    const needsEyes = hasImage(messages);

    /* Text-only: use Chrome's on-device model when it is available — free,
       private, no key. Fall through to the hosted model if it is not. */
    if (!needsEyes && (state.provider === 'builtin' || CONFIG.preferBuiltinForText)) {
        try {
            return await callBuiltin(messages);
        } catch (e) {
            if (!state.apiKey) throw e;
        }
    }

    /* Images need a hosted vision model. */
    const visionProvider = state.provider === 'builtin'
        ? (CONFIG.provider || 'gemini')
        : state.provider;
    const p = PROVIDERS[visionProvider];

    if (!state.apiKey) {
        throw new Error(needsEyes
            ? 'ફોટો ઓળખવાની સુવિધા હાલ બંધ છે. લખીને પ્રશ્ન પૂછો.'
            : 'AI ઉપલબ્ધ નથી.');
    }

    const headers = { 'Content-Type': 'application/json' };
    let url = p.url;
    let body;

    if (p.shape === 'gemini') {
        headers['x-goog-api-key'] = state.apiKey;
        body = toGemini(messages);
    } else {
        headers.Authorization = `Bearer ${state.apiKey}`;
        if (visionProvider === 'openrouter') {
            headers['HTTP-Referer'] = location.origin;
            headers['X-Title'] = 'Aushadhi';
        }
        body = { model: p.model, messages, temperature: 0.2, max_tokens: 1400 };
    }

    const r = await fetch(url, {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify(body),
    });

    if (!r.ok) {
        const body = await r.text().catch(() => '');
        if (r.status === 401) throw new Error('API કી ખોટી છે — સેટિંગમાં તપાસો.');
        if (r.status === 429) throw new Error('મફત મર્યાદા પૂરી થઈ. થોડી વાર પછી પ્રયત્ન કરો.');
        throw new Error(`સર્વર ભૂલ (${r.status}). ${clip(body, 120)}`);
    }

    const j = await r.json();
    const text = p.shape === 'gemini'
        ? j.candidates?.[0]?.content?.parts?.map((x) => x.text).filter(Boolean).join('')
        : j.choices?.[0]?.message?.content;
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

/* Chrome's on-device model: no key, but text only. */
async function callBuiltin(messages) {
    if (!('LanguageModel' in self)) {
        throw new Error('આ બ્રાઉઝરમાં બિલ્ટ-ઇન AI નથી (Chrome 138+ જોઈએ).');
    }
    const avail = await LanguageModel.availability();
    if (avail === 'unavailable') throw new Error('બિલ્ટ-ઇન AI ઉપલબ્ધ નથી.');

    const sys = messages.find((m) => m.role === 'system')?.content || '';
    const user = messages.filter((m) => m.role !== 'system').map((m) =>
        typeof m.content === 'string'
            ? m.content
            : m.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')
    ).join('\n\n');

    const session = await LanguageModel.create({
        initialPrompts: [{ role: 'system', content: sys }],
    });
    try {
        return await session.prompt(user);
    } finally {
        session.destroy();
    }
}

function imgPart(img) {
    return { type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.b64}` } };
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
        const parts2 = [{
            type: 'text',
            text: `USP બુકના સંબંધિત પાનાં:\n\n${sourceBlock(pages)}\n\n`
                + `ફોટામાંથી વાંચેલું લખાણ:\n${labelText}\n\n`
                + `હવે ઉપરના ફોર્મેટમાં પ્રોડક્ટ ઓળખો.`,
        }];
        if (state.front) parts2.push(imgPart(state.front));
        if (state.back) parts2.push(imgPart(state.back));

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
        $('sourceList').innerHTML = list.map((p) =>
            `<div class="src"><b>પાનું ${p.page}</b><br>${esc(clip(p.text, 240))}</div>`).join('');
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
            msgs.splice(1, 0, {
                role: 'system',
                content: `આ પ્રશ્ન માટે સંબંધિત પાનાં:\n${sourceBlock(extra)}`,
            });
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
        pages: pages.map((p) => ({ page: p.page, text: clip(p.text, 400) })),
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
    $('providerSel').value = state.provider;
    $('apiKey').value = state.apiKey;
    syncProviderUi();
    $('settingsDlg').showModal();
}

async function syncProviderUi() {
    const sel = $('providerSel').value;
    const p = PROVIDERS[sel];

    /* The key field only appears if the build allows user-supplied keys. */
    $('keyField').hidden = !CONFIG.allowUserKey || !p.keyUrl;
    if (CONFIG.allowUserKey && p.keyUrl) {
        $('keyNote').innerHTML =
            `<a href="${p.keyUrl}" target="_blank" rel="noopener">${p.note}</a>`;
    }

    const note = $('modelNote');
    if (sel === 'builtin') {
        const ok = await builtinReady();
        note.textContent = ok
            ? (canScan()
                ? 'લખેલા પ્રશ્ન ફોનમાં જ ચાલે છે. ફોટો ઓળખવા માટે ઓનલાઇન મોડેલ વપરાય છે.'
                : 'લખેલા પ્રશ્ન ફોનમાં જ ચાલે છે. ફોટો ઓળખવાની સુવિધા બંધ છે.')
            : 'આ બ્રાઉઝરમાં બિલ્ટ-ઇન AI નથી (Chrome 138+ જોઈએ).';
    } else {
        note.textContent = state.apiKey ? '' : 'આ મોડેલ માટે કી સેટ થયેલી નથી.';
    }
}

/* Is Chrome's on-device model usable right now? */
async function builtinReady() {
    try {
        if (!('LanguageModel' in self)) return false;
        return (await LanguageModel.availability()) !== 'unavailable';
    } catch { return false; }
}

/* Photo identification needs a hosted vision model, so it needs a key. */
const canScan = () => !!state.apiKey;

function refreshSetup() {
    const needKey = CONFIG.allowUserKey && !state.apiKey && state.provider !== 'builtin';
    const hasPdf = !!state.source?.pages?.length;

    $('stepKey').hidden = !CONFIG.allowUserKey;
    $('stepKey').classList.toggle('done', !needKey);
    $('stepPdf').classList.toggle('done', hasPdf);
    $('setupBanner').hidden = !needKey && hasPdf;

    if (hasPdf) {
        $('pdfStatus').hidden = false;
        $('pdfName').textContent = `${state.source.name} — ${state.source.pages.length} પાનાં`;
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
    state.provider = meta.provider
        || (CONFIG.preferBuiltinForText ? 'builtin' : (CONFIG.provider || 'gemini'));
    /* A user key only applies when the build permits one. */
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
    $('providerSel').addEventListener('change', () => { syncProviderUi(); });
    $('keyReveal').addEventListener('click', () => {
        const f = $('apiKey');
        f.type = f.type === 'password' ? 'text' : 'password';
    });
    $('saveSettings').addEventListener('click', async () => {
        state.provider = $('providerSel').value;
        if (CONFIG.allowUserKey) {
            const typed = $('apiKey').value.trim();
            state.apiKey = typed || CONFIG.apiKey || '';
        }
        await put('meta', {
            provider: state.provider,
            apiKey: CONFIG.allowUserKey ? state.apiKey : '',
        }, 'settings');
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
            if (!src.pages.length) throw new Error('PDF માં લખાણ મળ્યું નહીં (સ્કેન કરેલી PDF હોઈ શકે).');
            state.source = src;
            await put('source', src, 'default');
            toast(`${src.pages.length} પાનાં સચવાયાં.`);
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
