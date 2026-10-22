import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import lighthouse from 'lighthouse'
import { Launcher } from 'chrome-launcher'

const root = fileURLToPath(new URL('../', import.meta.url))
const artifactDirectory = path.join(root, '.qa')
const baseUrl = process.env.QA_BASE_URL ?? 'http://127.0.0.1:4173/'
const instagramUrl = 'https://www.instagram.com/o.perhulyn/'
const expectedMotto = 'Доказово. Без стресу. З турботою.'
const accessibilityTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const viewportCases = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'wide-desktop', width: 1920, height: 1080 },
  { name: 'mobile', width: 375, height: 812, touch: true },
  { name: 'small-mobile', width: 320, height: 740 },
  { name: 'tablet', width: 768, height: 1024, touch: true },
  { name: 'compact-tablet', width: 728, height: 486 },
  { name: 'large-tablet', width: 920, height: 608 },
  { name: 'small-desktop', width: 1024, height: 900 },
  { name: 'landscape-mobile', width: 812, height: 375 },
]
const failures = []
const summary = { baseUrl, viewports: [], hero: [], shaderFallback: null, accessibility: [], scrollReveals: null, noJavaScript: null, reducedMotion: null, lighthouse: null }
let preview
let previewOutput = ''
let browser
let lighthouseChrome
let cleanupPromise

function browserExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]
  const executable = candidates.find((candidate) => candidate && existsSync(candidate))
  assert.ok(executable, 'Chrome or Edge was not found. Set CHROME_PATH to an installed browser executable.')
  return executable
}

async function ensurePortAvailable(port, host) {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => server.close((error) => error ? reject(error) : resolve()))
  })
}

async function waitUntilReady() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (preview && preview.exitCode !== null) {
      throw new Error(`The preview server exited with code ${preview.exitCode}.\n${previewOutput}`)
    }
    try {
      const response = await fetch(baseUrl, { signal: AbortSignal.timeout(1500) })
      if (response.ok) return
    } catch {
      // Vite needs a moment to start. The deadline below still fails a missing server.
    }
    await delay(150)
  }
  throw new Error(`The preview server did not become ready at ${baseUrl}.\n${previewOutput}`)
}

async function startPreview() {
  assert.ok(existsSync(path.join(root, 'dist/index.html')), 'Build the site with npm run build before running QA.')
  if (!process.env.QA_BASE_URL) {
    await ensurePortAvailable(4173, '127.0.0.1')
    preview = spawn(process.execPath, [
      path.join(root, 'node_modules/vite/bin/vite.js'), 'preview',
      '--host', '127.0.0.1', '--port', '4173', '--strictPort',
    ], { cwd: root, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    preview.on('error', (error) => { previewOutput += `${error.message}\n` })
    for (const stream of [preview.stdout, preview.stderr]) {
      stream.on('data', (data) => { previewOutput = (previewOutput + data.toString()).slice(-20_000) })
    }
  }
  await waitUntilReady()
}

function cleanup() {
  cleanupPromise ??= (async () => {
    if (browser) await browser.close().catch(() => {})
    if (lighthouseChrome) lighthouseChrome.kill()
    if (preview && preview.exitCode === null) {
      const stopped = new Promise((resolve) => preview.once('close', resolve))
      preview.kill()
      await Promise.race([stopped, delay(3000)])
      if (preview.exitCode === null) preview.kill('SIGKILL')
    }
  })()
  return cleanupPromise
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { void cleanup().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143)) })
}

