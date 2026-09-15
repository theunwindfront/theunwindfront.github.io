/* Build-time configuration.
 *
 * Put your key below, then run `npm run build`. End users never see a key
 * prompt — the app works the moment it opens.
 *
 * ── Read this before shipping ──────────────────────────────────────────
 * A key in a client-side app IS PUBLIC. Anyone can read it in DevTools.
 * That is an accepted trade for a frictionless app, but protect yourself:
 *   • use a FREE-TIER key, never one attached to billing
 *   • set a quota cap in the provider console
 *   • rotate the key if usage spikes
 * If this app is ever public-facing at scale, move the key behind a
 * serverless proxy instead (see README).
 * ──────────────────────────────────────────────────────────────────────
 *
 * Gemini key:  https://aistudio.google.com/apikey   (free tier)
 * Groq key:    https://console.groq.com/keys        (free tier, faster)
 */

export const CONFIG = {
    /* Text questions run on Chrome's built-in Gemini Nano — on-device, no key,
       no network. Set false to send text to the vision provider instead. */
    preferBuiltinForText: true,

    /* Photos need a vision model; Gemini Nano cannot read images.
       'gemini' | 'groq' | 'openrouter' */
    provider: 'gemini',

    /* Key for the provider above. Leave '' and photo scanning stays disabled
       while text questions still work with no key at all. */
    apiKey: '',

    /* true shows a key field in Settings so users can supply their own. */
    allowUserKey: false,
};
