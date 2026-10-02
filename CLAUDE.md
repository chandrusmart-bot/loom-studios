# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

This repository is currently a bare scaffold: it contains only `README.md` (`# loom-studios`) and a single initial commit. There is no source code, build system, linter, or test suite yet, so there are no build/lint/test commands or architecture to document.

Once code is added, update this file with:
- Build, lint, and test commands (including how to run a single test)
- The high-level architecture that spans multiple files

   ## Loom Float Fixer conventions
   - Vanilla ES modules, zero dependencies, no network calls, no localStorage.
   - Loom defaults: 960 hooks, 120px tile x 8 repeats, hook module 8, EPI/PPI 80.
   - Pure functions in /src/core (testable in Node, no DOM). DOM code only in /src/ui.
   - BMP: uncompressed indexed 1/4/8 bpp, bottom-up rows, BGRA palette, index 0 = background.
   - Run `node --test` before every commit. Never mark a phase done with failing tests.
   - Reuse existing engine/validator modules; do not duplicate logic.