function observePage(page) {
  const observations = { consoleErrors: [], pageErrors: [], externalRequests: [], failedRequests: [] }
  page.on('console', (message) => {
    if (message.type() === 'error') observations.consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => observations.pageErrors.push(error.message))
  page.on('requestfailed', (request) => observations.failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`))
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      observations.externalRequests.push(request.url())
    }
  })
  return observations
}

async function settlePage(page, beforeScroll) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  if (beforeScroll) await beforeScroll()
  // Visit the entire page so lazy images and one-time reveals have settled before capture.
  let position = 0
  while (position < await page.evaluate(() => document.documentElement.scrollHeight)) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), position)
    await page.waitForTimeout(100)
    position += Math.max(240, Math.round(page.viewportSize().height * 0.75))
  }
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
  await page.waitForTimeout(550)
  await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete))
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await page.waitForTimeout(350)
}

async function readContentVisibility(page) {
  return page.evaluate(() => {
    const content = Array.from(document.querySelectorAll('h1, h2, h3, .animate-on-scroll, .direction-card, .principle, .about-copy, .contact-panel'))
    return {
      revealCount: document.querySelectorAll('.animate-on-scroll').length,
      pendingReveals: document.querySelectorAll('.animate-on-scroll[data-scroll-state="pending"], .animate-on-scroll[data-scroll-state="running"]').length,
      hiddenContent: content.filter((element) => {
        if (element.getBoundingClientRect().width === 0 || element.getBoundingClientRect().height === 0) return true
        for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor)
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.99) return true
        }
        return false
      }).map((element) => ({ tag: element.tagName, className: element.className, text: element.textContent.trim().slice(0, 100) })),
      runningAnimations: document.getAnimations().filter((animation) => animation.playState === 'running' || animation.pending).map((animation) => animation.animationName ?? animation.id),
    }
  })
}

async function nextPaints(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

async function preparePreviewCapture(page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
  await page.mouse.move(0, 0)
  await nextPaints(page)
}

async function assertPageBackground(page, name) {
  const staticHtml = name === 'no-javascript'
  const read = () => page.locator('.page-background').evaluate(element => {
    const rect = element.getBoundingClientRect()
    const layer = element.querySelector('.page-gradient-fallback')
    const animation = layer.getAnimations()[0]
    return {
      x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      viewportWidth: innerWidth, viewportHeight: innerHeight,
      position: getComputedStyle(element).position,
      pointerEvents: getComputedStyle(element).pointerEvents,
      hidden: element.getAttribute('aria-hidden'),
      motion: element.dataset.motion,
      floating: element.dataset.floating,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      touch: matchMedia('(pointer: coarse)').matches,
      canvasCount: element.querySelectorAll('canvas').length,
      transform: getComputedStyle(layer).transform,
      animation: animation ? {
        name: animation.animationName,
        time: animation.currentTime,
        duration: animation.effect.getTiming().duration,
        playState: animation.playState,
        properties: [...new Set(animation.effect.getKeyframes().flatMap(frame => Object.keys(frame).filter(key => !['offset', 'computedOffset', 'easing', 'composite'].includes(key))))],
      } : null,
    }
  })
  const coversViewport = state => {
    assert.equal(state.position, 'fixed', `${name}: the shared gradient must follow the viewport`)
    assert.ok(Math.abs(state.x) <= 1 && Math.abs(state.y) <= 1, `${name}: the shared gradient must cover the viewport origin`)
    assert.ok(Math.abs(state.width - state.viewportWidth) <= 1 && Math.abs(state.height - state.viewportHeight) <= 1, `${name}: the gradient must cover the full viewport`)
    assert.equal(state.pointerEvents, 'none', `${name}: the decorative gradient must not intercept input`)
    assert.equal(state.hidden, 'true', `${name}: the gradient must stay hidden from assistive technology`)
    assert.ok(state.canvasCount <= 1, `${name}: the entire page must share at most one canvas`)
  }
  const top = await read()
  coversViewport(top)
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
  if (!staticHtml) {
    await waitForScrollSettled(page)
    await page.waitForFunction(() => {
      const backdrop = document.querySelector('.page-background')
      return !document.documentElement.hasAttribute('data-scrolling')
        && (backdrop?.dataset.motion === 'disabled' || backdrop?.dataset.floating === 'active' || backdrop?.querySelector('canvas')?.dataset.rendering === 'active')
    })
  }
  const footer = await read()
  coversViewport(footer)
  const floatingTouch = !staticHtml && !footer.reducedMotion && (footer.touch || footer.viewportWidth < 768)
  let floatingAnimation
  if (floatingTouch) {
    floatingAnimation = await page.locator('.page-gradient-fallback').evaluateHandle(layer => layer.getAnimations()[0])
    assert.equal(footer.canvasCount, 0, `${name}: touch and narrow layouts must use the lightweight floating gradient`)
    assert.equal(footer.floating, 'active', `${name}: the gradient must float beyond the hero`)
    assert.equal(footer.animation?.name, 'page-gradient-float', `${name}: the CSS gradient must have its floating animation`)
    assert.ok(footer.animation.duration >= 28_000, `${name}: the floating gradient must move slowly`)
    assert.deepEqual(footer.animation.properties, ['transform'], `${name}: background motion must animate only its transform`)
    await page.waitForTimeout(200)
    assert.notEqual((await read()).transform, footer.transform, `${name}: the touch gradient must visibly change position over time`)
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  if (floatingTouch) {
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-scrolling')
      && document.querySelector('.page-background')?.dataset.floating === 'paused'
      && document.querySelector('.page-gradient-fallback')?.getAnimations().every(animation => animation.playState === 'paused'))
    const paused = await read()
    assert.equal(paused.animation.playState, 'paused', `${name}: the floating layer must pause during scrolling`)
    assert.ok(paused.animation.time >= footer.animation.time, `${name}: scrolling must not rewind the floating animation`)
    assert.equal(await floatingAnimation.evaluate(animation => animation === document.querySelector('.page-gradient-fallback').getAnimations()[0]), true, `${name}: scrolling must retain the same CSS animation`)
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-scrolling') && document.querySelector('.page-background')?.dataset.floating === 'active')
    await page.waitForFunction(time => document.querySelector('.page-gradient-fallback').getAnimations()[0]?.currentTime > time, paused.animation.time)
    assert.equal(await floatingAnimation.evaluate(animation => animation === document.querySelector('.page-gradient-fallback').getAnimations()[0]), true, `${name}: resuming must retain the same CSS animation`)
  } else if (!staticHtml) {
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-scrolling'))
  }
  if (['desktop', 'mobile', 'tablet'].includes(name)) {
    // Capture the naturally moving background after motion assertions: disabling
    // infinite animations for screenshots can override their CSS pause state.
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
    await waitForScrollSettled(page)
    await page.waitForTimeout(750)
    await page.screenshot({ path: path.join(artifactDirectory, `${name}-page-gradient.png`) })
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await waitForScrollSettled(page)
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-scrolling'))
  }
  return { top, footer, floatingTouch }
}

async function assertGlassSurfaces(page, { enhanced, reducedMotion = false, aboveFoldOnly = false, staticHtml = false }) {
  const selector = aboveFoldOnly
    ? '.header-contact-glass, .hero-cta-glass, .hero-photo-glass'
    : '.header-contact-glass, .hero-cta-glass, .hero-photo-glass, .about-photo-glass, .direction-glass, .principle-glass, .contact-glass, .footer-top-glass'
  const expectedCount = aboveFoldOnly ? 3 : 15
  const surfaces = page.locator(selector)
  assert.equal(await surfaces.count(), expectedCount, 'All requested interactive surfaces must have one glass shell')
  if (!staticHtml) await preparePreviewCapture(page)
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-scrolling'))
  await page.waitForFunction(({ selector, expectedCount }) => {
    const shells = [...document.querySelectorAll(selector)]
    return shells.length === expectedCount && shells.every((shell) => shell.dataset.glass === 'fallback')
  }, { selector, expectedCount }, { timeout: 10_000 })
  const result = await surfaces.evaluateAll((shells) => shells.map((shell) => ({
    contact: shell.classList.contains('contact-glass'),
    information: shell.classList.contains('information-glass'),
    state: shell.dataset.glass,
    elasticity: Number(shell.dataset.glassElasticity),
    displacementFilters: shell.querySelectorAll('.glass-decoration svg filter feDisplacementMap').length,
    decorativeHidden: [...shell.querySelectorAll('.glass-decoration')].every((decoration) => decoration.getAttribute('aria-hidden') === 'true'),
    decorativeControls: shell.querySelectorAll('.glass-decoration a[href], .glass-decoration button, .glass-decoration [tabindex]:not([tabindex="-1"])').length,
    canvases: shell.querySelectorAll('canvas').length,
  })))
  for (const surface of result) {
    assert.equal(surface.canvases, 0, 'Liquid Glass must not create another WebGL canvas')
    assert.equal(surface.decorativeControls, 0, 'Glass decoration must not duplicate keyboard controls')
    assert.equal(surface.decorativeHidden, true, 'Glass decoration must be hidden from assistive technology')
    assert.equal(surface.displacementFilters, 0, 'Resting surfaces must not keep expensive refraction filters mounted')
    assert.equal(surface.elasticity, 0, 'Resting surfaces must remain static')
  }
  const interactionChecks = []
  if (enhanced && !reducedMotion) {
    const samples = aboveFoldOnly
      ? ['.header-contact-glass', '.hero-cta-glass', '.hero-photo-glass']
      : ['.header-contact-glass', '.hero-cta-glass', '.hero-photo-glass', '.about-photo-glass', '.direction-glass', '.principle-glass', '.contact-glass', '.footer-top-glass']
    for (const sample of samples) {
      const target = page.locator(sample).first()
      await target.scrollIntoViewIfNeeded()
      await page.waitForFunction(() => !document.documentElement.hasAttribute('data-scrolling'))
      await target.hover()
      await page.waitForFunction((selector) => document.querySelector(selector)?.dataset.glass === 'enhanced', sample)
      const state = await target.evaluate(element => ({
        filters: element.querySelectorAll('.glass-decoration svg filter feDisplacementMap').length,
        elasticity: Number(element.dataset.glassElasticity),
        decorationHidden: element.querySelector('.glass-decoration')?.getAttribute('aria-hidden'),
        decorativeControls: element.querySelectorAll('.glass-decoration a[href], .glass-decoration button, .glass-decoration [tabindex]:not([tabindex="-1"])').length,
        totalDecorations: document.querySelectorAll('.glass-decoration').length,
        photosClear: [...element.querySelectorAll('img')].every((image) => {
          const content = image.closest('.glass-content')
          const decoration = element.querySelector('.glass-decoration')
          for (let node = image; node && node !== element; node = node.parentElement) {
            const style = getComputedStyle(node)
            if (style.filter !== 'none' || style.backdropFilter !== 'none') return false
          }
          return content && Number(getComputedStyle(content).zIndex) > Number(getComputedStyle(decoration).zIndex)
        }),
      }))
      assert.ok(state.filters > 0, 'Hovered surfaces must still use real Liquid Glass refraction')
      assert.equal(state.elasticity, 0.12, 'Interactive glass must retain its restrained elasticity')
      assert.equal(state.decorationHidden, 'true', 'Interactive decoration must stay hidden from assistive technology')
      assert.equal(state.decorativeControls, 0, 'Interactive decoration must not add keyboard controls')
      assert.equal(state.totalDecorations, 1, 'Only the hovered surface may mount refraction')
      assert.equal(state.photosClear, true, 'Photos must remain unfiltered above the glass refraction layer')
      interactionChecks.push({ selector: sample, ...state })
      await page.mouse.move(0, 0)
    }
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-scrolling') && document.querySelectorAll('.glass-decoration').length === 0)
  }
  return { resting: result, interactionChecks }
}

async function assertPageStructure(page, name) {
  const structure = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a[href]'))
    const header = document.querySelector('.site-header')
    const rectangle = (element) => {
      const bounds = element.getBoundingClientRect()
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, right: bounds.right, bottom: bounds.bottom }
    }
    const heroCopy = document.querySelector('.hero-copy')
    const heroHeading = document.querySelector('.hero-heading')
    const primaryControls = [...document.querySelectorAll('a[href], summary')]
      .filter((element) => !element.matches('.skip-link:not(:focus)'))
      .map((element) => ({
      label: element.getAttribute('aria-label') || element.textContent.trim().replace(/\s+/g, ' '),
      bounds: rectangle(element),
      fontSize: parseFloat(getComputedStyle(element).fontSize),
    })).filter(({ bounds }) => bounds.width > 0 && bounds.height > 0)
    const headerControls = [...header.querySelectorAll('.wordmark, .header-contact, .desktop-navigation, .mobile-navigation > summary')]
      .map((element) => {
        const bounds = element.getBoundingClientRect()
        return { className: element.className, width: bounds.width, height: bounds.height, centerY: bounds.y + bounds.height / 2 }
      }).filter((bounds) => bounds.width > 0 && bounds.height > 0)
    return {
      lang: document.documentElement.lang,
      title: document.title,
      headings: Array.from(document.querySelectorAll('h1'), (heading) => heading.textContent.replace(/\s+/g, ' ').trim()),
      directions: document.querySelectorAll('#napriamy .direction-card').length,
      principles: document.querySelectorAll('#pidkhid .principle-glass').length,
      width: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      headerHeight: header.getBoundingClientRect().height,
      headerControls,
      primaryControls,
      heroLayout: {
        sideBySide: matchMedia('(min-width: 640px)').matches,
        layout: rectangle(document.querySelector('.hero-layout')),
        copy: rectangle(heroCopy),
        photoStage: rectangle(document.querySelector('.hero-doctor')),
        action: rectangle(document.querySelector('.hero-actions .instagram-link')),
        heading: rectangle(heroHeading),
        headingAlignment: getComputedStyle(heroHeading).textAlign,
        subtitleFontSize: parseFloat(getComputedStyle(document.querySelector('.hero-subtitle')).fontSize),
        portraitInsideGlass: Boolean(document.querySelector('.hero-doctor img')?.closest('.glass-surface')),
      },
      forms: document.querySelectorAll('form, input, textarea, select').length,
      sections: ['napriamy', 'pidkhid', 'pro-likaria', 'kontakty'].map((id) => ({ id, exists: Boolean(document.getElementById(id)) })),
      invalidAnchors: anchors.filter((anchor) => anchor.getAttribute('href').startsWith('#')).map((anchor) => anchor.getAttribute('href')).filter((href) => href.length < 2 || !document.getElementById(decodeURIComponent(href.slice(1)))),
      instagram: anchors.filter((anchor) => anchor.href.includes('instagram.com')).map((anchor) => {
        const fixedAncestors = []
        for (let element = anchor; element; element = element.parentElement) {
          if (['fixed', 'sticky'].includes(getComputedStyle(element).position)) fixedAncestors.push(element.className || element.tagName)
        }
        return {
          href: anchor.href,
          target: anchor.target,
          rel: anchor.rel.split(/\s+/),
          location: anchor.closest('.hero-actions') ? 'hero' : anchor.closest('#kontakty') ? 'contacts' : anchor.closest('#pro-likaria') ? 'about' : anchor.closest('.site-header') ? 'header' : 'other',
          fixedAncestors,
        }
      }),
      headerContacts: anchors.filter((anchor) => anchor.closest('.site-header') && anchor.getAttribute('href') === '#kontakty').map((anchor) => ({ href: anchor.getAttribute('href'), label: anchor.textContent.trim(), target: anchor.target })),
      mobileInstagramNodes: document.querySelectorAll('.mobile-instagram').length,
      images: Array.from(document.images, (image) => ({
        src: image.currentSrc,
        loaded: image.complete && image.naturalWidth > 0,
        alt: image.alt,
        altAttribute: image.getAttribute('alt'),
        hiddenFromAssistiveTechnology: Boolean(image.closest('[aria-hidden="true"]')),
        width: image.getAttribute('width'),
        height: image.getAttribute('height'),
        role: image.closest('.about-photo') ? 'standing' : image.closest('.hero-doctor') ? 'portrait' : null,
        srcSet: image.srcset,
        sizes: image.sizes,
        loading: image.loading,
        fetchPriority: image.fetchPriority,
      })),
      emptyLinks: anchors.filter((anchor) => !(anchor.textContent.trim() || anchor.getAttribute('aria-label') || anchor.querySelector('img[alt]'))).map((anchor) => anchor.outerHTML),
    }
  })
  assert.equal(structure.lang, 'uk', `${name}: html lang must be uk`)
  assert.ok(structure.title.includes('Оксана'), `${name}: a Ukrainian doctor title is required`)
  assert.deepEqual(structure.headings, [expectedMotto], `${name}: exactly one H1 containing the supplied motto is required`)
  assert.equal(structure.directions, 6, `${name}: exactly six direction cards are required`)
  assert.equal(structure.principles, 3, `${name}: exactly three glass principle cards are required`)
  assert.ok(Math.max(structure.documentWidth, structure.bodyWidth) <= structure.width + 1, `${name}: horizontal overflow (${structure.documentWidth}/${structure.bodyWidth} > ${structure.width})`)
  assert.ok(structure.headerHeight > 0 && structure.headerHeight <= 96, `${name}: the closed header must remain compact and fit one row (${structure.headerHeight}px)`)
  assert.equal(structure.headerControls.length, 3, `${name}: the header must show the brand, contact action and one navigation control`)
  const headerCenters = structure.headerControls.map((control) => control.centerY)
  assert.ok(Math.max(...headerCenters) - Math.min(...headerCenters) <= 2, `${name}: the visible header controls must align on one row (${JSON.stringify(structure.headerControls)})`)
  for (const control of structure.primaryControls) {
    assert.ok(control.bounds.width >= 44 && control.bounds.height >= 44, `${name}: primary control must offer a 44px target (${control.label}: ${control.bounds.width}×${control.bounds.height})`)
    assert.ok(control.fontSize >= 12, `${name}: essential control text must be at least 12px (${control.label})`)
  }
  const hero = structure.heroLayout
  assert.ok(hero.sideBySide ? ['left', 'start'].includes(hero.headingAlignment) : hero.headingAlignment === 'center', `${name}: hero copy must align with its responsive composition`)
  assert.ok(hero.subtitleFontSize >= 16, `${name}: the hero supporting text must be at least 16px`)
  assert.equal(hero.portraitInsideGlass, true, `${name}: the hero portrait must have a Liquid Glass frame`)
  assert.ok(hero.action.x >= hero.copy.x - 1 && hero.action.right <= hero.copy.right + 1, `${name}: the hero action must stay inside the copy column`)
  for (const bounds of [hero.copy, hero.photoStage]) {
    assert.ok(bounds.x >= hero.layout.x - 1 && bounds.right <= hero.layout.right + 1, `${name}: hero content must stay inside its layout`)
  }
  if (hero.sideBySide) {
    assert.ok(Math.abs(hero.action.x - hero.heading.x) <= 2, `${name}: the hero action must align with its copy`)
    assert.ok(hero.copy.right <= hero.photoStage.x + 1, `${name}: tablet and desktop heroes must place copy left and portrait right`)
  } else {
    assert.ok(hero.photoStage.bottom <= hero.copy.y + 1, `${name}: the mobile hero must stack its portrait before its copy`)
    assert.ok(Math.abs(hero.action.x + hero.action.width / 2 - (hero.copy.x + hero.copy.width / 2)) <= 2, `${name}: the mobile hero action must center within the copy`)
  }
  assert.equal(structure.forms, 0, `${name}: informational page must not contain forms or form controls`)
  assert.ok(structure.sections.every((section) => section.exists), `${name}: every requested section must exist`)
  assert.deepEqual(structure.invalidAnchors, [], `${name}: every internal anchor must resolve`)
  assert.deepEqual(structure.emptyLinks, [], `${name}: links must have accessible text`)
  assert.equal(structure.instagram.length, 2, `${name}: the page must contain exactly two external Instagram links`)
  assert.equal(structure.instagram.filter((link) => link.location === 'hero').length, 1, `${name}: the hero must contain one Instagram action`)
  assert.equal(structure.instagram.filter((link) => link.location === 'contacts').length, 1, `${name}: Contacts must contain one Instagram link`)
  assert.equal(structure.instagram.filter((link) => link.location === 'about' || link.location === 'header').length, 0, `${name}: About and Header must not repeat external Instagram links`)
  assert.equal(structure.mobileInstagramNodes, 0, `${name}: the fixed mobile Instagram button must be absent from the DOM`)
  assert.deepEqual(structure.headerContacts, [{ href: '#kontakty', label: 'Контакти', target: '' }], `${name}: the Header contact action must link to the Contacts section in the current page`)
  for (const link of structure.instagram) {
    assert.equal(link.href, instagramUrl, `${name}: Instagram URL must match supplied doctor data`)
    assert.equal(link.target, '_blank', `${name}: Instagram must open in a new tab`)
    assert.ok(link.rel.includes('noopener') && link.rel.includes('noreferrer'), `${name}: external links require noopener noreferrer`)
    assert.deepEqual(link.fixedAncestors, [], `${name}: Instagram links must not use fixed or sticky positioning`)
  }
  assert.equal(structure.images.length, 2, `${name}: the page must render the supplied hero portrait and standing About photo`)
  assert.equal(structure.images.filter((image) => image.role === 'portrait').length, 1, `${name}: exactly one doctor portrait is required in the hero`)
  assert.equal(structure.images.filter((image) => image.role === 'standing').length, 1, `${name}: exactly one standing photo is required in About`)
  assert.equal(structure.images.filter((image) => image.role === 'decoration').length, 0, `${name}: decorative flower must be removed from the hero`)
  for (const image of structure.images) {
    assert.ok(image.loaded, `${name}: broken image ${image.src}`)
    assert.ok(image.alt.trim(), `${name}: doctor photos need meaningful alt text`)
    assert.equal(image.hiddenFromAssistiveTechnology, false, `${name}: real doctor photos must remain available to assistive technology`)
    assert.ok(Number(image.width) > 0 && Number(image.height) > 0, `${name}: image dimensions must reserve layout space`)
    assert.ok(image.sizes.trim(), `${name}: ${image.role} photo needs responsive sizes`)
    const expectedSourceName = image.role === 'portrait' ? 'photo-portrait-' : 'photo-standing-'
    const currentSource = new URL(image.src)
    assert.equal(currentSource.origin, new URL(baseUrl).origin, `${name}: doctor photos must be hosted locally`)
    assert.ok(currentSource.pathname.includes(expectedSourceName) && currentSource.pathname.endsWith('.webp'), `${name}: ${image.role} must use its supplied, optimized WebP photo`)
    const candidates = image.srcSet.split(',').map((candidate) => candidate.trim().split(/\s+/))
    assert.ok(candidates.length >= 3, `${name}: ${image.role} photo needs at least three responsive sizes`)
    assert.equal(new Set(candidates.map((candidate) => candidate[1])).size, candidates.length, `${name}: responsive image sizes must be distinct`)
    for (const [source, descriptor] of candidates) {
      const sourceUrl = new URL(source, baseUrl)
      assert.ok(/^\d+w$/.test(descriptor), `${name}: photo srcset must use width descriptors`)
      assert.equal(sourceUrl.origin, new URL(baseUrl).origin, `${name}: every photo variant must be local`)
      assert.ok(sourceUrl.pathname.includes(expectedSourceName) && sourceUrl.pathname.endsWith('.webp'), `${name}: every responsive candidate must use the correct optimized photo`)
    }
    if (image.role === 'portrait') {
      assert.equal(image.loading, 'eager', `${name}: the first-screen portrait must load eagerly`)
      assert.equal(image.fetchPriority, 'high', `${name}: the first-screen portrait must have high fetch priority`)
    } else {
      assert.equal(image.loading, 'lazy', `${name}: the About photo must load lazily`)
    }
  }
  const backgroundCount = await page.locator('.page-background').count()
  assert.equal(backgroundCount, 1, `${name}: the entire page must share one decorative backdrop`)
  assert.equal(await page.locator('.story-flower, .story-scene').count(), 0, `${name}: the flower ornament must be absent`)
  const background = await assertPageBackground(page, name)
  return { name, viewport: page.viewportSize(), headerHeight: structure.headerHeight, primaryControlCount: structure.primaryControls.length, heroLayout: hero, background, directionCards: structure.directions, imageCount: structure.images.length, doctorPhotoCount: 2, decorativeImageCount: 0, instagramLinks: structure.instagram.length, contactInstagramLinks: structure.instagram.filter((link) => link.location === 'contacts').length, fixedInstagramLinks: 0, horizontalOverflow: false }
}

async function waitForScrollSettled(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const started = performance.now()
    let previousX = window.scrollX
    let previousY = window.scrollY
    let stableSince = started
    function sample(now) {
      if (Math.abs(window.scrollX - previousX) > 0.1 || Math.abs(window.scrollY - previousY) > 0.1) stableSince = now
      previousX = window.scrollX
      previousY = window.scrollY
      if (now - stableSince >= 150) {
        resolve({ x: previousX, y: previousY, duration: Math.round(now - started) })
      } else if (now - started >= 5000) {
        reject(new Error(`Scrolling did not settle within 5 seconds (x=${previousX}, y=${previousY})`))
      } else {
        requestAnimationFrame(sample)
      }
    }
    requestAnimationFrame(sample)
  }))
}

async function assertKeyboardNavigation(page) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await waitForScrollSettled(page)
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('skip-link')), true, 'The first Tab must focus the skip link')
  const skipBounds = await page.locator('.skip-link').boundingBox()
  assert.ok(skipBounds && skipBounds.y >= 0, 'The focused skip link must be visible')
  assert.ok(skipBounds.width >= 44 && skipBounds.height >= 44, 'The focused skip link must offer a 44px touch target')
  await page.keyboard.press('Enter')
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'main', 'The skip link must move keyboard focus to main')
  // The skip link also starts a native smooth scroll. Its completion must precede
  // focusing a header link, just as subsequent focus scrolls precede activation.
  await page.waitForFunction(() => {
    const main = document.getElementById('main')
    const inset = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0
    return main && Math.abs(main.getBoundingClientRect().top - inset) <= 2
  }, undefined, { timeout: 5000 })
  await waitForScrollSettled(page)
  const navLinks = page.locator('.desktop-navigation a')
  assert.equal(await navLinks.count(), 3, 'The header must offer all three requested anchor links')
  const destinations = []
  for (const link of await navLinks.all()) {
    const href = await link.getAttribute('href')
    await link.focus()
    // Native focus scrolling can begin after an initially stable frame interval,
    // especially while the returning hero recreates its WebGL renderer. Require
    // the focused link to reach the viewport before measuring scroll stability.
    await page.waitForFunction((href) => {
      const link = [...document.querySelectorAll('.desktop-navigation a')].find((element) => element.getAttribute('href') === href)
      if (!link || document.activeElement !== link) return false
      const bounds = link.getBoundingClientRect()
      return bounds.y >= -1 && bounds.bottom <= innerHeight + 1
    }, href, { timeout: 5000 })
    // Let that focus scroll finish before Enter starts a destination scroll.
    const focusScroll = await waitForScrollSettled(page)
    const linkBounds = await link.boundingBox()
    assert.ok(linkBounds && linkBounds.y >= -1 && linkBounds.y + linkBounds.height <= page.viewportSize().height + 1, `Focused keyboard link ${href} must be fully visible before activation (${JSON.stringify({ bounds: linkBounds, scroll: focusScroll, hash: await page.evaluate(() => location.hash) })})`)
    assert.equal(await link.evaluate((element) => element.matches(':focus-visible')), true, 'Keyboard navigation links must expose a visible focus state')
    await page.keyboard.press('Enter')
    await page.waitForFunction((hash) => window.location.hash === hash, href)
    await page.waitForFunction((href) => {
      const section = document.querySelector(href)
      const bounds = section.getBoundingClientRect()
      const padding = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0
      const margin = parseFloat(getComputedStyle(section).scrollMarginTop) || 0
      const destination = Math.max(0, Math.min(document.documentElement.scrollHeight - innerHeight, bounds.top + scrollY - padding - margin))
      return Math.abs(scrollY - destination) <= 2
    }, href, { timeout: 5000 })
    const scroll = await waitForScrollSettled(page)
    const bounds = await page.locator(href).boundingBox()
    assert.ok(bounds && bounds.y >= -1 && bounds.y < page.viewportSize().height, `Keyboard anchor ${href} must scroll its section into view (top=${bounds?.y}, scrollY=${scroll.y})`)
    await page.waitForFunction((href) => [...document.querySelectorAll('.desktop-navigation a')].find((element) => element.getAttribute('href') === href)?.getAttribute('aria-current') === 'location', href, { timeout: 5000 })
    assert.equal(await link.getAttribute('aria-current'), 'location', `The desktop navigation must identify ${href} as the current section`)
    destinations.push({ href, top: bounds.y, scroll, ariaCurrent: await link.getAttribute('aria-current') })
  }
  return destinations
}

async function assertMobileNavigation(page) {
  // Start independently, as the desktop keyboard audit does. Native disclosures
  // retain a sequential focus position even after blur and programmatic scrolling.
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await waitForScrollSettled(page)
  const menu = page.locator('details.mobile-navigation')
  const toggle = menu.locator('summary')
  const links = menu.locator('nav a')
  assert.equal(await toggle.isVisible(), true, 'Mobile navigation must expose a visible native menu toggle')
  assert.equal(await page.locator('.desktop-navigation').isVisible(), false, 'The desktop navigation row must be hidden on mobile')
  assert.ok((await toggle.getAttribute('aria-label'))?.trim(), 'The menu toggle needs an accessible name')
  const toggleBounds = await toggle.boundingBox()
  assert.ok(toggleBounds && toggleBounds.width >= 44 && toggleBounds.height >= 44, 'The mobile menu toggle needs a 44px touch target')
  assert.equal(await menu.evaluate((element) => element.open), false, 'The mobile menu must start closed')
  const closedHeight = await page.locator('.site-header').evaluate((element) => element.getBoundingClientRect().height)

  await toggle.tap()
  await page.waitForFunction(() => document.querySelector('details.mobile-navigation')?.open)
  for (const link of await links.all()) {
    const receivesTouch = await link.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      return element.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2))
    })
    assert.equal(receivesTouch, true, 'Open menu links must receive touches without being clipped by the header')
  }
  await toggle.tap()
  await page.waitForFunction(() => !document.querySelector('details.mobile-navigation')?.open)
  await toggle.tap()
  await page.waitForFunction(() => document.querySelector('details.mobile-navigation')?.open)
  const touchHref = await links.last().getAttribute('href')
  await links.last().tap()
  await page.waitForFunction((hash) => location.hash === hash && !document.querySelector('details.mobile-navigation')?.open, touchHref)
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await waitForScrollSettled(page)
  await toggle.tap()
  await page.waitForFunction(() => document.querySelector('details.mobile-navigation')?.open)
  await page.touchscreen.tap(8, closedHeight + 20)
  await page.waitForFunction(() => !document.querySelector('details.mobile-navigation')?.open)

  await page.keyboard.press('Tab')
  await toggle.focus()
  // Let native focus scrolling settle before measuring the open menu.
  await page.waitForFunction(() => {
    const summary = document.querySelector('.mobile-navigation > summary')
    if (!summary || document.activeElement !== summary) return false
    const bounds = summary.getBoundingClientRect()
    return bounds.y >= -1 && bounds.bottom <= innerHeight + 1
  }, undefined, { timeout: 5000 })
  await waitForScrollSettled(page)
  assert.equal(await toggle.evaluate((element) => element.matches(':focus-visible')), true, 'The menu toggle must show keyboard focus')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelector('details.mobile-navigation')?.open)
  assert.equal(await links.count(), 3, 'The mobile menu must offer all three section links')
  for (const link of await links.all()) {
    assert.equal(await link.isVisible(), true, 'Open mobile menu links must be visible')
    const bounds = await link.boundingBox()
    assert.ok(bounds && bounds.x >= -1 && bounds.y >= -1 && bounds.x + bounds.width <= page.viewportSize().width + 1 && bounds.y + bounds.height <= page.viewportSize().height + 1, `The mobile menu links must fit inside the viewport (${JSON.stringify({ bounds, scroll: await page.evaluate(() => ({ x: scrollX, y: scrollY })), viewport: page.viewportSize() })})`)
    assert.ok(bounds.height >= 44, 'Mobile menu links need a 44px-high touch target')
  }
  const openHeight = await page.locator('.site-header').evaluate((element) => element.getBoundingClientRect().height)
  assert.ok(Math.abs(openHeight - closedHeight) <= 1, 'Opening the mobile menu must not create a second header row')
  await page.screenshot({ path: path.join(artifactDirectory, 'mobile-menu.png'), animations: 'disabled' })
  await auditAccessibility(page, 'mobile-menu')
  await page.keyboard.press('Tab')
  const firstLink = links.first()
  assert.equal(await firstLink.evaluate((element) => document.activeElement === element), true, 'Tab from the open toggle must reach the first menu link')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('details.mobile-navigation')?.open)
  assert.equal(await toggle.evaluate((element) => document.activeElement === element), true, 'Escape must return focus to the menu toggle')

  await page.keyboard.press('Space')
  await page.waitForFunction(() => document.querySelector('details.mobile-navigation')?.open)
  await page.keyboard.press('Tab')
  const href = await firstLink.getAttribute('href')
  await page.keyboard.press('Enter')
  await page.waitForFunction((hash) => location.hash === hash && !document.querySelector('details.mobile-navigation')?.open, href)
  await page.waitForFunction((href) => {
    const bounds = document.querySelector(href).getBoundingClientRect()
    return bounds.y >= -1 && bounds.y < innerHeight
  }, href, { timeout: 5000 })
  const scroll = await waitForScrollSettled(page)
  const destination = await page.locator(href).boundingBox()
  assert.ok(destination && destination.y >= -1 && destination.y < page.viewportSize().height, 'Keyboard activation must reach the selected section after closing the menu')
  await page.waitForFunction((href) => [...document.querySelectorAll('.mobile-navigation nav a')].find((element) => element.getAttribute('href') === href)?.getAttribute('aria-current') === 'location', href, { timeout: 5000 })
  assert.equal(await firstLink.getAttribute('aria-current'), 'location', 'The mobile navigation must identify the selected section after scrolling')
  return { closedHeight, openHeight, touchToggle: true, touchHref, outsideTapDismissal: true, keyboardToggle: true, escapeFocus: true, href, destinationTop: destination.y, scroll, ariaCurrent: await firstLink.getAttribute('aria-current') }
}

async function assertContactReadability(page, name) {
  await page.locator('.contact-panel').evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
  await waitForScrollSettled(page)
  const contact = await page.locator('#kontakty').evaluate((section) => {
    const intro = section.querySelector('.contact-intro')
    const card = section.querySelector('.contact-glass')
    const action = section.querySelector('a.contact-instagram')
    const handle = section.querySelector('.contact-handle')
    const description = section.querySelector('.contact-description')
    const rectangle = (element) => {
      const bounds = element.getBoundingClientRect()
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, right: bounds.right, bottom: bounds.bottom }
    }
    const descriptionStyle = getComputedStyle(description)
    const handleStyle = getComputedStyle(handle)
    return {
      section: rectangle(section),
      intro: rectangle(intro),
      card: rectangle(card),
      action: rectangle(action),
      handle: rectangle(handle),
      descriptionFontSize: parseFloat(descriptionStyle.fontSize),
      handleFontSize: parseFloat(handleStyle.fontSize),
      handleFontFamily: handleStyle.fontFamily,
      overflowingText: [description, handle, action].filter((element) => element.scrollWidth > element.clientWidth + 1).map((element) => element.className),
    }
  })
  assert.ok(contact.descriptionFontSize >= 16, `${name}: contact body text must be at least 16px`)
  assert.ok(contact.handleFontSize >= 18, `${name}: the contact handle must be at least 18px`)
  assert.ok(/Manrope|sans-serif/i.test(contact.handleFontFamily) && !/Cormorant|Georgia/i.test(contact.handleFontFamily), `${name}: the contact handle must use the readable sans-serif typeface`)
  assert.ok(contact.action.height >= 64, `${name}: the contact card must offer an action at least 64px high`)
  assert.ok(contact.action.width >= contact.card.width - 4 && contact.action.height >= contact.card.height - 4, `${name}: the semantic Instagram link must fill the glass card`)
  assert.deepEqual(contact.overflowingText, [], `${name}: contact text must not overflow horizontally`)
  for (const [element, bounds] of Object.entries({ intro: contact.intro, card: contact.card, action: contact.action, handle: contact.handle })) {
    assert.ok(bounds.x >= contact.section.x - 1 && bounds.right <= contact.section.right + 1, `${name}: contact ${element} must stay inside the section`)
  }
  const overlapX = Math.min(contact.intro.right, contact.card.right) - Math.max(contact.intro.x, contact.card.x)
  const overlapY = Math.min(contact.intro.bottom, contact.card.bottom) - Math.max(contact.intro.y, contact.card.y)
  assert.ok(overlapX <= 1 || overlapY <= 1, `${name}: contact copy and action card must not overlap`)
  // The entire card can be taller than a landscape viewport; test hit targets
  // only after centering the actual link so its sample points are onscreen.
  await page.locator('.contact-instagram').evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
  const actionUnobstructed = await page.locator('.contact-instagram').evaluate((action) => {
    const bounds = action.getBoundingClientRect()
    return [[0.2, 0.2], [0.8, 0.2], [0.5, 0.5], [0.2, 0.8], [0.8, 0.8]].every(([x, y]) => document.elementFromPoint(bounds.x + bounds.width * x, bounds.y + bounds.height * y)?.closest('a.contact-instagram') === action)
  })
  assert.equal(actionUnobstructed, true, `${name}: the contact card must remain clickable across its surface`)
  if (name === 'desktop' || name === 'mobile') {
    await page.locator('.contact-panel').evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
    await preparePreviewCapture(page)
    await page.screenshot({ path: path.join(artifactDirectory, `${name}-contacts.png`), animations: 'disabled' })
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  return { ...contact, actionUnobstructed }
}

async function assertSectionConsistency(page, name) {
  const sections = [
    { id: 'napriamy', layout: '.directions-layout', intro: '.section-header.section-intro', content: '.directions-stage' },
    { id: 'pidkhid', layout: '.approach-layout', intro: '.approach-header.section-intro', content: '.principles-stage' },
    { id: 'pro-likaria', layout: '.about-layout', intro: '.about-content', content: '.about-photo-stage' },
  ]
  const results = []
  for (const configuration of sections) {
    const section = page.locator(`#${configuration.id}`)
    const result = await section.evaluate((section, configuration) => {
      const rectangle = (element) => {
        const bounds = element.getBoundingClientRect()
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, right: bounds.right, bottom: bounds.bottom }
      }
      const heading = section.querySelector('h2')
      const paragraphs = [...section.querySelectorAll('.section-description, .direction-card p, .principle p, .about-copy p')]
      const headingStyle = getComputedStyle(heading)
      const text = [heading, ...section.querySelectorAll('.direction-card h3, .principle h3'), ...paragraphs].filter(element => element.checkVisibility())
      const photo = section.querySelector('.about-photo img')
      return {
        id: configuration.id,
        sideBySide: configuration.id === 'pro-likaria' && matchMedia('(min-width: 640px)').matches,
        section: rectangle(section),
        layoutCount: Number(section.matches(configuration.layout)) + section.querySelectorAll(configuration.layout).length,
        intro: rectangle(section.querySelector(configuration.intro)),
        content: rectangle(section.querySelector(configuration.content)),
        headingSize: parseFloat(headingStyle.fontSize),
        headingAlignment: headingStyle.textAlign,
        paragraphSizes: paragraphs.map((paragraph) => parseFloat(getComputedStyle(paragraph).fontSize)),
        textBounds: text.map((element) => ({ text: element.textContent.trim().slice(0, 70), bounds: rectangle(element) })),
        overflowingText: text.filter((element) => element.scrollWidth > element.clientWidth + 1).map((element) => element.textContent.trim().slice(0, 70)),
        photo: photo ? { ...rectangle(photo), insideGlass: Boolean(photo.closest('.glass-surface')) } : null,
      }
    }, configuration)
    assert.equal(result.layoutCount, 1, `${name}: ${result.id} must use one shared section layout`)
    assert.ok(result.headingSize >= 34 && result.headingSize <= 44, `${name}: ${result.id} heading must use the compact 34–44px scale`)
    assert.ok(['left', 'start'].includes(result.headingAlignment), `${name}: ${result.id} heading must align left`)
    assert.ok(result.paragraphSizes.length > 0 && result.paragraphSizes.every((size) => size >= 16), `${name}: ${result.id} body text must be at least 16px`)
    assert.deepEqual(result.overflowingText, [], `${name}: ${result.id} text must not overflow horizontally`)
    for (const { text, bounds } of result.textBounds) {
      assert.ok(bounds.x >= result.section.x - 1 && bounds.right <= result.section.right + 1, `${name}: ${result.id} text must stay inside the section (${text})`)
    }
    if (result.sideBySide) {
      assert.ok(result.intro.right <= result.content.x + 1, `${name}: About must place its introduction beside the photo on wider screens`)
    } else {
      assert.ok(result.intro.bottom <= result.content.y + 1 || result.content.bottom <= result.intro.y + 1, `${name}: ${result.id} must stack its introduction and content without overlap`)
    }
    if (result.id === 'pro-likaria') {
      assert.ok(result.photo && result.photo.width > 0 && result.photo.width <= 381, `${name}: About must preserve the real photo at a restrained width`)
      assert.equal(result.photo.insideGlass, true, `${name}: the About photo must have a Liquid Glass frame`)
    }
    if (name === 'desktop' || name === 'mobile') {
      await preparePreviewCapture(page)
      await section.screenshot({ path: path.join(artifactDirectory, `${name}-${configuration.id}.png`), animations: 'disabled' })
    }
    results.push(result)
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  return results
}

async function assertDirectionPresentation(page, name) {
  assert.equal(await page.locator('.direction-card').count(), 6, `${name}: all six specialties must remain available`)
  assert.equal(await page.locator('.direction-card h3:visible').count(), 6, `${name}: all specialty titles must be visible`)
  assert.equal(await page.locator('.direction-card > p:visible').count(), 6, `${name}: every description must stay visible without interaction`)
  assert.equal(await page.locator('#napriamy details, #napriamy summary, #napriamy button, #napriamy [aria-expanded]').count(), 0, `${name}: specialties must not have collapse controls`)
  return { visibleDescriptions: 6, collapseControls: 0 }
}

async function auditAccessibility(page, name) {
  const results = await new AxeBuilder({ page }).withTags(accessibilityTags).analyze()
  await writeFile(path.join(artifactDirectory, `axe-${name}.json`), JSON.stringify(results, null, 2))
  const violations = results.violations.map((violation) => ({ id: violation.id, impact: violation.impact, description: violation.description, nodes: violation.nodes.map((node) => node.target) }))
  summary.accessibility.push({ name, violations })
  assert.equal(violations.length, 0, `${name}: axe violations: ${JSON.stringify(violations)}`)
}

async function readTranslation(locator) {
  return locator.evaluate((element) => {
    const transform = getComputedStyle(element).transform
    const matrix = transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(transform)
    return { x: matrix.m41, y: matrix.m42 }
  })
}

async function assertHoverMotion(page, reducedMotion = false) {
  const card = page.locator('.direction-card').first()
  await card.scrollIntoViewIfNeeded()
  await page.mouse.move(0, 0)
  await page.waitForTimeout(700)
  const cardBefore = await readTranslation(card)
  await card.hover()
  if (!reducedMotion) {
    await page.waitForFunction((beforeY) => {
      const element = document.querySelector('.direction-card')
      if (!element?.matches(':hover')) return false
      const transform = getComputedStyle(element).transform
      const translationY = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42
      return beforeY - translationY >= 0.5
    }, cardBefore.y, { timeout: 3000 })
  }
  await page.waitForTimeout(300)
  const cardAfter = await readTranslation(card)
  const cardLift = cardBefore.y - cardAfter.y
  if (reducedMotion) {
    assert.ok(Math.abs(cardLift) < 0.1, 'Reduced motion must disable card hover lift')
  } else {
    assert.ok(cardLift >= 0.5, 'Direction cards must respond to hover with a gentle lift')
    assert.ok(cardLift <= 12, 'Direction card hover lift must remain subtle')
  }

  const link = page.locator('.hero-actions .instagram-link')
  const arrow = link.locator('svg').last()
  assert.equal(await arrow.count(), 1, 'The hero Instagram action needs an arrow affordance')
  await link.scrollIntoViewIfNeeded()
  await page.mouse.move(0, 0)
  await page.waitForTimeout(350)
  const arrowBefore = await readTranslation(arrow)
  await link.hover()
  await page.waitForTimeout(300)
  const arrowAfter = await readTranslation(arrow)
  const arrowTravel = Math.hypot(arrowAfter.x - arrowBefore.x, arrowAfter.y - arrowBefore.y)
  if (reducedMotion) {
    assert.ok(arrowTravel < 0.1, 'Reduced motion must disable Instagram arrow movement')
  } else {
    assert.ok(arrowTravel >= 0.5, 'The Instagram arrow must respond to hover')
    assert.ok(arrowTravel <= 12, 'The Instagram arrow interaction must remain subtle')
  }
  await page.mouse.move(0, 0)
  await page.waitForTimeout(350)
  const infiniteAnimations = await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running' && animation.effect?.getComputedTiming().iterations === Infinity).map((animation) => ({ name: animation.animationName ?? animation.id, background: animation.effect?.target?.matches('.page-gradient-fallback') })))
  assert.ok(infiniteAnimations.every(animation => !reducedMotion && animation.name === 'page-gradient-float' && animation.background), 'Only the shared background may run a floating animation loop')
  return { cardLift, arrowTravel, infiniteAnimations }
}

async function auditViewport(viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, locale: 'uk-UA', deviceScaleFactor: 1, isMobile: Boolean(viewport.touch), hasTouch: Boolean(viewport.touch) })
  const page = await context.newPage()
  const observations = observePage(page)
  try {
    await settlePage(page)
    const result = await assertPageStructure(page, viewport.name)
    if (viewport.name === 'compact-tablet' || viewport.name === 'large-tablet') {
      for (const [element, bounds] of Object.entries({ heading: result.heroLayout.heading, portrait: result.heroLayout.photoStage, action: result.heroLayout.action })) {
        assert.ok(bounds.y >= 0 && bounds.bottom <= viewport.height + 1, `${viewport.name}: the hero ${element} must fit in the first viewport`)
      }
      await preparePreviewCapture(page)
      await page.screenshot({ path: path.join(artifactDirectory, `hero-${viewport.name}.png`), animations: 'disabled' })
    }
    result.contactReadability = await assertContactReadability(page, viewport.name)
    result.sectionConsistency = await assertSectionConsistency(page, viewport.name)
    result.directionsPresentation = await assertDirectionPresentation(page, viewport.name)
    if (viewport.name === 'desktop' || viewport.name === 'mobile') {
      await preparePreviewCapture(page)
      await page.screenshot({ path: path.join(artifactDirectory, `${viewport.name}.png`), fullPage: true, animations: 'disabled' })
      await page.locator('.site-footer').screenshot({ path: path.join(artifactDirectory, `${viewport.name}-footer.png`), animations: 'disabled' })
      await auditAccessibility(page, viewport.name)
    }
    if (viewport.name === 'desktop') {
      result.glass = await assertGlassSurfaces(page, { enhanced: true })
      result.hoverMotion = await assertHoverMotion(page)
      result.keyboardNavigation = await assertKeyboardNavigation(page)
    }
    if (viewport.name === 'mobile') {
      result.glass = await assertGlassSurfaces(page, { enhanced: false })
      result.mobileNavigation = await assertMobileNavigation(page)
    }
    assert.deepEqual(observations.externalRequests, [], `${viewport.name}: all assets must be self-hosted; external requests were observed`)
    assert.deepEqual(observations.failedRequests, [], `${viewport.name}: failed network requests`)
    assert.deepEqual(observations.consoleErrors, [], `${viewport.name}: browser console errors`)
    assert.deepEqual(observations.pageErrors, [], `${viewport.name}: browser runtime or hydration errors`)
    summary.viewports.push({ ...result, network: observations, passed: true })
    console.log(`PASS ${viewport.name} (${viewport.width}×${viewport.height})`)
  } catch (error) {
    failures.push(`${viewport.name}: ${error.message}`)
    summary.viewports.push({ name: viewport.name, passed: false, error: error.message, network: observations })
    console.error(`FAIL ${viewport.name}: ${error.stack ?? error.message}`)
  } finally {
    await context.close()
  }
}

