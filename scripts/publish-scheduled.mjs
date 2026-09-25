#!/usr/bin/env node
/**
 * Publishes blog posts whose `publishDate` has arrived.
 *
 * Source of truth: the `posts` array in blog/index.html. A post that is not yet
 * due carries `scheduled: true`. When its publishDate passes, this script:
 *   1. removes the `scheduled` flag so the listing renders it,
 *   2. adds a crawler link to the hidden SEO block,
 *   3. adds a <url> entry to sitemap.xml,
 *   4. strips the noindex robots meta from the post's own HTML file,
 *   5. lists the post under "Key Guides" in llms.txt.
 *
 * Idempotent: re-running changes nothing once a post is published.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = join(ROOT, 'blog', 'index.html');
const SITEMAP = join(ROOT, 'sitemap.xml');
const LLMS = join(ROOT, 'llms.txt');
const SITE = 'https://sagarpansuriya.in';

const now = new Date();

/** Extract the `const posts = [ ... ];` literal from the index. */
function readPostsArray(html) {
    const start = html.indexOf('const posts = [');
    if (start === -1) throw new Error('Could not find `const posts = [` in blog/index.html');

    const open = html.indexOf('[', start);
    let depth = 0;
    let end = -1;
    let inStr = null;
    let escaped = false;

    for (let i = open; i < html.length; i++) {
        const ch = html[i];
        if (inStr) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === inStr) inStr = null;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
        if (ch === '[') depth++;
        else if (ch === ']') {
            depth--;
            if (depth === 0) { end = i; break; }
        }
    }
    if (end === -1) throw new Error('Unbalanced posts array in blog/index.html');

    const literal = html.slice(open, end + 1);
    // The literal is plain data, so evaluating it here is safe and keeps us
    // from hand-rolling a JS parser for quotes/escapes we already handle above.
    const posts = new Function(`return ${literal};`)();
    return { posts, open, end, literal };
}

/** Posts that are due but still flagged as scheduled. */
function findDue(posts) {
    return posts.filter(p => {
        if (!p.scheduled) return false;
        if (!p.publishDate) {
            console.warn(`  ! "${p.title}" is scheduled but has no publishDate — skipping.`);
            return false;
        }
        const when = new Date(p.publishDate);
        if (Number.isNaN(when.getTime())) {
            console.warn(`  ! "${p.title}" has an unparseable publishDate — skipping.`);
            return false;
        }
        return when <= now;
    });
}

/** Drop `scheduled: true` from a post object inside the raw literal text. */
function unflagInLiteral(literal, post) {
    // Locate this post's object by its unique url line, then remove the
    // scheduled flag only within that object's bounds.
    const urlNeedle = literal.indexOf(post.url);
    if (urlNeedle === -1) throw new Error(`Could not locate ${post.url} in posts array`);

    const objStart = literal.lastIndexOf('{', urlNeedle);
    const objEnd = literal.indexOf('}', urlNeedle);
    if (objStart === -1 || objEnd === -1) throw new Error(`Malformed object for ${post.url}`);

    const before = literal.slice(0, objStart);
    const obj = literal.slice(objStart, objEnd + 1);
    const after = literal.slice(objEnd + 1);

    const cleaned = obj.replace(/\n\s*scheduled:\s*true,?/, '');
    return before + cleaned + after;
}

/** Insert a crawler link at the top of the hidden SEO block. */
function addSeoLink(html, post) {
    if (html.includes(`<a href="${post.url}">`)) return html;

    const marker = '<div style="display: none;" aria-hidden="true" hidden>';
    const at = html.indexOf(marker);
    if (at === -1) {
        console.warn('  ! SEO link block not found — skipping crawler link.');
        return html;
    }
    const insertAt = at + marker.length;
    const escaped = post.title
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    return html.slice(0, insertAt)
        + `\n        <a href="${post.url}">${escaped}</a>`
        + html.slice(insertAt);
}

/** Append a <url> entry to the sitemap. */
function addSitemapEntry(xml, post) {
    const loc = `${SITE}${post.url}`;
    if (xml.includes(`<loc>${loc}</loc>`)) return xml;

    const lastmod = new Date(post.publishDate).toISOString().slice(0, 10);
    const entry = `    <url>
        <loc>${loc}</loc>
        <lastmod>${lastmod}</lastmod>
        <changefreq>monthly</changefreq>
        <priority>0.8</priority>
    </url>
`;
    return xml.replace('</urlset>', entry + '</urlset>');
}

/** List the post at the top of the "Key Guides" section of llms.txt. */
function addLlmsEntry(txt, post) {
    const loc = `${SITE}${post.url}`;
    if (txt.includes(`(${loc})`)) return txt;

    const marker = '### Key Guides\n';
    const at = txt.indexOf(marker);
    if (at === -1) {
        console.warn('  ! "### Key Guides" not found in llms.txt — skipping.');
        return txt;
    }
    const insertAt = at + marker.length;
    return txt.slice(0, insertAt) + `- [${post.title}](${loc})\n` + txt.slice(insertAt);
}

/** Remove the noindex robots meta from the post's own page. */
function unblockPostFile(post) {
    const file = join(ROOT, post.url.replace(/^\/|\/$/g, ''), 'index.html');
    if (!existsSync(file)) {
        console.warn(`  ! ${post.url} has no index.html yet — nothing to unblock.`);
        return false;
    }
    const before = readFileSync(file, 'utf8');
    const after = before.replace(
        /\s*<meta\s+name=["']robots["']\s+content=["'][^"']*noindex[^"']*["']\s*\/?>/i,
        ''
    );
    if (before === after) return false;
    writeFileSync(file, after);
    return true;
}

// ---- Run ----
let html = readFileSync(INDEX, 'utf8');
const { posts, open, end, literal } = readPostsArray(html);
const due = findDue(posts);

if (due.length === 0) {
    console.log('Nothing due to publish.');
    process.exit(0);
}

console.log(`Publishing ${due.length} post(s):`);

let newLiteral = literal;
for (const post of due) {
    newLiteral = unflagInLiteral(newLiteral, post);
}

html = html.slice(0, open) + newLiteral + html.slice(end + 1);

for (const post of due) {
    html = addSeoLink(html, post);
    const unblocked = unblockPostFile(post);
    console.log(`  - ${post.title}${unblocked ? ' (noindex removed)' : ''}`);
}

writeFileSync(INDEX, html);

let xml = readFileSync(SITEMAP, 'utf8');
for (const post of due) xml = addSitemapEntry(xml, post);
writeFileSync(SITEMAP, xml);

if (existsSync(LLMS)) {
    let txt = readFileSync(LLMS, 'utf8');
    for (const post of due) txt = addLlmsEntry(txt, post);
    writeFileSync(LLMS, txt);
}

console.log('Done.');
