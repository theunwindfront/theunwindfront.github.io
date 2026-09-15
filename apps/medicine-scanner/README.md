# ઔષધિ (Aushadhi)

Counter tool for dealers. A customer walks in with a competitor's product; the
dealer photographs it and the app searches their own catalogue PDF for what to
sell instead — with page numbers and prices to quote.

The answer has three parts:

1. **The customer's product**, read from the photo.
2. **The equivalent in our catalogue** — matched on technical name, strength
   and formulation rather than brand, since brands differ between companies.
   Tolfenpyrad 15% EC matches Tolfenpyrad 15% EC whether it is sold as TOLFERA
   or TUFFAN. Labelled exact match, partial match, or not found.
3. **Other options** — up to three ranked alternatives with brand, technical,
   pack, MRP and page. Same-technical products rank first, then same category,
   so there is always something to offer even when nothing matches exactly.

Anything with a different technical is labelled as such. When the catalogue has
no equivalent the app says so plainly instead of pushing a near-miss —
recommending the wrong agrochemical is worse than no answer.

The PDF, the API key, and all scan history stay on the device. Only the images
being identified leave it.

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

## The model

Google **Gemini 2.0 Flash** — the only model the app uses. It reads images, has
a free tier, and handles Gujarati well.

Two ways to supply the key:

1. **Users bring their own.** Settings has a key field with a link to
   [aistudio.google.com/apikey](https://aistudio.google.com/apikey). The key is
   saved on that device only and never leaves it except to call Gemini.
2. **You preset one.** Put it in [`config.js`](config.js) and the app works with
   no setup — but that key ships inside the JavaScript and anyone can read it in
   DevTools. Use a free-tier key, cap its quota, and restrict it to your domain.

A key a user enters overrides the preset one. Set `allowUserKey: false` to hide
the field entirely.

To keep a shared key off the client completely, deploy
[`worker/`](worker/) and set `proxyUrl` — the key then lives on a Cloudflare
Worker. That runs on a separate free host, since GitHub Pages serves only
static files.

## Quota

There is no unlimited free tier — every Gemini model caps requests per day, and
the caps differ enormously between models. Check your own account at
[aistudio.google.com/rate-limit](https://aistudio.google.com/rate-limit);
the numbers below were read from a real free-tier account.

| Model | RPM | Requests/day |
| --- | --- | --- |
| **gemini-3.5-flash-lite** (default) | 15 | **500** |
| gemini-3.1-flash-lite | 15 | 500 |
| gemini-3.6-flash / 3.7 / 3.8 | 5 | 20 |
| gemini-2.5-flash-lite | 10 | 20 |

Flash-Lite gives **25x the daily scans** of full Flash, and on medicine strips
it matched Flash's accuracy in testing while spending no reasoning tokens.

Pin an exact model id rather than a `-latest` alias: aliases can move to a model
in a different quota bucket without warning.

The app stretches that quota further:

- **`singlePass: true`** — one API call per scan instead of two, so 500/day
  becomes 500 scans rather than 250. Set it false for a two-pass read (label
  first, then answer), which helps on damaged or cluttered packaging.
- **PDF matching is local.** Only the photo and the matched pages are sent.
- **A per-minute 429 retries itself** once, with the wait shown on the button.
  The daily cap cannot be retried, so the app says so plainly and suggests
  adding a personal key.
- **Users can add their own key** in Settings, spending their quota instead of
  yours — the only way past one account's cap without paying.

## How matching works

Retrieval is local and costs no tokens. Page text is normalised at upload so
the same product matches across the ways it gets written:

- **OCR confusion folded away** — `O/0`, `l/1/i`, `S/5` map to one form, so
  `DOLO` and `DOL0` are the same key.
- **Strengths split** — `650mg`, `650 mg` and `650MG` all match.
- **Formulation codes indexed** — `15% EC`, `17.8% SL`, `75% WP` become single
  keys, so TOLFERA 15% EC is not confused with CYPERUNI 10% EC.
- **Word pairs** — `unify~tolfera` scores far above either word alone.
- **Fuzzy fallback** — a one-character slip still finds the page.
- **IDF weighting** — a brand name on one page outweighs a word on fifty;
  filler like `tablets`, `limited`, `pack` is dropped entirely.

Measured on a 120-page agrochemical catalogue with the target on page 73:
**1 page retrieved, correct, 119 irrelevant pages never sent.**

## Reading the source PDF

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
