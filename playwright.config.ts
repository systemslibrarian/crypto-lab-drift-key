import { defineConfig, devices } from '@playwright/test';

/**
 * Both suites run against the PRODUCTION BUILD served by `vite preview`, so
 * what passes here is what ships.
 *
 *   a11y.spec.ts    the axe WCAG A/AA gate plus the oracles axe has no rule for
 *                   (arithmetic contrast, non-text contrast, reflow).
 *   claims.spec.ts  whether the page tells the truth: the headline claim
 *                   recomputed from the values on screen, every failure path,
 *                   and the negative claim's evidence fixture (template §4.1d).
 *
 * Port 4663 is unique to this lab across the fleet. Never the Vite default
 * 4173: with 200+ labs side by side a shared port means `reuseExistingServer`
 * silently scans a DIFFERENT lab's preview.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  timeout: 180_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4663/crypto-lab-drift-key/',
    colorScheme: 'dark', // dark is the only theme
  },
  projects: [
    { name: 'a11y', testMatch: /a11y\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'claims', testMatch: /claims\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // Build before serving. `vite preview` serves whatever is already in dist/,
    // so without the build in front a run tests a stale bundle -- and a build
    // that FAILS leaves the previous good bundle in place, so the whole suite
    // passes green against source that no longer compiles. That silently
    // invalidates mutation checking, which is the only way we prove a test has
    // teeth. With the build in front, a compile error aborts the run instead.
    command: 'npm run build && npm run preview -- --port 4663 --strictPort',
    url: 'http://localhost:4663/crypto-lab-drift-key/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
