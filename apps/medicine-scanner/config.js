/* Aushadhi — configuration.
 *
 * Paste your Gemini key below, then run `npm run deploy`.
 * Free key: https://aistudio.google.com/apikey
 *
 * ── Know this before going live ───────────────────────────────────────
 * A key in a static site IS PUBLIC. It ships inside the JavaScript, so
 * anyone can read it in DevTools and spend your quota. Protect yourself:
 *   • use a FREE-TIER key with no billing attached
 *   • cap its quota in the Google AI Studio console
 *   • restrict the key to your domain (API restrictions → HTTP referrers)
 *   • rotate it if usage spikes
 * To remove this exposure entirely, deploy ./worker and set proxyUrl —
 * the key then lives on the server and never reaches the browser.
 * ──────────────────────────────────────────────────────────────────────
 */

export const CONFIG = {
    /* Your Gemini API key. */
    apiKey: '',

    /* Model. Flash-Lite is the right choice here on quota alone:
         gemini-3.5-flash-lite   15 RPM / 500 requests per day
         gemini-3.6-flash         5 RPM /  20 requests per day
       That is 25x the daily scans, and on medicine strips it matched full
       Flash in testing while spending no reasoning tokens.

       Use an exact id, not a '-latest' alias — aliases can move to a model
       in a different quota bucket. Check your own numbers at
       https://aistudio.google.com/rate-limit (they vary per account).

       Model IDs get retired — on a 404 saying the model is gone, the error
       names its replacement and the app tells you what to put here.
       Current list:  https://ai.google.dev/gemini-api/docs/models
       Your real quota: https://aistudio.google.com/rate-limit */
    model: 'gemini-3.5-flash-lite',

    /* One API call per scan instead of two. Halves quota use; the model
       reads the label and answers in a single pass. Set false to go back
       to the two-pass flow (read label, then answer) which is slightly
       more accurate on damaged or cluttered packaging. */
    singlePass: true,

    /* Optional: a deployed Worker URL (see ./worker). When set, the key
       above is ignored and requests go through the proxy instead. */
    proxyUrl: '',

    /* Show a key field in Settings so users can use their own Gemini key.
       A key they enter overrides the one above, and is saved on their
       device only. */
    allowUserKey: true,
};
