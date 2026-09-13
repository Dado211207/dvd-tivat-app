import { defineConfig, devices } from '@playwright/test';

/**
 * Escape hatch for environments that already provide a Chromium build - a
 * sandbox or an image with a system browser. Unset (the normal case, including
 * CI) Playwright uses the browser it installed itself.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const launchOptions = executablePath ? { executablePath } : {};

// Chromium only. Installing three engines on a hosted runner costs minutes for
// no extra signal at this stage; the prototype has no engine-specific code.
export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Deterministic screenshots: no OS-level animation differences.
    reducedMotion: 'reduce',
    launchOptions,
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'] },
      testIgnore: /screenshots\.spec\.ts/,
    },
  ],
  webServer: [
    {
      command: 'npm run build && npm run preview',
      // Explicitly UNCONFIGURED, not merely unconfigured by accident. Most of
      // this suite asserts what the application says when no project is set up,
      // and CI happens to have no `.env.local` - but a developer does, and the
      // same tests then fail on their machine for a reason that has nothing to
      // do with their change. Pinning it makes the suite mean one thing
      // everywhere.
      env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' },
      // Both sides pinned to 127.0.0.1. Left as "localhost", the server can bind
      // to ::1 while this probe hits 127.0.0.1, and the run dies on a bare
      // "timed out waiting for webServer" with nothing to go on.
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      // Surface the server's own output so a startup failure is readable.
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // A SECOND build, configured against a project that does not exist.
      //
      // The server-backed screens are the ones that matter most, and the build
      // above can never render them: with no project configured they all stop
      // at the gate. This one is built as though a project were configured, and
      // `e2e/operational.spec.ts` answers every request to that host itself
      // with fixtures. Nothing real is contacted - the host is deliberately not
      // a project anybody owns - so it needs no credentials and runs in CI.
      command: 'npm run build:fixture && npm run preview:fixture',
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
