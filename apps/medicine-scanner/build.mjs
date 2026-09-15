#!/usr/bin/env node
/* Build: bundle + minify + inline + hash, like a React/Next production build.
   Output lands in dist/ — deploy that folder, keep the sources for editing.

   Usage:  node build.mjs          (writes dist/)
           node build.mjs --serve  (writes dist/ and serves it on :4173) */

import { build, transform } from 'esbuild';
import { readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);

/* --out <dir> writes the build somewhere else (e.g. the site's showcase folder).
   --base <path> rewrites asset URLs for that deploy location. */
const argOf = (flag, fallback) => {
    const i = process.argv.indexOf(flag);
    return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const dist = path.resolve(root, argOf('--out', 'dist'));
const base = argOf('--base', './').replace(/\/?$/, '/');
const hash8 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 8);

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

/* ---- JS: bundle, tree-shake, minify, mangle ---- */
const js = await build({
    entryPoints: [path.join(root, 'app.js')],
    bundle: true,
    format: 'esm',
    target: ['es2022'],
    minify: true,
    mangleProps: /^_/,
    legalComments: 'none',
    drop: ['console', 'debugger'],
    write: false,
    external: ['https://*'],
});
const jsCode = js.outputFiles[0].text
    .replace(/register\((['"])\.\/sw\.js\1\)/,
        `register("${base}sw.js",{scope:"${base}"})`);
const jsName = `app.${hash8(jsCode)}.js`;
await writeFile(path.join(dist, jsName), jsCode);

/* ---- CSS: minify ---- */
const cssSrc = await readFile(path.join(root, 'styles.css'), 'utf8');
const { code: cssCode } = await transform(cssSrc, { loader: 'css', minify: true });
const cssName = `styles.${hash8(cssCode)}.css`;
await writeFile(path.join(dist, cssName), cssCode);

/* ---- HTML: repoint to hashed assets, inline CSS, collapse ---- */
let html = await readFile(path.join(root, 'index.html'), 'utf8');
html = html
    .replace('<link rel="stylesheet" href="styles.css">', `<style>${cssCode}</style>`)
    .replace('<script src="app.js" type="module"></script>',
        `<script src="${base}${jsName}" type="module"></script>`)
    .replace('href="manifest.webmanifest"', `href="${base}manifest.webmanifest"`)
    .replace('href="https://sagarpansuriya.in/apps/medicine-scanner/"',
        `href="https://sagarpansuriya.in${base.startsWith('/') ? base : '/'}"`)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\n\s*\n/g, '\n')
    .replace(/>\s+</g, '><')
    .trim();
await writeFile(path.join(dist, 'index.html'), html);

/* ---- static passthrough ---- */
await cp(path.join(root, 'sw.js'), path.join(dist, 'sw.js'));

const mf = JSON.parse(await readFile(path.join(root, 'manifest.webmanifest'), 'utf8'));
mf.start_url = base;
mf.scope = base;
await writeFile(path.join(dist, 'manifest.webmanifest'), JSON.stringify(mf, null, 2));
/* Keep the SW shell list in sync with the hashed filenames. */
let sw = await readFile(path.join(dist, 'sw.js'), 'utf8');
sw = sw
    .replace("'./styles.css', './app.js'", `'${base}${jsName}'`)
    .replace(/'\.\/'/g, `'${base}'`)
    .replace(/'\.\/index\.html'/g, `'${base}index.html'`)
    .replace(/'\.\/manifest\.webmanifest'/g, `'${base}manifest.webmanifest'`)
    .replace('aushadhi-v1', `medscanner-${hash8(jsCode + cssCode)}`);
const { code: swMin } = await transform(sw, { loader: 'js', minify: true });
await writeFile(path.join(dist, 'sw.js'), swMin);

const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(1) + ' kB';
console.log(`dist/${'index.html'.padEnd(26)} ${kb(html)}`);
console.log(`dist/${jsName.padEnd(26)} ${kb(jsCode)}`);
console.log(`dist/${cssName.padEnd(26)} ${kb(cssCode)}  (inlined)`);
console.log(`\nbuild complete → ${path.relative(root, dist) || '.'}/  (base ${base})`);

if (process.argv.includes('--serve')) {
    const { createServer } = await import('node:http');
    const { stat } = await import('node:fs/promises');
    const types = {
        '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
        '.webmanifest': 'application/manifest+json', '.json': 'application/json',
    };
    createServer(async (req, res) => {
        let p = path.join(dist, decodeURIComponent(req.url.split('?')[0]));
        try { if ((await stat(p)).isDirectory()) p = path.join(p, 'index.html'); }
        catch { p = path.join(dist, 'index.html'); }
        try {
            const body = await readFile(p);
            res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
            res.end(body);
        } catch { res.writeHead(404).end('not found'); }
    }).listen(4173, () => console.log('serving dist/ → http://localhost:4173'));
}
