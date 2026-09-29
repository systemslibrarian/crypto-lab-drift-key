import { defineConfig, configDefaults } from 'vitest/config';

// base must match the GitHub Pages project subpath:
// https://systemslibrarian.github.io/crypto-lab-drift-key/
export default defineConfig({
  base: '/crypto-lab-drift-key/',
  worker: { format: 'es' },
  test: {
    // Colocated unit tests only; keep the Playwright specs in e2e/ out of the
    // Vitest run (template §1: `test.include: ['src/**/*.test.ts']`).
    include: ['src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'e2e/**'],
    // The exhaustive BCH(15,7) sweeps in src/crypto/bch.test.ts decode ~74k
    // received words and cross-check each against a brute-force nearest-codeword
    // search. That is the point of the test, so it gets the time rather than a
    // smaller sweep. Vitest 4 measures elapsed time and enforces it (template §6.2).
    testTimeout: 120_000,
  },
});
