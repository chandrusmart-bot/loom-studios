# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `node --test` runs all tests (single file: `node --test test/core2.test.js`).
- `node scripts/build.js` writes `dist/float-fixer.single.html` (gitignored).
- Serve the repo (`python3 -m http.server`) to open `float-fixer.html`; ES modules do not load from `file://`.

## Architecture

- `src/core/*`: pure logic. Data flow: `pipeline.buildTile` (resize → seamless → `quantize` → `despeckle`) → `analyze` (runs via `runs.findRuns`) → `fixer.fix` → `validator.validate` → `bmp.exportBmp`. `selftest.js` is shared by `node --test` and the in-app Self-test button.
- `src/ui/*`: DOM only (`app.js` state/wizard, `canvas-view.js` zoom/pan canvas).
- The fixer reports `binderMask`; the validator excludes binder-caused 1px blobs from the min-feature check (a binder is a 1px blob by construction).
- `scripts/build.js` only supports single-line imports and `export function|const|let|class`.

   ## Loom Float Fixer conventions
   - Vanilla ES modules, zero dependencies, no network calls, no localStorage.
   - Loom defaults: 960 hooks, 120px tile x 8 repeats, hook module 8, EPI/PPI 80.
   - Pure functions in /src/core (testable in Node, no DOM). DOM code only in /src/ui.
   - BMP: uncompressed indexed 1/4/8 bpp, bottom-up rows, BGRA palette, index 0 = background.
   - Run `node --test` before every commit. Never mark a phase done with failing tests.
   - Reuse existing engine/validator modules; do not duplicate logic.