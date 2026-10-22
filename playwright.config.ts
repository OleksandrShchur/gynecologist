import { existsSync } from 'node:fs'
import path from 'node:path'
import { chromium, defineConfig } from '@playwright/test'

function browserExecutable(): string | undefined {
  if (process.env.CHROME_PATH) {
    if (!existsSync(process.env.CHROME_PATH)) throw new Error('CHROME_PATH must point to an installed Chrome or Edge executable.')
    return process.env.CHROME_PATH
  }
  if (existsSync(chromium.executablePath())) return undefined
  // Match the existing QA script: local runs can use an installed browser.
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    ...(process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe')] : []),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]
  return candidates.find(candidate => existsSync(candidate))
}

const executablePath = browserExecutable()
const basePath = `/${(process.env.VITE_BASE_PATH ?? '').split('/').filter(Boolean).join('/')}`.replace(/\/?$/, '/')
const baseURL = `http://127.0.0.1:4175${basePath}`

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Each desktop page owns a WebGL scene; avoid competing GPU contexts in CI.
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    browserName: 'chromium',
    locale: 'uk-UA',
    launchOptions: executablePath ? { executablePath } : {},
    actionTimeout: 8_000,
    navigationTimeout: 15_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'unit', testMatch: '**/seo.spec.ts' },
    {
      name: 'desktop',
      testMatch: '**/*.browser.spec.ts',
      use: { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 },
    },
    {
      name: 'mobile',
      testMatch: '**/*.browser.spec.ts',
      use: { viewport: { width: 375, height: 812 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4175 --strictPort',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
