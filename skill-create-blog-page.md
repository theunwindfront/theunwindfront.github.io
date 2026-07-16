# Skill: Create a New Blog Page

This skill outlines how to create a new single blog post so it matches the site's current
**minimalist "serif long-form" design** (Newsreader serif body, JetBrains Mono labels/code,
warm-paper/true-ink theme with a `light-dark()` auto theme + manual toggle). Follow every step
to keep SEO, styling, and the blog listing consistent.

> IMPORTANT: The site no longer uses Tailwind CDN, Alpine.js, `blogApp()`, `.prose-content`,
> or the "Explore with AI" block. Do NOT copy any old-pattern post. Copy the reference below.

## 1. Create the post directory
Choose a URL-friendly slug, then:
```bash
mkdir blog/<post-slug>
```

## 2. Add the cover image
Place `cover.png` (or `.jpg`) in `blog/<post-slug>/`. It's used in the article header, Open
Graph, and Twitter cards. Put any in-article images (diagrams, screenshots) in the same folder.

## 3. Create `index.html` by copying the reference post
The canonical template is **`blog/http-query-method/index.html`** — it already has the exact
`<head>`, `<style>`, top nav, article scaffold, footer, and the three vanilla-JS scripts.
```bash
cp blog/http-query-method/index.html blog/<post-slug>/index.html
```
Copy the whole `<style>` block verbatim — it is the shared design system. Never reintroduce
Tailwind or Alpine. The only JS on the page is: theme toggle, reading-progress bar, and the
utterances comments loader (all already in the reference).

### Page anatomy (what the reference gives you)
```
<html lang="en">            ← NO class, NO x-data
  <head> … design tokens in <style>, FOUC theme pin, fonts, SEO, JSON-LD …
  <body>
    <div id="progress"></div>              ← reading-progress bar
    <div class="wrap">
      <header class="topbar"> brand + nav (Writing/Work/Talks/CV) + Theme button </header>
      <main><article>
        <a class="post-cat" href="/blog/?category=CATEGORY">§ CATEGORY</a>
        <h1 class="post-title">…</h1>
        <div class="post-meta"> avatar · name · <time> · read-time </div>
        <div class="post-cover"><img src="cover.png" alt="…"></div>
        <div class="prose"> ARTICLE BODY </div>
        <section class="comments"><h2>Discussion</h2><div id="comments-container"></div></section>
        <div class="post-footer"> back link + share links </div>
      </article></main>
      <footer class="site"> … shared footer (see step 6) … </footer>
    </div>
    <script> theme toggle • reading progress • utterances </script>
```