async function waitForHeroEntrance(page) {
  await page.waitForFunction(() => {
    const hero = document.querySelector('.hero-surface')
    return hero && hero.getAnimations({ subtree: true }).every((animation) => animation.playState !== 'running' && !animation.pending)
  }, undefined, { timeout: 5000 })
}

async function assertShaderLifecycle(page) {
  const readCanvas = () => page.evaluate(() => ({
    canvases: document.querySelectorAll('canvas').length,
    liveContexts: window.__qaWebGlContexts.filter(({ canvas }) => canvas.isConnected).length,
    raster: [...document.querySelectorAll('.page-background canvas')].map((canvas) => ({
      width: canvas.width,
      height: canvas.height,
      density: canvas.width / canvas.getBoundingClientRect().width,
      rendering: canvas.dataset.rendering,
    })),
  }))
  const initial = await readCanvas()
  assert.equal(initial.canvases, 1, 'Desktop must render exactly one canvas across the full page')
  assert.equal(initial.liveContexts, 1, 'The hero canvas must own a real WebGL context')
  assert.ok(initial.raster.every((canvas) => canvas.width > 0 && canvas.height > 0 && canvas.density <= 0.76), 'The page-wide shader must keep its raster density capped at 0.75')
  await page.waitForFunction(() => window.__qaGradientTimes.at(-1) > 0.5)

  // Keep focus on the CTA while wheel-scrolling so refraction must suspend and
  // resume independently of pointer exit, without replacing its content or canvas.
  const originalCanvas = await page.locator('.page-background canvas').elementHandle()
  const action = page.locator('.hero-actions .instagram-link')
  await action.evaluate(element => element.focus({ preventScroll: true }))
  await page.waitForSelector('.hero-cta-glass[data-glass="enhanced"] .glass-decoration', { state: 'attached' })
  let pausedTime
  let resumeIndex
  for (let step = 0; step < 4; step++) {
    await page.mouse.wheel(0, 40)
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-scrolling')
      && document.querySelector('.page-background canvas')?.dataset.rendering === 'paused'
      && document.querySelectorAll('.glass-decoration').length === 0)
    assert.equal(await action.evaluate(element => document.activeElement === element), true, 'Scroll suspension must preserve keyboard focus')
    // Sample each pause in the browser. Automation round trips between wheel
    // events can exceed the 180ms settling delay and legitimately resume motion.
    const phase = await page.evaluate(async () => {
      const time = window.__qaGradientTimes.at(-1)
      const index = window.__qaGradientTimes.length
      await new Promise(resolve => setTimeout(resolve, 60))
      return { time, index, after: window.__qaGradientTimes.at(-1) }
    })
    assert.ok(Math.abs(phase.after - phase.time) < 0.001, 'The shader timeline must stay frozen during scrolling')
    if (pausedTime !== undefined) assert.ok(phase.time >= pausedTime - 0.001, 'Successive scroll pauses must preserve the shader timeline')
    pausedTime = phase.time
    resumeIndex = phase.index
  }
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-scrolling')
    && document.querySelector('.page-background canvas')?.dataset.rendering === 'active'
    && document.querySelector('.hero-cta-glass')?.dataset.glass === 'enhanced')
  assert.equal(await originalCanvas.evaluate(canvas => canvas.isConnected), true, 'Scroll settling must resume the same WebGL canvas')
  await page.waitForFunction(time => window.__qaGradientTimes.at(-1) > time + 0.03, pausedTime)
  const resumedTimes = await page.evaluate(index => window.__qaGradientTimes.slice(index), resumeIndex)
  assert.ok(resumedTimes.length > 0 && resumedTimes.every(time => time >= pausedTime - 0.001), 'The shader must resume from its previous position without restarting')
  assert.ok(resumedTimes.at(-1) < pausedTime + 0.25, 'The resumed shader must not jump ahead by the paused duration')
  await preparePreviewCapture(page)
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await page.waitForSelector('.page-background[data-gradient-state="active"] canvas[data-rendering="active"]', { state: 'attached' })

  // Exercise the visibility handler deterministically without depending on OS tab focus.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForSelector('.page-gradient-stage[data-rendering="paused"] canvas[data-rendering="paused"]', { state: 'attached' })
  await page.evaluate(() => {
    delete document.hidden
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForSelector('.page-gradient-stage[data-rendering="active"] canvas[data-rendering="active"]', { state: 'attached' })

  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
  await page.waitForSelector('.page-gradient-stage[data-rendering="paused"]', { state: 'attached' })
  await page.waitForFunction(() => [...document.querySelectorAll('.page-background canvas')].every((canvas) => canvas.dataset.rendering === 'paused'))
  const offscreen = await readCanvas()
  assert.equal(offscreen.canvases, 1, 'Scrolling to the footer must preserve the single page background canvas')
  await page.waitForSelector('.page-background[data-gradient-state="active"] canvas[data-rendering="active"]', { state: 'attached' })
  const footer = await readCanvas()
  assert.equal(footer.liveContexts, 1, 'The full-page gradient must remain available at the footer')
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await page.waitForSelector('.page-background[data-gradient-state="active"] canvas[data-rendering="active"]', { state: 'attached', timeout: 15_000 })
  const resumed = await readCanvas()
  assert.equal(resumed.canvases, 1, 'Returning to the hero must restore one canvas')
  assert.equal(resumed.liveContexts, 1, 'Returning to the hero must leave one connected WebGL context')
  return { initial, duringScroll: offscreen, footer, resumed, hiddenTabPaused: true, wheelScrollPaused: true, focusPreserved: true, canvasReused: true, timelineContinuity: { pausedTime, resumedTime: resumedTimes.at(-1) } }
}

async function auditShaderFailure() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'uk-UA' })
  await context.route('**/assets/HeroGradient-*.js', (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: 'throw new Error("QA_SHADER_IMPORT_FAILURE")',
  }))
  const page = await context.newPage()
  const observations = observePage(page)
  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await page.waitForSelector('.page-background[data-gradient-state="error"]', { state: 'attached', timeout: 15_000 })
    assert.equal(await page.locator('.page-gradient-fallback').isVisible(), true, 'A shader import failure must preserve the CSS backdrop')
    assert.equal(await page.locator('canvas').count(), 0, 'A failed shader must not leave a broken canvas')
    assert.equal(await page.locator('.hero-heading').isVisible(), true, 'A shader failure must preserve the heading')
    const action = page.locator('.hero-actions .instagram-link')
    await action.focus()
    assert.equal(await action.evaluate((element) => document.activeElement === element), true, 'A shader failure must preserve keyboard access to the action')
    assert.deepEqual(observations.externalRequests, [], 'The shader failure fallback must not request external assets')
    assert.deepEqual(observations.failedRequests, [], 'The simulated module exception must not hide unrelated network failures')
    const expectedError = (message) => message.includes('QA_SHADER_IMPORT_FAILURE') || message.includes('above error occurred')
    assert.ok(observations.consoleErrors.every(expectedError), `Unexpected fallback console errors: ${JSON.stringify(observations.consoleErrors)}`)
    assert.ok(observations.pageErrors.every(expectedError), `Unexpected fallback runtime errors: ${JSON.stringify(observations.pageErrors)}`)
    summary.shaderFallback = { passed: true, expectedImportFailure: true }
    console.log('PASS failed shader import preserves CSS fallback and keyboard action')
  } catch (error) {
    failures.push(`shader-fallback: ${error.message}`)
    summary.shaderFallback = { passed: false, error: error.message, network: observations }
    console.error(`FAIL shader fallback: ${error.message}`)
  } finally {
    await context.close()
  }
}

