# Skill: Create a New Blog Page

This skill outlines the necessary steps and instructions to create a new single blog page in this repository. Ensure you follow all steps to maintain consistent SEO, styling, and listing across the site.

## 1. Create the Blog Post Directory
Choose a URL-friendly slug for the new blog post. Create a new directory inside the `blog` folder:
```bash
mkdir blog/<post-slug>
```

## 2. Add the Cover Image
Place a cover image named `cover.png` inside the newly created directory (`blog/<post-slug>/cover.png`). This image is required for the blog post header, Open Graph, and Twitter preview cards.

## 3. Create the Post `index.html` File
Create `blog/<post-slug>/index.html`. It is recommended to copy the structure of an existing post (like `blog/claude-code-context-hygiene/index.html`) to ensure all Alpine.js logic, standard styling, and structured data scripts are included. 

### Essential Elements to Update in `index.html`:

**Meta Tags & SEO:**
- `<title>`: The title of the blog post.
- `<meta name="description" content="...">`: A short excerpt.
- `<link rel="canonical" href="https://sagarpansuriya.in/blog/<post-slug>/">`: Update the slug.
- Open Graph Tags (`og:title`, `og:description`, `og:image`, `og:url`): Ensure these reflect the new post.
- Twitter Tags (`twitter:title`, `twitter:description`, `twitter:image`).

**Structured Data (LD+JSON):**
- Update the `BlogPosting` JSON block inside the `<head>`.
- Set `headline`, `description`, `image`, `datePublished`, `dateModified`, `articleSection` (the category), `keywords` (array of tags), and `url`.

**Page Content Header:**
- Breadcrumb category: `<a href="/blog/?category=...`
- The main `<h1 class="...">Title Here</h1>` tag.
- Publish Date: `<time datetime="YYYY-MM-DD">Mon DD, YYYY</time>`
- Read Time: e.g., `<span class="...">5 min read</span>`
- Cover Image `alt` text: Update the `alt="..."` attribute on the cover `<img>` tag.

**Blog Content Body:**
- Place your main blog content inside the `<div class="prose-content text-base leading-relaxed max-w-3xl"...>` container.
- Use native HTML tags styled by the existing CSS: `<h2>`, `<h3>`, `<p>`, `<ul>`, `<li>`.
- For code snippets, wrap them in `<pre class="code-block"><code>...</code></pre>`.

**Comments & Discussion Section:**
- Make sure the Comments/Discussion block (`<div id="comments-container"></div>` with the `utterances` script) is included at the bottom of the `<main>` section.
- Ensure the script uses the correct repository (`repo="theunwindfront/theunwindfront.github.io"`) and correctly syncs with the Alpine dark/light mode toggle.

## 4. Update the Blog Index (`blog/index.html`)
To make the post visible on the blog listing page, you must add it to the `posts` array in the `blog/index.html` file.

Open `blog/index.html`, locate the `blogApp()` Alpine component script near the bottom, and add a new entry to the top of the `posts: [` array:

```javascript
{
    id: 19, // Increment the ID from the previous highest post ID
    title: 'Your Blog Post Title',
    excerpt: 'A short description of the post...',
    date: 'Month DD, YYYY',
    readTime: 'X min read',
    category: 'Target Category', // Must use an existing category (e.g., 'Laravel', 'TailwindCSS') otherwise you must add new SVG icon logic in blog/index.html.
    url: '/blog/<post-slug>/',
}
```

## 5. Update the Sitemap (`sitemap.xml`)
To ensure proper SEO discovery, append a new `<url>` entry to the root `sitemap.xml`. Configure the `<loc>` (URL), `<lastmod>` (date), `<changefreq>` (monthly), and `<priority>` (0.8).

## 6. Review & Test
- Check the local development server to ensure the new post renders successfully.
- Verify that the new post correctly appears in the blog list and its category filter works.
- Verify that dark mode, syntax highlighting (if any), and the "Explore with AI" buttons function seamlessly.
