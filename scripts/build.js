// Builds dist/float-fixer.single.html: all modules + CSS inlined, no network needed.
// Usage: node scripts/build.js
// Handles the import/export forms used in this repo (single-line imports,
// `export function|const|let|class`). Each module is wrapped in its own scope.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(root, 'src/ui/app.js');
const order = [], seen = new Set();

function visit(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/^import\s.+?from\s+'(.+?)';?\s*$/gm)) visit(resolve(dirname(file), m[1]));
  order.push(file);
}
visit(entry);

const id = (f) => JSON.stringify(relative(root, f));
const parts = order.map((file) => {
  let src = readFileSync(file, 'utf8');
  const prelude = [], names = [];
  src = src.replace(/^import\s+(.+?)\s+from\s+'(.+?)';?\s*$/gm, (_, what, spec) => {
    const dep = id(resolve(dirname(file), spec));
    if (what.startsWith('* as ')) prelude.push(`const ${what.slice(5)} = __m[${dep}];`);
    else prelude.push(`const ${what.replace(/\sas\s/g, ': ')} = __m[${dep}];`);
    return '';
  });
  src = src.replace(/^export\s+(async\s+)?(function|const|let|class)\s+(\w+)/gm, (_, a, kind, name) => { names.push(name); return `${a || ''}${kind} ${name}`; });
  if (/^export\s+(default|\{|\*)/m.test(src)) throw new Error(`Unsupported export form in ${file}`);
  if (/import\.meta|^\s*import\s/m.test(src)) throw new Error(`Unsupported import form in ${file}`);
  return `__m[${id(file)}] = (() => {\n${prelude.join('\n')}\n${src}\nreturn { ${names.join(', ')} };\n})();`;
});

const bundle = `const __m = {};\n${parts.join('\n')}\n`;
const css = readFileSync(resolve(root, 'src/ui/styles.css'), 'utf8');
let html = readFileSync(resolve(root, 'float-fixer.html'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="src\/ui\/styles.css">/, () => `<style>\n${css}</style>`);
html = html.replace(/<script type="module" src="src\/ui\/app.js"><\/script>/, () => `<script>\n${bundle.replace(/<\/script/gi, '<\\/script')}</script>`);
if (/(href|src)="src\//.test(html)) throw new Error('Build left an unresolved reference');
mkdirSync(resolve(root, 'dist'), { recursive: true });
const out = resolve(root, 'dist/float-fixer.single.html');
writeFileSync(out, html);
console.log(`wrote ${relative(root, out)} (${(html.length / 1024).toFixed(0)} KB, ${order.length} modules)`);
