// Ports the prototype CSS into inventory/src/styles verbatim, with exactly two transforms:
//  1. tokens.css: drop the Google Fonts @import (fonts are self-hosted via @fontsource)
//  2. app.css: remove rules whose selectors are ONLY .force-mobile/.force-desktop
//     (prototype tweaks tooling — the shell never gets those classes in production)
//
// Uses PostCSS (resolved through vite's dependency graph) instead of a hand-rolled
// brace counter: a previous version mis-chunked one rule boundary and produced
// balanced-but-malformed CSS that PostCSS rejected at runtime.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve('vite/package.json'));
const postcss = viteRequire('postcss');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const proto = join(root, '..', 'src');

// --- tokens.css ---
let tokens = readFileSync(join(proto, 'ds', 'colors_and_type.css'), 'utf8');
const beforeImport = tokens.length;
tokens = tokens.replace(
  /^@import url\("https:\/\/fonts\.googleapis[^\n]*\n/m,
  '/* Fonts are self-hosted via @fontsource (imported in main.tsx) */\n',
);
if (tokens.length === beforeImport) throw new Error('Google Fonts @import not found/removed');
postcss.parse(tokens); // must remain valid

// --- app.css ---
const appIn = readFileSync(join(proto, 'styles.css'), 'utf8');
const ast = postcss.parse(appIn); // prototype is valid CSS — parses or throws

const isForce = (s) => s.includes('.force-mobile') || s.includes('.force-desktop');
let dropped = 0;
let trimmed = 0;
ast.walkRules((rule) => {
  const kept = rule.selectors.filter((s) => !isForce(s));
  if (kept.length === 0) {
    rule.remove();
    dropped++;
  } else if (kept.length !== rule.selectors.length) {
    rule.selectors = kept;
    trimmed++;
  }
});

const appOut = ast.toString();
postcss.parse(appOut); // self-check: output must be valid
if (/\.force-(mobile|desktop)/.test(appOut)) throw new Error('force-* selectors remain in output');

mkdirSync(join(root, 'src', 'styles'), { recursive: true });
writeFileSync(join(root, 'src', 'styles', 'tokens.css'), tokens);
writeFileSync(join(root, 'src', 'styles', 'app.css'), appOut);
console.log('tokens.css:', tokens.length, 'bytes');
console.log('app.css:', appIn.length, '->', appOut.length, 'bytes;', dropped, 'force-* rules dropped,', trimmed, 'selector lists trimmed');
