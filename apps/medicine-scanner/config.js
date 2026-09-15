/* Build-time configuration.
 *
 * The recommended setup needs NO key in this file and NO key from users:
 * deploy the Worker in ./worker, put your Gemini key there as a secret, and
 * paste its URL into proxyUrl below. The key then lives on the server and is
 * never visible in the browser.
 *
 * See ./worker/README.md for the five-minute deploy.
 */

export const CONFIG = {
    /* Your deployed Worker, e.g. 'https://aushadhi-api.<you>.workers.dev'.
       Set this and the app works on every browser and device with no key
       anywhere in the client. */
    proxyUrl: '',

    /* Use Chrome's on-device model for typed questions when it exists
       (desktop Chrome 138+). Saves proxy quota; ignored elsewhere.
       Photos always need the proxy or a key — Nano cannot read images. */
    preferBuiltinForText: true,

    /* ── Fallbacks, only used when proxyUrl is empty ──────────────────
       Direct-to-provider mode. A key here IS PUBLIC — readable in DevTools.
       Use a free-tier key with a quota cap, or better, use the proxy. */
    provider: 'gemini',   /* 'gemini' | 'groq' | 'openrouter' */
    apiKey: '',

    /* true shows a key field in Settings so users can supply their own. */
    allowUserKey: false,
};
