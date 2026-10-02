import test from 'node:test';
import { TESTS } from '../src/core/selftest.js';

for (const [name, fn] of TESTS) test(`selftest: ${name}`, () => { fn(); });
