/* =========================================================================
 * Builds tools/preview/app — a copy of the plugin with a single mock-API
 * script tag injected, so the real UI can be rendered in a plain browser for
 * screenshots and runtime-error capture.
 *
 * The plugin now lives at the workspace root, next to README.md, so only the
 * files on PLUGIN_FILES are copied — dev tooling (tools/, dist/) must never
 * leak into the preview app or into a packaged .eagleplugin.
 *
 * Run:  node tools/make-preview.js
 * ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const target = path.join(__dirname, 'preview', 'app');

/** Exactly what ships as the Eagle plugin. Keep in sync with tools/package.ps1. */
const PLUGIN_FILES = ['manifest.json', 'logo.png', 'index.html', 'css', 'js'];

function copyItem(from, to) {
    const stat = fs.statSync(from);
    if (stat.isDirectory()) {
        fs.mkdirSync(to, { recursive: true });
        for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
            copyItem(path.join(from, entry.name), path.join(to, entry.name));
        }
    } else {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
    }
}

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });

const copied = [];
for (const item of PLUGIN_FILES) {
    const src = path.join(root, item);
    if (!fs.existsSync(src)) {
        console.error(`missing plugin file: ${item}`);
        process.exit(1);
    }
    copyItem(src, path.join(target, item));
    copied.push(item);
}

// Inject the mock Eagle API as the first thing in <head> so it is defined
// before any plugin script runs.
const indexPath = path.join(target, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
if (!html.includes('mock-eagle.js')) {
    html = html.replace('</head>',
        '    <!-- mock Eagle API (preview harness only) -->\n'
        + '    <script src="../mock-eagle.js"></script>\n</head>');
}
fs.writeFileSync(indexPath, html, 'utf8');

console.log('preview app built at', target);
console.log('copied:', copied.join(', '));
