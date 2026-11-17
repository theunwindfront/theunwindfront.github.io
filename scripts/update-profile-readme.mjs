// Pulls the latest published posts from sagarpansuriya.in/blog/ and rewrites
// the block between the BLOG-POST-LIST markers in the GitHub profile README
// (theunwindfront/theunwindfront). Usage:
//
//   node scripts/update-profile-readme.mjs <path/to/profile/README.md>
//
// The blog has no RSS feed; its listing lives in a `const posts = [...]` array
// inside blog/index.html (newest first). Scheduled posts are skipped until
// their publishDate has passed.

import { readFile, writeFile } from 'node:fs/promises';

const SITE = 'https://sagarpansuriya.in';
const LIMIT = 5;
const README = process.argv[2];
if (!README) throw new Error('usage: node scripts/update-profile-readme.mjs <path/to/README.md>');

const html = await (await fetch(`${SITE}/blog/`)).text();

const start = html.indexOf('const posts = [');
if (start === -1) throw new Error('posts array not found on /blog/');
const end = html.indexOf('\n        ];', start);
const block = html.slice(start, end === -1 ? undefined : end);

// Single-quoted JS string with backslash escapes.
const field = (src, name) => {
    const m = src.match(new RegExp(`\\b${name}:\\s*'((?:\\\\.|[^'\\\\])*)'`));
    return m ? m[1].replace(/\\(.)/g, '$1') : null;
};

const now = Date.now();
const posts = block
    .split(/\n\s*\{\s*\n/)
    .slice(1)
    .map((obj) => ({
        title: field(obj, 'title'),
        date: field(obj, 'date'),
        url: field(obj, 'url'),
        publishDate: field(obj, 'publishDate'),
        scheduled: /\bscheduled:\s*true/.test(obj),
    }))
    .filter((p) => p.title && p.url)
    .filter((p) => !p.scheduled || (p.publishDate && Date.parse(p.publishDate) <= now))
    .slice(0, LIMIT);

if (posts.length === 0) throw new Error('no published posts parsed — refusing to blank the list');

const shortDate = (d) => {
    const t = Date.parse(d);
    return Number.isNaN(t)
        ? d
        : new Date(t).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
};

const list = posts
    .map((p) => `- [${p.title}](${new URL(p.url, SITE)}) *(${shortDate(p.date)})*`)
    .join('\n');

const readme = await readFile(README, 'utf8');
const updated = readme.replace(
    /(<!-- BLOG-POST-LIST:START -->)[\s\S]*?(<!-- BLOG-POST-LIST:END -->)/,
    `$1\n${list}\n$2`,
);

if (updated !== readme) {
    await writeFile(README, updated);
    console.log(`README updated with ${posts.length} posts.`);
} else {
    console.log('README already up to date.');
}
