# Scheduling a blog post

Write the post as usual, then schedule it in two steps — both doable from the
GitHub web UI.

## 1. In the post's own file

Add a noindex meta to `blog/<slug>/index.html` inside `<head>`, so search
engines don't pick it up before the publish date:

```html
<meta name="robots" content="noindex, nofollow">
```

The workflow strips this line automatically when the post goes live.

## 2. In `blog/index.html`

Add the post to the top of the `posts` array with two extra fields:

```js
{
    id: 27,
    title: 'Your Post Title',
    excerpt: 'One-sentence summary.',
    date: 'Oct 01, 2026',
    readTime: '5 min read',
    category: 'Laravel',
    url: '/blog/your-post-slug/',
    publishDate: '2026-10-01T09:00:00Z',  // UTC — when it should go live
    scheduled: true,                       // removed automatically on publish
},
```

Do **not** add it to `sitemap.xml` or the hidden SEO link block — the workflow
does that at publish time.

## What happens next

`.github/workflows/publish-scheduled.yml` runs hourly. When `publishDate`
passes, it removes the `scheduled` flag, adds the crawler link and sitemap
entry, strips the noindex meta, and commits. GitHub Pages redeploys on that
commit.

## Notes

- Times are UTC. IST is UTC+5:30, so 09:00 IST is `03:30:00Z`.
- GitHub's cron can run 10–15 minutes late under load. Treat the publish time
  as approximate — schedule slightly early if the exact minute matters.
- To publish immediately, run the workflow by hand: Actions tab →
  "Publish scheduled posts" → "Run workflow".
- Running the script twice is safe; it does nothing once a post is published.
