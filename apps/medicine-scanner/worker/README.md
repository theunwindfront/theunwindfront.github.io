# Aushadhi API proxy

Holds the Gemini key server-side so the web app ships without one. Users never
see a key, and it works on every browser and device — no Chrome version
requirement.

```
phone ──▶ aushadhi-api.<you>.workers.dev ──▶ Gemini
                    ▲
              key lives here, never in the browser
```

## Deploy (about five minutes)

```bash
cd worker
npx wrangler login                        # opens a browser once
npx wrangler secret put GEMINI_API_KEY    # paste your free key, it is hidden
npx wrangler deploy
```

Wrangler prints a URL like `https://aushadhi-api.<you>.workers.dev`. Put it in
[`../config.js`](../config.js):

```js
proxyUrl: 'https://aushadhi-api.<you>.workers.dev',
```

Then `npm run deploy` from the app folder. That is the whole setup.

Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

## Lock it to your domain

`ALLOWED` in [`worker.js`](worker.js) lists the origins that may call the proxy.
Keep your domains and drop the localhost entries before going live, so the
endpoint cannot be used from someone else's site.

## Rate limiting (recommended)

Without this, one visitor can spend your whole quota.

```bash
npx wrangler kv namespace create RATE
```

Uncomment the `kv_namespaces` block in [`wrangler.toml`](wrangler.toml), paste
the printed id, and redeploy. Defaults to 40 requests per IP per hour — change
`LIMIT` and `WINDOW` in `worker.js`.

## Free tier

Cloudflare Workers allow 100,000 requests/day at no cost. Each scan uses two
calls, so roughly 50,000 scans a day before any charge.

## Using Groq instead

Swap `UPSTREAM` and the auth header in `worker.js`:

```js
const UPSTREAM = 'https://api.groq.com/openai/v1/chat/completions';
// headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` }
```

Then set `provider: 'groq'` in `config.js` so the app sends the matching request
shape.