async function auditHero(configuration) {
  const { name, width, height, coarse = false, reduced = false } = configuration
  const context = await browser.newContext({
    viewport: { width, height },
    locale: 'uk-UA',
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: reduced ? 'reduce' : 'no-preference',
    isMobile: coarse,
    hasTouch: coarse,
  })
  const shaderRequests = []
  await context.addInitScript(() => {
    window.__qaWebGlContexts = []
    window.__qaGradientTimes = []
    // Read the actual GPU uniform, so a reset or a static shader cannot pass by
    // merely preserving the canvas element or a separate application counter.
    for (const Context of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      if (!Context) continue
      const names = new WeakMap()
      const getUniformLocation = Context.prototype.getUniformLocation
      const uniform1f = Context.prototype.uniform1f
      Context.prototype.getUniformLocation = function (program, name) {
        const location = getUniformLocation.call(this, program, name)
        if (location) names.set(location, name)
        return location
      }
      Context.prototype.uniform1f = function (location, value) {
        if (location && names.get(location) === 'uTime') window.__qaGradientTimes.push(value)
        return uniform1f.call(this, location, value)
      }
    }
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...options) {
      const context = getContext.call(this, type, ...options)
      if (context && ['webgl', 'webgl2', 'experimental-webgl'].includes(type)
        && !window.__qaWebGlContexts.some((entry) => entry.context === context)) {
        window.__qaWebGlContexts.push({ canvas: this, context })
      }
      return context
    }
  })
  let releaseShader
  let shaderHeld = false
  if (!coarse && !reduced) {
    const shaderGate = new Promise((resolve) => { releaseShader = resolve })
    await context.route('**/assets/HeroGradient-*.js', async (route) => {
      shaderHeld = true
      await shaderGate
      await route.continue()
    })
  }
  const page = await context.newPage()
  const observations = observePage(page)
  page.on('request', (request) => {
    if (/\/HeroGradient-[^/]+\.js(?:\?|$)/.test(request.url())) shaderRequests.push(request.url())
  })
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => document.fonts.ready)
    if (releaseShader) {
      const importDeadline = Date.now() + 10_000
      while (!shaderHeld && Date.now() < importDeadline) await delay(50)
      assert.equal(shaderHeld, true, 'Desktop must load the shader in a separate lazy JavaScript chunk')
      assert.equal(await page.locator('.page-background canvas').count(), 0, 'Initial HTML/CSS must render without waiting for the shader chunk')
      assert.equal(await page.locator('.page-gradient-fallback').isVisible(), true, 'The CSS gradient must be visible while the shader chunk is pending')
      assert.equal(await page.locator('.hero-heading').isVisible(), true, 'The heading must remain visible while the shader chunk is pending')
      assert.equal(await page.locator('.hero-actions .instagram-link').isVisible(), true, 'The primary action must remain usable while the shader chunk is pending')
      releaseShader()
      await page.waitForSelector('.page-background[data-gradient-state="active"] canvas[data-rendering="active"]', { state: 'attached', timeout: 15_000 })
    }
    await page.waitForLoadState('networkidle')
    await page.waitForSelector('.page-background', { state: 'attached', timeout: 5000 })
    const animationProperties = await page.locator('.hero-surface').evaluate((hero) => hero.getAnimations({ subtree: true }).flatMap((animation) => animation.effect?.getKeyframes().flatMap((frame) => Object.keys(frame).filter((key) => !['offset', 'computedOffset', 'easing', 'composite'].includes(key))) ?? []))
    assert.ok(animationProperties.every((property) => ['transform', 'opacity'].includes(property)), `${name}: hero entrances must animate only transform and opacity (${[...new Set(animationProperties)].join(', ')})`)
    await waitForHeroEntrance(page)
    const fold = await page.evaluate(() => {
      const heading = document.querySelector('.hero-heading')
      const copy = document.querySelector('.hero-copy')
      const portrait = document.querySelector('.hero-doctor img')
      const action = document.querySelector('.hero-actions .instagram-link')
      const scene = document.querySelector('.page-background')
      const backdrop = scene.querySelector('.page-gradient-fallback, canvas, .page-gradient-canvas')
      const rectangle = (element) => {
        const bounds = element.getBoundingClientRect()
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, right: bounds.right, bottom: bounds.bottom }
      }
      const actionBounds = action.getBoundingClientRect()
      const contact = document.querySelector('.header-contact')
      const header = document.querySelector('.site-header')
      const nav = header.querySelector('.desktop-navigation')
      const hit = document.elementFromPoint(actionBounds.x + actionBounds.width / 2, actionBounds.y + actionBounds.height / 2)
      const rootStyle = getComputedStyle(document.documentElement)
      return {
        scrollY,
        heading: rectangle(heading),
        copy: rectangle(copy),
        headingAlignment: getComputedStyle(heading).textAlign,
        portrait: portrait ? rectangle(portrait) : null,
        portraitLoaded: Boolean(portrait?.complete && portrait.naturalWidth > 0),
        portraitAlt: portrait?.alt ?? '',
        portraitHidden: Boolean(portrait?.closest('[aria-hidden="true"]')),
        action: rectangle(action),
        scene: rectangle(scene),
        header: rectangle(header),
        headerContact: rectangle(contact),
        headerNav: rectangle(nav),
        backdropPresent: Boolean(backdrop),
        sceneHidden: scene.getAttribute('aria-hidden'),
        sceneInteractiveElements: scene.querySelectorAll('a[href], button, input, select, textarea, [contenteditable="true"], [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"]').length,
        scenePointerEvents: getComputedStyle(scene).pointerEvents,
        actionUnobstructed: Boolean(hit?.closest('a.instagram-link')),
        colorScheme: rootStyle.colorScheme,
        background: rootStyle.backgroundColor,
        fineHover: matchMedia('(hover: hover) and (pointer: fine)').matches,
        coarsePointer: matchMedia('(pointer: coarse)').matches,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        flowerCount: document.querySelectorAll('.story-flower, .story-scene').length,
      }
    })
    const fullyVisible = (bounds) => bounds && bounds.width > 0 && bounds.height > 0 && bounds.x >= -1 && bounds.y >= -1 && bounds.right <= width + 1 && bounds.bottom <= height + 1
    assert.equal(fold.scrollY, 0, `${name}: first-fold checks must run before scrolling`)
    assert.ok(fullyVisible(fold.heading), `${name}: the complete H1 must fit in the initial viewport (${JSON.stringify(fold.heading)})`)
    assert.ok(fullyVisible(fold.portrait), `${name}: the doctor portrait must fit in the initial viewport (${JSON.stringify(fold.portrait)})`)
    assert.equal(fold.portraitLoaded, true, `${name}: the doctor portrait must be loaded in the initial viewport`)
    assert.ok(fold.portraitAlt.trim(), `${name}: the doctor portrait needs meaningful alt text`)
    assert.equal(fold.portraitHidden, false, `${name}: the doctor portrait must remain available to assistive technology`)
    assert.ok(fullyVisible(fold.action), `${name}: the hero Instagram action must fit in the initial viewport (${JSON.stringify(fold.action)})`)
    assert.ok(fold.action.height >= 44, `${name}: the actual hero action must have a 44px-high touch target`)
    assert.ok(fold.headerContact.height >= 44, `${name}: the actual header contact link must have a 44px-high touch target`)
    assert.ok(width >= 640 ? ['left', 'start'].includes(fold.headingAlignment) : fold.headingAlignment === 'center', `${name}: the hero copy must align with its responsive composition`)
    assert.ok(fold.action.x >= fold.copy.x - 1 && fold.action.right <= fold.copy.right + 1, `${name}: the hero action must stay inside the copy column after glass enhancement`)
    const alignmentOffset = width >= 640
      ? fold.action.x - fold.heading.x
      : fold.action.x + fold.action.width / 2 - (fold.copy.x + fold.copy.width / 2)
    assert.ok(Math.abs(alignmentOffset) <= 2, `${name}: the hero action must align with the responsive copy`)
    if (!coarse && width >= 1024) {
      assert.ok(fold.headerContact.x >= fold.headerNav.right && fold.headerContact.right <= fold.header.right + 1, `${name}: the header contact control must occupy the right header column`)
      assert.ok(fold.headerContact.y >= fold.header.y && fold.headerContact.bottom <= fold.header.bottom + 1, `${name}: the header contact control must remain within the header`)
    }
    assert.equal(fold.actionUnobstructed, true, `${name}: decorative layers must not intercept the hero action`)
    assert.equal(fold.backdropPresent, true, `${name}: the hero must show a gradient backdrop`)
    assert.ok(fold.scene.width > 0 && fold.scene.height > 0, `${name}: the hero visual must fill the stage`)
    assert.equal(fold.sceneHidden, 'true', `${name}: the decorative scene must be hidden from assistive technology`)
    assert.equal(fold.sceneInteractiveElements, 0, `${name}: the decorative scene must not contain interactive or focusable elements`)
    assert.equal(fold.scenePointerEvents, 'none', `${name}: the decorative backdrop must not intercept pointer input`)
    assert.equal(fold.flowerCount, 0, `${name}: the flower ornament must be removed`)
    assert.equal(fold.fineHover, !coarse, `${name}: pointer emulation must match the intended input device`)
    assert.equal(fold.coarsePointer, coarse, `${name}: coarse-pointer emulation must match the intended input device`)
    assert.equal(fold.reducedMotion, reduced, `${name}: motion-preference emulation must match the intended case`)
    assert.ok(fold.colorScheme.split(/\s+/).includes('light') && !fold.colorScheme.includes('dark'), `${name}: the site must use only the light color scheme`)
    await page.screenshot({ path: path.join(artifactDirectory, `hero-${name}.png`), animations: 'disabled' })
    const glass = await assertGlassSurfaces(page, { enhanced: !coarse, reducedMotion: reduced, aboveFoldOnly: true })
    let shader
    if (!coarse && !reduced) {
      assert.equal(shaderRequests.length, 1, 'Desktop must request one lazy shader module')
      shader = await assertShaderLifecycle(page)
    } else {
      assert.deepEqual(shaderRequests, [], `${name}: static fallback must avoid downloading the shader module`)
      assert.equal(await page.locator('canvas').count(), 0, `${name}: static fallback must not create a canvas`)
    }

    const infiniteAnimations = await page.locator('.hero-surface').evaluate((hero) => hero.getAnimations({ subtree: true }).filter((animation) => animation.effect?.getComputedTiming().iterations === Infinity).map((animation) => animation.animationName ?? animation.id))
    assert.deepEqual(infiniteAnimations, [], `${name}: the hero must not contain infinite CSS animation loops`)

    let darkPreference
    if (coarse) {
      await page.emulateMedia({ colorScheme: 'dark' })
      await nextPaints(page)
      darkPreference = await page.evaluate(() => ({ preferredDark: matchMedia('(prefers-color-scheme: dark)').matches, colorScheme: getComputedStyle(document.documentElement).colorScheme, background: getComputedStyle(document.documentElement).backgroundColor }))
      assert.equal(darkPreference.preferredDark, true, 'The dark OS preference must be active for the light-only audit')
      assert.equal(darkPreference.colorScheme, fold.colorScheme, 'An OS dark preference must preserve the light color scheme')
      assert.equal(darkPreference.background, fold.background, 'An OS dark preference must preserve the light canvas')
      const channels = darkPreference.background.match(/[\d.]+/g)?.map(Number)
      assert.ok(channels && channels.length >= 3 && (channels.length < 4 || channels[3] === 1), 'The light page canvas must have an opaque background')
      const linear = channels.slice(0, 3).map((channel) => channel / 255 <= 0.04045 ? channel / 255 / 12.92 : ((channel / 255 + 0.055) / 1.055) ** 2.4)
      const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
      assert.ok(luminance >= 0.8, `The page canvas must remain light under an OS dark preference (luminance=${luminance})`)
      darkPreference.luminance = luminance
      await page.screenshot({ path: path.join(artifactDirectory, 'hero-mobile-dark.png'), animations: 'disabled' })
    }
    for (const [kind, values] of Object.entries(observations)) assert.deepEqual(values, [], `${name}: hero ${kind}`)
    summary.hero.push({ name, passed: true, fold, glass, shader, shaderRequests, darkPreference, infiniteAnimations })
    console.log(`PASS hero ${name}: first fold, gradient backdrop and light theme`)
  } catch (error) {
    failures.push(`hero-${name}: ${error.message}`)
    summary.hero.push({ name, passed: false, error: error.message, network: observations })
    console.error(`FAIL hero ${name}: ${error.message}`)
  } finally {
    releaseShader?.()
    await context.close()
  }
}

