/* Aushadhi API proxy — Cloudflare Worker.
 *
 * Holds the model key server-side so the web app never ships one. The app
 * posts the same body it would send to the provider; this forwards it with
 * the key attached and returns the provider's reply unchanged.
 *
 * Deploy:  npx wrangler deploy
 * Secret:  npx wrangler secret put GEMINI_API_KEY
 */

const MODEL = 'gemini-3.5-flash-lite';
const UPSTREAM =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

/* Only these origins may call the proxy. Add your domain(s). */
const ALLOWED = [
    'https://sagarpansuriya.in',
    'https://theunwindfront.github.io',
    'http://localhost:4180',
    'http://localhost:4173',
];

/* Per-IP rate limit, enforced with the free KV binding when present. */
const LIMIT = 40;          // requests
const WINDOW = 3600;       // seconds

function cors(origin) {
    const allow = ALLOWED.includes(origin) ? origin : ALLOWED[0];
    return {
        'Access-Control-Allow-Origin': allow,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
    };
}

const json = (obj, status, headers) =>
    new Response(JSON.stringify(obj), {
        status,
        headers: { 'Content-Type': 'application/json', ...headers },
    });

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin') || '';
        const head = cors(origin);

        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: head });
        if (request.method !== 'POST') return json({ error: 'POST only' }, 405, head);
        if (origin && !ALLOWED.includes(origin)) return json({ error: 'origin not allowed' }, 403, head);
        if (!env.GEMINI_API_KEY) return json({ error: 'server key not configured' }, 500, head);

        /* Rate limit per IP when a KV namespace is bound. */
        if (env.RATE) {
            const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
            const key = `rl:${ip}:${Math.floor(Date.now() / 1000 / WINDOW)}`;
            const used = parseInt((await env.RATE.get(key)) || '0', 10);
            if (used >= LIMIT) {
                return json({ error: 'મર્યાદા પૂરી થઈ. થોડી વાર પછી પ્રયત્ન કરો.' }, 429, head);
            }
            await env.RATE.put(key, String(used + 1), { expirationTtl: WINDOW });
        }

        let body;
        try {
            body = await request.json();
        } catch {
            return json({ error: 'bad json' }, 400, head);
        }

        /* Reject oversized payloads early (roughly 2 photos at 1280px). */
        const size = JSON.stringify(body).length;
        if (size > 8_000_000) return json({ error: 'payload too large' }, 413, head);

        const upstream = await fetch(UPSTREAM, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': env.GEMINI_API_KEY,
            },
            body: JSON.stringify(body),
        });

        const text = await upstream.text();
        return new Response(text, {
            status: upstream.status,
            headers: { 'Content-Type': 'application/json', ...head },
        });
    },
};
