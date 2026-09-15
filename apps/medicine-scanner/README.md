# ઔષધિ (Aushadhi)

USP product scanner. Photograph a medicine strip, get a Gujarati answer grounded
in your own USP product PDF, with page citations.

Everything — API key, the PDF, and scan history — stays in the browser on the
device. Nothing is uploaded anywhere except the images sent to the model you pick.

## How it works

1. **Source once.** The client uploads the USP PDF a single time. `pdf.js` extracts
   the text per page and the index is stored in IndexedDB, so it reloads
   automatically on every launch and survives restarts.
2. **Scan.** Front/back photos are downscaled to 1280px and sent to a vision
   model. Pass one reads the label text verbatim; pass two answers using only the
   PDF pages that match that text.
3. **Cite.** Every claim carries a page number, and the quoted source text is
   shown under the answer.
4. **Chat.** Follow-up questions reuse the same source, and can include a photo.

## Models

Users are never asked for a key. Two paths, chosen automatically:

| Need | Model | Key | Network |
| --- | --- | --- | --- |
| Typed questions (default) | Chrome built-in Gemini Nano | none | none — on-device |
| Photo identification | Gemini 2.0 Flash (or Groq / OpenRouter) | preset in `config.js` | yes |

Chrome's built-in model is text-only, so photos need a hosted vision model.
Leave `apiKey` empty and the app still works for typed questions — photo
scanning simply stays disabled with a message saying so.

Requires Chrome 138+ for the on-device path; otherwise everything falls back to
the hosted model.

## Setting the key

Edit [`config.js`](config.js), then build:

```js
export const CONFIG = {
    preferBuiltinForText: true,   // typed questions run on-device
    provider: 'gemini',           // 'gemini' | 'groq' | 'openrouter'
    apiKey: 'AIza…',              // free-tier key
    allowUserKey: false,          // true shows a key field in Settings
};
```

> **A key in a client-side app is public.** Anyone can read it in DevTools.
> Use a free-tier key with no billing attached, cap its quota in the provider
> console, and rotate it if usage spikes. For a public deployment at scale,
> move the key behind a serverless proxy and point `provider.url` at it.

## Build

```bash
npm install
npm run build     # → dist/            (local preview build)
npm run preview   # → serves dist/ on :4173
npm run deploy    # → ../../showcase/aushadhi/   (live at /showcase/aushadhi/)
```

`deploy` rewrites every asset URL, the manifest scope and the service-worker
shell for the `/showcase/aushadhi/` subpath, so the PWA installs correctly from
the live site. `dist/` is gitignored; `showcase/aushadhi/` is committed.

> Minification is not source protection. Any client-side app can be read in
> DevTools; the build is for load time, not secrecy.

## Notes

- A **text-based** PDF is required. A scanned/photographed PDF has no extractable
  text and will be rejected — run OCR on it first.
- Browsers cannot read a fixed folder on the device (no such API on mobile). The
  one-time upload into IndexedDB is the equivalent.
- The app states that it reports only what the book says and gives no medical
  advice; keep that constraint if you edit the prompt in `app.js`.