async function auditScrollReveals() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 600 }, locale: 'uk-UA', reducedMotion: 'no-preference' })
  await context.addInitScript(() => {
    window.__qaScrollAnimationEvents = []
    window.__qaIntersectionObserverOptions = []
    const NativeIntersectionObserver = window.IntersectionObserver
    window.IntersectionObserver = class extends NativeIntersectionObserver {
      constructor(callback, options) {
        super(callback, options)
        window.__qaIntersectionObserverOptions.push({ thresholds: Array.from(this.thresholds), rootMargin: this.rootMargin })
      }
    }
    for (const type of ['animationstart', 'animationend']) {
      document.addEventListener(type, (event) => {
        if (event.target instanceof Element && event.target.matches('.animate-on-scroll')) {
          const animation = event.target.getAnimations().find((candidate) => candidate.animationName === event.animationName)
          window.__qaScrollAnimationEvents.push({ type, name: event.animationName, target: event.target, playState: animation?.playState, keyframes: type === 'animationstart' ? animation?.effect?.getKeyframes() : undefined })
        }
      }, true)
    }
  })
  const page = await context.newPage()
  const observations = observePage(page)
  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    // The compact hero exposes the first direction row on desktop. Use the last
    // card so this threshold probe still starts outside the initial viewport.
    const target = page.locator('.direction-reveal.animate-on-scroll:last-child')
    await page.waitForFunction(() => document.querySelector('.direction-reveal.animate-on-scroll:last-child')?.getAttribute('data-scroll-state') === 'pending', undefined, { timeout: 5000 })
    const observerOptions = await page.evaluate(() => window.__qaIntersectionObserverOptions.filter((options) => options.rootMargin === '0px 0px -10% 0px'))
    assert.equal(observerOptions.length, 1, 'Scroll reveals must share one native intersection observer independently of decorative lazy loading')
    assert.equal(observerOptions[0].rootMargin, '0px 0px -10% 0px', 'The native observer must use the configured viewport margin')
    assert.equal(observerOptions[0].thresholds.length, 1, 'The native observer must have one reveal threshold')
    // Chrome exposes thresholds with float32 precision, e.g. 0.20000000298023224.
    assert.ok(Math.abs(observerOptions[0].thresholds[0] - 0.2) < 0.000001, 'The native observer must use the configured 20% reveal threshold')
    await auditAccessibility(page, 'initial')
    const initialTimelines = await target.evaluate((element) => element.getAnimations().map((animation) => ({ playState: animation.playState, time: animation.currentTime })))
    const intersection = () => target.evaluate((element) => new Promise((resolve) => {
      const observer = new IntersectionObserver(([entry]) => {
        observer.disconnect()
        resolve({ ratio: entry.intersectionRatio, rootBottom: entry.rootBounds?.bottom, top: entry.boundingClientRect.top, height: entry.boundingClientRect.height, scrollY })
      }, { threshold: 0.2, rootMargin: '0px 0px -10% 0px' })
      observer.observe(element)
    }))
    const initial = await intersection()
    assert.equal(initial.ratio, 0, 'The scroll-reveal test target must begin outside the observer viewport')
    assert.ok(Number.isFinite(initial.rootBottom) && initial.height > 0, 'Native observer geometry must be available')
    const documentTop = initial.top + initial.scrollY
    const beforeThreshold = documentTop - initial.rootBottom + initial.height * 0.1
    const afterThreshold = documentTop - initial.rootBottom + initial.height * 0.55
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), beforeThreshold)
    await nextPaints(page)
    const below = await intersection()
    assert.ok(below.ratio > 0 && below.ratio < 0.2, `The target must be intersecting below its trigger threshold (ratio=${below.ratio})`)
    assert.equal(await target.getAttribute('data-scroll-state'), 'pending', 'Partial entry below the threshold must not trigger a reveal')
    assert.equal(await target.evaluate((element) => element.classList.contains('animate')), false, 'A pending offscreen reveal must not have the active animation class')
    assert.equal(await target.evaluate((element) => getComputedStyle(element).opacity), '1', 'Pending reveals must preserve fully readable text contrast')
    const pendingTimelines = await target.evaluate((element) => element.getAnimations().map((animation) => ({ playState: animation.playState, time: animation.currentTime })))
    assert.ok(pendingTimelines.every((animation) => animation.playState === 'paused'), 'A pending reveal must not advance before its threshold is reached')
    assert.deepEqual(pendingTimelines, initialTimelines, 'Pending reveal timelines must remain unchanged below the threshold')
    // Browsers may emit animationstart when creating an initially paused timeline.
    // Such an event is valid only while paused; no visual timeline may run early.
    assert.equal(await target.evaluate((element) => window.__qaScrollAnimationEvents.filter((event) => event.target === element && event.type === 'animationstart' && event.playState !== 'paused').length), 0, 'The reveal must not run before its threshold is reached')
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), afterThreshold)
    await page.waitForFunction(() => {
      const element = document.querySelector('.direction-reveal.animate-on-scroll:last-child')
      return element?.classList.contains('animate') && ['running', 'done'].includes(element.getAttribute('data-scroll-state')) && window.__qaScrollAnimationEvents.some((event) => event.target === element && event.name === 'animationIn' && event.type === 'animationstart')
    }, undefined, { timeout: 3000 })
    const keyframes = await target.evaluate((element) => element.getAnimations().find((animation) => animation.animationName === 'animationIn')?.effect?.getKeyframes() ?? window.__qaScrollAnimationEvents.find((event) => event.target === element && event.name === 'animationIn' && event.type === 'animationstart')?.keyframes)
    assert.ok(keyframes && keyframes.length >= 2, 'Viewport entry must start the animationIn CSS keyframes')
    const allowedKeys = new Set(['offset', 'computedOffset', 'easing', 'composite', 'transform', 'opacity'])
    const animatedProperties = [...new Set(keyframes.flatMap((frame) => Object.keys(frame).filter((key) => !['offset', 'computedOffset', 'easing', 'composite'].includes(key))))]
    assert.ok(keyframes.every((frame) => Object.keys(frame).every((key) => allowedKeys.has(key))), `Scroll keyframes must animate only transform and opacity (${animatedProperties.join(', ')})`)
    assert.ok(animatedProperties.includes('transform') && animatedProperties.includes('opacity'), 'The reveal must include the intended position and opacity animation')
    await page.waitForFunction(() => document.querySelector('.direction-reveal.animate-on-scroll:last-child')?.getAttribute('data-scroll-state') === 'done', undefined, { timeout: 3000 })
    const readEvents = () => target.evaluate((element) => window.__qaScrollAnimationEvents.filter((event) => event.target === element && event.name === 'animationIn').map(({ type, name }) => ({ type, name })))
    const firstEvents = await readEvents()
    assert.equal(firstEvents.filter((event) => event.type === 'animationstart').length, 1, 'The reveal must start once on first qualifying entry')
    assert.equal(firstEvents.filter((event) => event.type === 'animationend').length, 1, 'The reveal must finish before marking the element done')
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await nextPaints(page)
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), afterThreshold)
    await nextPaints(page)
    assert.equal(await target.getAttribute('data-scroll-state'), 'done', 'Leaving and re-entering must preserve the completed reveal')
    assert.deepEqual(await readEvents(), firstEvents, 'A once-only reveal must not replay after re-entry')
    assert.equal(await target.evaluate((element) => getComputedStyle(element).opacity), '1', 'Completed reveal content must stay fully readable')
    assert.equal(await target.evaluate((element) => element.getAnimations().length), 0, 'Completed reveal animation effects must be released')

    // Give the keyboard probe a fresh page so focusing Contact does not complete
    // the separate fast-scroll destination before that behavior is exercised.
    const focusPage = await context.newPage()
    const focusObservations = observePage(focusPage)
    await focusPage.goto(baseUrl, { waitUntil: 'networkidle' })
    const focusWrapper = focusPage.locator('.contact-panel.animate-on-scroll')
    assert.equal(await focusWrapper.getAttribute('data-scroll-state'), 'pending', 'The focus test must start with an unvisited reveal')
    const focusLink = focusWrapper.locator('.instagram-link')
    assert.equal(await focusLink.count(), 1, 'The keyboard focus probe must use the single Contacts Instagram link')
    await focusLink.focus()
    await focusPage.waitForFunction(() => document.querySelector('.contact-panel.animate-on-scroll')?.getAttribute('data-scroll-state') === 'done', undefined, { timeout: 1000 })
    assert.equal(await focusLink.evaluate((element) => document.activeElement === element), true, 'Focusing a pending reveal must preserve keyboard focus')
    assert.equal(await focusWrapper.evaluate((element) => getComputedStyle(element).opacity), '1', 'Keyboard focus must immediately make reveal content fully readable')
    assert.equal(await focusWrapper.evaluate((element) => element.getAnimations().length), 0, 'Keyboard-focused reveal content must not keep animating')
    await waitForScrollSettled(focusPage)
    for (const [kind, values] of Object.entries(focusObservations)) assert.deepEqual(values, [], `Contact keyboard-focus probe ${kind}`)
    await focusPage.close()

    // A large jump must still reveal its destination; skipped content can enter later.
    assert.equal(await page.locator('.contact-panel').getAttribute('data-scroll-state'), 'pending', 'The fast-scroll test must start with an unvisited destination')
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
    await page.waitForFunction(() => document.querySelector('.contact-panel.animate-on-scroll')?.getAttribute('data-scroll-state') === 'done', undefined, { timeout: 3000 })
    assert.equal(await page.locator('.contact-panel').evaluate((element) => getComputedStyle(element).opacity), '1', 'Fast scrolling must leave the destination readable')
    assert.deepEqual(observations.consoleErrors, [], 'Scroll-reveal console errors')
    assert.deepEqual(observations.pageErrors, [], 'Scroll-reveal runtime or hydration errors')
    assert.deepEqual(observations.externalRequests, [], 'Scroll-reveal assets must remain local')
    assert.deepEqual(observations.failedRequests, [], 'Scroll-reveal requests must succeed')
    summary.scrollReveals = { passed: true, observerOptions, thresholdProbeRatio: below.ratio, keyframes: animatedProperties, firstEvents, onceOnly: true, focusFlush: true, fastScroll: true }
    console.log('PASS CSS scroll reveals, threshold, once-only entry, keyboard focus and fast scroll')
  } catch (error) {
    failures.push(`scroll-reveals: ${error.message}`)
    summary.scrollReveals = { passed: false, error: error.message }
    console.error(`FAIL scroll reveals: ${error.message}`)
  } finally {
    await context.close()
  }
}