### Update these in `<head>`
- `<meta name="color-scheme" content="light dark">` — keep it.
- `<title>` — post title.
- `<meta name="description">` — the excerpt.
- `<link rel="canonical" href="https://sagarpansuriya.in/blog/<post-slug>/">`.
- Open Graph: `og:type=article`, `og:title`, `og:description`, `og:image` (full cover URL), `og:url`.
- Twitter: `twitter:title`, `twitter:description`, `twitter:image`.
- `theme-color` / `msapplication-TileColor` = `#5b5bd6` (already set; don't change).
- **Structured data** — update the `BlogPosting` JSON-LD: `headline`, `description`, `image`
  (full cover URL), `datePublished` (`YYYY-MM-DD`), `author`, `mainEntityOfPage`, and
  `articleSection` (the category). Add `dateModified` / `keywords` if you have them.
- Fonts link is already correct (Newsreader + JetBrains Mono) — leave it.

### Update the article header
- `<a class="post-cat" href="/blog/?category=CATEGORY">§ CATEGORY</a>` — real category, both places.
- `<h1 class="post-title">…</h1>`.
- `.post-meta`: `<time datetime="YYYY-MM-DD">Mon DD, YYYY</time>` and the `X min read` span.
- `.post-cover` `<img src>` + `alt`.

### Write the body inside `<div class="prose"> … </div>`
Use plain semantic HTML — the `.prose` CSS styles it automatically:
- Headings: `<h2>` (gets a hairline top rule), `<h3>`, `<h4>` (mono sub-label).
- Text: `<p>`, `<strong>`, `<em>`, `<ul>`/`<ol>`/`<li>`, `<blockquote>`.
- Inline code: `<code>…</code>`. Code blocks: `<pre class="code-block"><code>…</code></pre>`
  (escape `<`, `>`, `&` inside code).
- Tables: plain `<table><thead><tbody>` — styled automatically, scrolls on mobile.
- Images: `<img src="file.png" alt="…">` (in-article images live in the post folder).
- **Write real HTML, not markdown.** No stray `**bold**`, `[label](url)`, or `` `code` ``.

### Update footer links (share + back)
- `.post-footer` share links: set the real canonical URL + title in the X and LinkedIn hrefs.

### Comments
- Keep the `<section class="comments">` + the utterances loader script. It targets
  `repo="theunwindfront/theunwindfront.github.io"`, `issue-term="pathname"`, and themes itself
  from the site's `color-scheme` (light/dark) — no changes needed. Omit this section only if a
  post should have no comments.

## Interactive / demo posts (only if the post has live widgets)
If the post needs a live demo (Alpine.js, a `<canvas>`, custom JS):
- Keep the Alpine.js CDN (or your demo script) — but do **not** put `x-data` on `<html>`;
  attach it to the demo element itself so it never fights the theme toggle.
- Wrap each demo in `<div class="demo">…</div>` and add this rule to the page `<style>`:
  ```css
  .demo { border:1px solid var(--line); border-radius:10px; padding:1.25rem; background:var(--panel); margin:1.6rem 0; }
  ```
- Prefer native CSS/HTML (`:has()`, `popover`, `<details>`, container queries) over JS when possible.
- If an SVG/diagram has baked-in dark colors, wrap it in `.demo` so it stays legible in light mode.

## 4. Add the post to the blog listing (`blog/index.html`)
The listing renders from a plain JS array (no Alpine). Open `blog/index.html`, find
`const posts = [` near the bottom, and add a new object at the **top** of the array:
```javascript
{
    id: 23,                     // increment the current highest id
    title: 'Your Blog Post Title',
    excerpt: 'A short description of the post…',
    date: 'Month DD, YYYY',
    readTime: 'X min read',
    category: 'Target Category', // must be one of the `categories` array; add a new one there if needed
    url: '/blog/<post-slug>/',
},
```
The category must exist in the `const categories = [ … ]` array at the top of the same script
(add it there if it's genuinely new — the filter buttons render from that list).

## 5. Update `sitemap.xml` (and optionally `llms.txt`)
Append a `<url>` entry: `<loc>https://sagarpansuriya.in/blog/<post-slug>/</loc>`, `<lastmod>`
(publish date), `<changefreq>monthly</changefreq>`, `<priority>0.8</priority>`.
Optionally add the post URL under the relevant list in `llms.txt`.

## 6. Shared footer (must match every page)
The footer block below is identical site-wide. The reference post already contains it — leave
it as-is (it includes the visitor counter, Privacy, and Sponsor links):
```html
<footer class="site">
    <div class="footer-links">
        <span>© 2026 Sagar Pansuriya</span>
        <a href="/">Home</a>
        <a href="/blog/">Writing</a>
        <a href="/showcase/">Work</a>
        <a href="/talks/">Talks</a>
        <a href="/cv/">CV</a>
        <a href="/privacy-policy/snake-reborn/">Privacy</a>
    </div>
    <div class="footer-links">
        <a href="https://smallcounter.com" target="_blank" rel="noopener" class="counter" title="Visitor Counter">
            <img src="https://smallcounter.com/count.php?c_style=87&id=1772562975" alt="Visitor count">
            <span>visitors</span>
        </a>
        <a href="https://github.com/sponsors/theunwindfront" target="_blank" rel="noopener" class="sponsor">❤ Sponsor</a>
    </div>
</footer>
```

## 7. Review & test
```bash
python3 -m http.server 8099    # then open http://localhost:8099/blog/<post-slug>/
```
Verify:
- The post renders in the new serif long-form style; light AND dark themes both look right
  (click **Theme** to toggle; it persists via `localStorage`).
- No console errors; the reading-progress bar moves; comments load.
- The post appears on `/blog/` and its category filter shows it (`/blog/?category=<Category>`).
- Cleanliness check — all should be 0:
  ```bash
  grep -c 'cdn.tailwindcss.com' blog/<post-slug>/index.html   # → 0
  grep -c 'blogApp' blog/<post-slug>/index.html               # → 0
  ```
  (For a static post, `x-data` should be 0 too; interactive posts keep it only on demo elements.)
