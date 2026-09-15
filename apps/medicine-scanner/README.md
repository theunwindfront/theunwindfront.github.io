# ઔષધિ (Aushadhi)

USP product scanner. Photograph a medicine strip, get a Gujarati answer grounded
in your own USP product PDF, with page citations.

The PDF and all scan history stay in the browser on the device. With the proxy
deployed there is no API key in the app at all; only the images being identified
leave the device.

## How it works

1. **Source once.** The client uploads the USP PDF a single time. `pdf.js` reads
   each page — text where there is text, a rendered image where there is not —
   and the index is stored in IndexedDB, so it reloads automatically on every
   launch and survives restarts.
2. **Scan.** Front/back photos are downscaled to 1280px and sent to a vision
   model. Pass one reads the label text verbatim; pass two answers using only the
   PDF pages that match it — including page images when those pages are scans.
3. **Cite.** Every claim carries a page number, and the quoted source text is
   shown under the answer.
4. **Chat.** Follow-up questions reuse the same source, and can include a photo.

## Models — no key for users

Deploy the proxy in [`worker/`](worker/) and the app needs no key anywhere in
the browser, on any device. See [`worker/README.md`](worker/README.md).

| Need | Where it runs | Key in browser |
| --- | --- | --- |
| Typed questions, desktop Chrome 138+ | on-device Gemini Nano | none |
| Typed questions, everywhere else | proxy → Gemini | none |
| Photo identification | proxy → Gemini | none |

Chrome's built-in model is **desktop-only and text-only** — it does not exist on
Chrome for Android or iOS. It is used opportunistically to save proxy quota, and
everything falls back to the proxy when it is absent, so phones work normally.

Without a proxy the app can still run a key straight from `config.js`, but that
key is readable in DevTools by anyone. Use it only for local testing.

## Reading the USP PDF

Both kinds of PDF work, decided per page:

- **Pages with text** are indexed as text. Lookup is a local search, so matching
  is instant and costs nothing.
- **Pages without text** (scans, photographed books, product images) are
  rendered to JPEG and sent to the vision model to read directly.

A page under 60 characters counts as a scan. Citations show the page text, or a
thumbnail of the page itself when it is an image.

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

- Scanned PDFs work — pages with no text layer are rendered and read by the
  vision model. Text pages are still faster and cheaper, so prefer a text-based
  PDF when you have one.
- Browsers cannot read a fixed folder on the device (no such API on mobile). The
  one-time upload into IndexedDB is the equivalent.
- The app states that it reports only what the book says and gives no medical
  advice; keep that constraint if you edit the prompt in `app.js`.