async function auditWithoutJavaScript() {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'uk-UA', javaScriptEnabled: false })
  const page = await context.newPage()
  const observations = observePage(page)
  try {
    await settlePage(page)
    await waitForHeroEntrance(page)
    const structure = await assertPageStructure(page, 'no-javascript')
    const glass = await assertGlassSurfaces(page, { enhanced: false, staticHtml: true })
    assert.equal(await page.locator('.page-gradient-fallback').isVisible(), true, 'No-JavaScript content must show a CSS gradient')
    assert.equal(await page.locator('canvas').count(), 0, 'No-JavaScript content must not mount a canvas')
    const shaderRequests = await page.evaluate(() => performance.getEntriesByType('resource').filter((entry) => /\/HeroGradient-[^/]+\.js(?:\?|$)/.test(entry.name)).map((entry) => entry.name))
    assert.deepEqual(shaderRequests, [], 'No-JavaScript content must not download the shader module')
    const content = await readContentVisibility(page)
    const directionsPresentation = await assertDirectionPresentation(page, 'no-javascript')
    assert.ok(content.revealCount > 0, 'No-JavaScript audit must include the static scroll-reveal wrappers')
    assert.equal(content.pendingReveals, 0, 'JavaScript-disabled HTML must not contain hydrated pending or running reveal states')
    assert.deepEqual(content.hiddenContent, [], 'All prerendered content must remain readable without JavaScript')
    assert.deepEqual(content.runningAnimations, [], 'Static no-JavaScript content must not retain running animations')
    assert.deepEqual(observations.consoleErrors, [], 'JavaScript-disabled console errors')
    assert.deepEqual(observations.pageErrors, [], 'JavaScript-disabled runtime errors')
    assert.deepEqual(observations.externalRequests, [], 'JavaScript-disabled page must request only local assets')
    assert.deepEqual(observations.failedRequests, [], 'JavaScript-disabled requests must succeed')
    summary.noJavaScript = { ...structure, ...content, glass, directionsPresentation, passed: true }
    console.log('PASS JavaScript-disabled static content and photos')
  } catch (error) {
    failures.push(`no-javascript: ${error.message}`)
    summary.noJavaScript = { passed: false, error: error.message }
    console.error(`FAIL without JavaScript: ${error.message}`)
  } finally {
    await context.close()
  }
}

