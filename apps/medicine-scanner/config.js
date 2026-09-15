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

    /* Model. Flash is fast, free-tier friendly, and reads images well. */
    model: 'gemini-2.0-flash',

    /* Optional: a deployed Worker URL (see ./worker). When set, the key
       above is ignored and requests go through the proxy instead. */
    proxyUrl: '',

    /* Show a key field in Settings so users can use their own Gemini key.
       A key they enter overrides the one above, and is saved on their
       device only. */
    allowUserKey: true,
};
