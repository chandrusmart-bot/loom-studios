import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('single-file build produces a self-contained, parseable page', () => {
  execFileSync(process.execPath, ['scripts/build.js'], { cwd: new URL('..', import.meta.url).pathname });
  const html = readFileSync(new URL('../dist/float-fixer.single.html', import.meta.url), 'utf8');
  assert.ok(!/https?:\/\//.test(html), 'no network URLs');
  assert.ok(!/<script[^>]*src=/.test(html) && !/<link[^>]*stylesheet/.test(html), 'no external assets');
  const code = html.match(/<script>\n([\s\S]*)<\/script>/)[1];
  new vm.Script(code); // throws on syntax error
});
