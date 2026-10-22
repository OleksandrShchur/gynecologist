import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const root = fileURLToPath(new URL('../', import.meta.url))
const label = process.argv[2] ?? 'current'
assert.match(label, /^[a-z0-9-]+$/)
const variants = process.argv.includes('--isolate') ? ['normal', 'no-refraction', 'no-shader', 'no-effects'] : ['normal']
const destination = path.join(root, '.qa', 'scroll')
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4174', '--strictPort'], { cwd: root, windowsHide: true, stdio: 'pipe' })
let browser
let serverOutput = ''
server.stdout.on('data', chunk => { serverOutput += chunk })
server.stderr.on('data', chunk => { serverOutput += chunk })

try {
  await mkdir(destination, { recursive: true })
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(server.exitCode, null, serverOutput)
    try { ready = (await fetch('http://127.0.0.1:4174/')).ok } catch {}
    if (ready) break
    await delay(100)
  }
  assert.ok(ready, 'Preview did not start')
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const results = []
  for (const variant of variants) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1.25 })
    if (variant === 'no-shader' || variant === 'no-effects') {
      await context.route('**/assets/HeroGradient-*.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'throw new Error("PROFILING_SHADER_DISABLED")' }))
    }
    const page = await context.newPage()
    await page.goto('http://127.0.0.1:4174/', { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    if (variant === 'no-refraction' || variant === 'no-effects') {
      await page.addStyleTag({ content: '.glass-decoration { display: none !important } .glass-fallback { backdrop-filter: none !important; -webkit-backdrop-filter: none !important }' })
    }
    // Warm the page once so first-entry lazy loading does not skew repeated scrolls.
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
    await page.waitForTimeout(1200)
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await page.waitForTimeout(2000)
    const client = await context.newCDPSession(page)
    await client.send('Performance.enable')
    const before = await client.send('Performance.getMetrics')
    const events = []
    client.on('Tracing.dataCollected', ({ value }) => events.push(...value))
    await client.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline.frame,blink,cc,gpu', transferMode: 'ReportEvents' })
    await page.evaluate(() => {
      window.__scrollProfile = { intervals: [], longTasks: [], running: true, previous: performance.now() }
      const state = window.__scrollProfile
      state.observer = new PerformanceObserver(list => state.longTasks.push(...list.getEntries().map(entry => entry.duration)))
      state.observer.observe({ type: 'longtask', buffered: false })
      const sample = now => {
        if (!state.running) return
        state.intervals.push(now - state.previous)
        state.previous = now
        requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
    // Trusted wheel input exercises the compositor scroll path rather than a JS scroll loop.
    await page.mouse.move(720, 500)
    for (let cycle = 0; cycle < 2; cycle++) {
      for (const direction of [1, -1]) {
        for (let step = 0; step < 12; step++) {
          await page.mouse.wheel(0, direction * 110)
          await page.waitForTimeout(24)
        }
      }
    }
    await page.waitForTimeout(200)
    const sample = await page.evaluate(() => {
      const state = window.__scrollProfile
      state.running = false
      state.observer.disconnect()
      return { intervals: state.intervals, longTasks: state.longTasks, decorationCount: document.querySelectorAll('.glass-decoration').length, canvasRendering: document.querySelector('.page-background canvas')?.dataset.rendering }
    })
    const after = await client.send('Performance.getMetrics')
    const completed = new Promise(resolve => client.once('Tracing.tracingComplete', resolve))
    await client.send('Tracing.end')
    await completed
    await writeFile(path.join(destination, `${label}-${variant}-trace.json`), JSON.stringify({ traceEvents: events }))
    const sorted = [...sample.intervals].sort((a, b) => a - b)
    const metric = (metrics, name) => metrics.metrics.find(entry => entry.name === name)?.value ?? 0
    const eventTotals = Object.fromEntries(['Paint', 'Layout', 'UpdateLayoutTree', 'RasterTask', 'DrawFrame', 'FireAnimationFrame'].map(name => {
      const matching = events.filter(event => event.name === name && event.ph === 'X')
      return [name, { count: matching.length, totalMs: Math.round(matching.reduce((sum, event) => sum + (event.dur ?? 0), 0) / 1000) }]
    }))
    const result = {
      variant,
      frames: sorted.length,
      frameIntervalP50: Math.round(sorted[Math.floor(sorted.length * 0.5)] * 10) / 10,
      frameIntervalP95: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 10) / 10,
      framesOver34ms: sorted.filter(interval => interval > 34).length,
      longTasks: sample.longTasks.length,
      longestTaskMs: Math.round(Math.max(0, ...sample.longTasks)),
      scriptMs: Math.round((metric(after, 'ScriptDuration') - metric(before, 'ScriptDuration')) * 1000),
      taskMs: Math.round((metric(after, 'TaskDuration') - metric(before, 'TaskDuration')) * 1000),
      eventTotals,
      decorationCount: sample.decorationCount,
    }
    results.push(result)
    console.log(JSON.stringify(result))
    await context.close()
  }
  await writeFile(path.join(destination, `${label}.json`), JSON.stringify(results, null, 2))
} finally {
  await browser?.close()
  server.kill()
}