async function auditReducedMotion() {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'uk-UA', reducedMotion: 'reduce' })
  const page = await context.newPage()
  const observations = observePage(page)
  try {
    let initialContent
    await settlePage(page, async () => {
      initialContent = await readContentVisibility(page)
      assert.ok(initialContent.revealCount > 0, 'Reduced-motion audit must include the scroll-reveal wrappers')
      assert.equal(initialContent.pendingReveals, 0, 'Reduced motion must flush all pending reveals before scrolling')
      assert.deepEqual(initialContent.hiddenContent, [], 'Reduced-motion content must be readable before its first scroll')
      assert.deepEqual(initialContent.runningAnimations, [], 'Reduced motion must not start entrance animations')
    })
    const result = await page.evaluate(() => {
      const content = Array.from(document.querySelectorAll('h1, h2, h3, .animate-on-scroll, .direction-card, .principle, .about-copy, .contact-panel'))
      return {
        preference: matchMedia('(prefers-reduced-motion: reduce)').matches,
        scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
        heroVisual: Boolean(document.querySelector('.page-background')),
        cssFallback: Boolean(document.querySelector('.page-gradient-fallback')),
        webGlCanvas: document.querySelectorAll('.page-background canvas').length,
        flowerCount: document.querySelectorAll('.story-flower, .story-scene').length,
        runningAnimations: document.getAnimations().filter((animation) => animation.playState === 'running' || animation.pending).map((animation) => animation.animationName ?? animation.id),
        hiddenContent: content.filter((element) => {
          for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
            const style = getComputedStyle(ancestor)
            if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.99) return true
          }
          return false
        }).map((element) => element.textContent.trim()),
      }
    })
    assert.equal(result.preference, true, 'Reduced-motion media preference must be active')
    assert.equal(result.scrollBehavior, 'auto', 'Reduced motion must disable smooth scrolling')
    assert.deepEqual(result.hiddenContent, [], 'Reduced motion must leave all content visible')
    assert.equal(result.heroVisual, true, 'Reduced-motion audit must include the hero visual')
    assert.equal(result.cssFallback, true, 'Reduced motion must use the CSS gradient fallback')
    assert.equal(result.webGlCanvas, 0, 'Reduced motion must not mount a WebGL canvas')
    assert.equal(result.flowerCount, 0, 'Reduced motion must not restore the flower ornament')
    assert.deepEqual(result.runningAnimations, [], 'Reduced motion must not run visual animations')
    const readHeroLayers = () => page.locator('.page-background').evaluate((hero) => [hero, ...hero.querySelectorAll('*')].map((element) => {
      const style = getComputedStyle(element)
      return { tag: element.tagName, className: element.getAttribute('class'), transform: style.transform, opacity: style.opacity }
    }))
    const heroBeforeScroll = await readHeroLayers()
    await page.evaluate(() => window.scrollTo({ top: 500, behavior: 'instant' }))
    await page.waitForTimeout(150)
    assert.deepEqual(await readHeroLayers(), heroBeforeScroll, 'Reduced motion must keep the hero backdrop static while scrolling')
    result.hoverMotion = await assertHoverMotion(page, true)
    const activeAnimations = await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running' || animation.pending).map((animation) => animation.animationName ?? animation.id))
    assert.deepEqual(activeAnimations, [], 'Reduced-motion interactions must not start visual animations')
    assert.deepEqual(observations.consoleErrors, [], 'Reduced-motion console errors')
    assert.deepEqual(observations.pageErrors, [], 'Reduced-motion runtime errors')
    assert.deepEqual(observations.externalRequests, [], 'Reduced-motion page requested an external asset')
    assert.deepEqual(observations.failedRequests, [], 'Reduced-motion failed network requests')
    summary.reducedMotion = { ...result, initialContent, passed: true }
    console.log('PASS reduced motion and visible content')
  } catch (error) {
    failures.push(`reduced-motion: ${error.message}`)
    summary.reducedMotion = { passed: false, error: error.message }
    console.error(`FAIL reduced motion: ${error.message}`)
  } finally {
    await context.close()
  }
}

