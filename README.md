# loom-studios

## Loom Float Fixer

Converts a PNG/JPG/BMP into a jacquard-loom-ready indexed BMP, finds float violations and auto-fixes them. Vanilla ES modules, no dependencies, everything runs locally.

- **Run:** serve the repo (ES modules do not load from `file://`), e.g. `python3 -m http.server`, then open `float-fixer.html`.
- **Single file:** `node scripts/build.js` writes `dist/float-fixer.single.html`, which works from `file://`.
- **Test:** `node --test`. The in-app **Self-test** button runs the same core checks in the browser.
- **Layout:** pure logic in `src/core` (Node-testable), DOM code in `src/ui`.
