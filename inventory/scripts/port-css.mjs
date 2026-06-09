// Ports the prototype CSS into smart-pos verbatim, with exactly two transforms:
//  1. tokens.css: drop the Google Fonts @import (fonts are self-hosted via @fontsource)
//  2. app.css: remove rules whose selectors are ONLY .force-mobile/.force-desktop
//     (prototype tweaks tooling — the shell never gets those classes in production)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const proto = join(root, '..', 'src');

function stripForceRules(css) {
  let out = '';
  let i = 0;
  const n = css.length;
  while (i < n) {
    let j = i;
    while (j < n && css[j] !== '{' && css[j] !== '}') j++;
    if (j >= n) { out += css.slice(i); break; }
    if (css[j] === '}') { out += css.slice(i, j + 1); i = j + 1; continue; }
    const selector = css.slice(i, j);
    let depth = 1, k = j + 1;
    while (k < n && depth > 0) {
      if (css[k] === '{') depth++;
      else if (css[k] === '}') depth--;
      k++;
    }
    const body = css.slice(j + 1, k - 1);
    const sel = selector.trimStart();
    if (sel.startsWith('@media') || sel.startsWith('@supports')) {
      out += selector + '{' + stripForceRules(body) + '}';
    } else if (sel.startsWith('@')) {
      out += selector + '{' + body + '}';
    } else {
      const parts = selector.split(',');
      const kept = parts.filter(s => !s.includes('.force-mobile') && !s.includes('.force-desktop'));
      if (kept.length > 0) out += kept.join(',') + '{' + body + '}';
      else {
        // preserve a single newline so dropped rules don't glue neighbors together
        if (!out.endsWith('\n')) out += '\n';
      }
    }
    i = k;
  }
  return out;
}

const balance = (s) => (s.match(/{/g) || []).length - (s.match(/}/g) || []).length;

// --- tokens.css ---
let tokens = readFileSync(join(proto, 'ds', 'colors_and_type.css'), 'utf8');
const beforeImport = tokens.length;
tokens = tokens.replace(/^@import url\("https:\/\/fonts\.googleapis[^\n]*\n/m, '/* Fonts are self-hosted via @fontsource (imported in main.tsx) */\n');
if (tokens.length === beforeImport) throw new Error('Google Fonts @import not found/removed');

// --- app.css ---
const appIn = readFileSync(join(proto, 'styles.css'), 'utf8');
const appOut = stripForceRules(appIn);
if (balance(appOut) !== balance(appIn)) throw new Error('Brace balance changed: in=' + balance(appIn) + ' out=' + balance(appOut));
if (/\.force-(mobile|desktop)/.test(appOut)) throw new Error('force-* selectors remain in output');

mkdirSync(join(root, 'src', 'styles'), { recursive: true });
writeFileSync(join(root, 'src', 'styles', 'tokens.css'), tokens);
writeFileSync(join(root, 'src', 'styles', 'app.css'), appOut);
console.log('tokens.css:', tokens.length, 'bytes');
console.log('app.css:', appIn.length, '->', appOut.length, 'bytes; braces balanced:', balance(appOut) === 0 ? 'yes' : 'NO (' + balance(appOut) + ')');