async function auditLighthouse(executablePath) {
  // Explicitly hide all child windows on Windows, including chrome-launcher's helper.
  lighthouseChrome = new Launcher({
    chromePath: executablePath,
    chromeFlags: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-extensions', '--no-first-run', '--no-default-browser-check'],
    handleSIGINT: false,
    logLevel: 'silent',
  }, { spawn: (command, args, options) => spawn(command, args, { ...options, windowsHide: true, shell: false }) })
  await lighthouseChrome.launch()
  try {
    const result = await lighthouse(baseUrl, {
      port: lighthouseChrome.port,
      logLevel: 'error',
      output: ['json', 'html'],
      onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
      formFactor: 'mobile',
      screenEmulation: { mobile: true, width: 375, height: 812, deviceScaleFactor: 1, disabled: false },
    })
    assert.ok(result, 'Lighthouse did not return a report')
    assert.equal(result.lhr.runtimeError, undefined, `Lighthouse runtime error: ${result.lhr.runtimeError?.message}`)
    const reports = Array.isArray(result.report) ? result.report : [result.report]
    await writeFile(path.join(artifactDirectory, 'lighthouse.json'), reports[0])
    await writeFile(path.join(artifactDirectory, 'lighthouse.html'), reports[1])
    const scores = Object.fromEntries(Object.entries(result.lhr.categories).map(([category, value]) => [category, Math.round((value.score ?? 0) * 100)]))
    summary.lighthouse = { scores, cumulativeLayoutShift: result.lhr.audits['cumulative-layout-shift']?.numericValue }
    console.log(`Lighthouse mobile: ${Object.entries(scores).map(([name, score]) => `${name} ${score}`).join(' · ')}`)
    for (const [category, data] of Object.entries(result.lhr.categories)) {
      assert.ok(data.score !== null && data.score >= 0.9, `Lighthouse ${category} ${scores[category]} is below 90`)
    }
  } catch (error) {
    failures.push(`Lighthouse: ${error.message}`)
    console.error(`FAIL Lighthouse: ${error.message}`)
  } finally {
    lighthouseChrome.kill()
    lighthouseChrome = undefined
  }
}

try {
  await mkdir(artifactDirectory, { recursive: true })
  const executablePath = browserExecutable()
  await startPreview()
  browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-dev-shm-usage'] })
  await auditHero({ name: 'desktop', width: 1440, height: 1000 })
  await auditHero({ name: 'mobile', width: 375, height: 812, coarse: true })
  await auditHero({ name: 'reduced', width: 1440, height: 1000, reduced: true })
  await auditShaderFailure()
  for (const viewport of viewportCases) await auditViewport(viewport)
  await auditScrollReveals()
  await auditWithoutJavaScript()
  await auditReducedMotion()
  await browser.close()
  browser = undefined
  await auditLighthouse(executablePath)
  summary.failures = failures
  await writeFile(path.join(artifactDirectory, 'summary.json'), JSON.stringify(summary, null, 2))
  assert.equal(failures.length, 0, `QA failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`)
  console.log('QA passed. Screenshots, axe reports, Lighthouse reports and summary: .qa/')
} catch (error) {
  console.error(error.stack ?? error.message)
  process.exitCode = 1
} finally {
  await cleanup()
}
