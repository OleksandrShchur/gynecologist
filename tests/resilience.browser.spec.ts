import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'

const gradientModule = /\/HeroGradient-[^/]+\.js(?:\?|$)/
const motto = 'Доказово. Без стресу. З турботою.'

async function waitForHydration(page: Page) {
  // Prerendered HTML already looks complete. Wait for the first enhancement
  // effect before asserting preferences or interacting with React handlers.
  await expect(page.locator('.animate-on-scroll').first())
    .toHaveAttribute('data-scroll-state', /^(pending|running|done)$/)
}

async function expectReadableContent(page: Page) {
  await expect.poll(() => page.locator('main h1, main h2, main h3, main p').evaluateAll((elements) =>
    elements.filter((element) => {
      for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor)
        if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) < 0.99) return true
      }
      return false
    }).map((element) => element.textContent?.trim()),
  ), { message: 'Text must remain readable, including sections below the fold' }).toEqual([])
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(motto)
}

async function expectNoRunningAnimations(page: Page) {
  await expect.poll(() => page.evaluate(() =>
    document.getAnimations().filter((animation) => animation.playState === 'running' || animation.pending).length,
  ), { message: 'Reduced motion must stop decorative and content animations' }).toBe(0)
}

async function expectNoAccessibilityViolations(page: Page, testInfo: TestInfo, state: string) {
  await page.evaluate(() => document.fonts.ready)
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()

  if (violations.length > 0) {
    await testInfo.attach(`accessibility-${state}`, {
      body: JSON.stringify(violations, null, 2),
      contentType: 'application/json',
    })
  }
  expect(violations, `${state}: automated WCAG A/AA violations`).toEqual([])
}

test.describe('Accessibility', () => {
  // Expose every section and keep the painted background stable during axe's
  // contrast checks. The motion preference has its own behavioral tests below.
  test.use({ reducedMotion: 'reduce' })

  test('has no automated WCAG A/AA violations across the complete page', async ({ page }, testInfo) => {
    await page.goto('./')
    await waitForHydration(page)
    await expectReadableContent(page)
    await expectNoAccessibilityViolations(page, testInfo, 'page')
  })

  test('has no automated WCAG A/AA violations with the mobile menu open', async ({ page }, testInfo) => {
    await page.goto('./')
    await waitForHydration(page)
    const menu = page.locator('summary[aria-label="Меню"]')
    test.skip(!await menu.isVisible(), 'This viewport uses desktop navigation')

    await menu.click()
    await expect(page.getByRole('navigation', { name: 'Основна навігація' })).toBeVisible()
    await expectNoAccessibilityViolations(page, testInfo, 'open-menu')
  })
})

test.describe('Prerendered HTML', () => {
  test.use({ javaScriptEnabled: false, reducedMotion: 'reduce' })

  test('keeps content, native navigation and contact links usable without JavaScript', async ({ page }) => {
    await page.goto('./')
    await expectReadableContent(page)

    const menu = page.locator('summary[aria-label="Меню"]')
    if (await menu.isVisible()) await menu.click()
    await page.getByRole('navigation', { name: 'Основна навігація' })
      .getByRole('link', { name: 'Напрями', exact: true }).click()
    await expect(page).toHaveURL(/#napriamy$/)
    await expect(page.locator('#napriamy').getByRole('heading', { level: 2 })).toBeInViewport()

    await page.getByRole('banner').getByRole('link', { name: 'Контакти', exact: true }).click()
    await expect(page).toHaveURL(/#kontakty$/)
    await expect(page.getByRole('heading', { name: 'Будьмо на зв’язку' })).toBeInViewport()
    await expect(page.locator('#kontakty').getByRole('link', { name: /Instagram/ }))
      .toHaveAttribute('href', 'https://www.instagram.com/o.perhulyn/')

    await page.getByRole('link', { name: 'На початок', exact: true }).click()
    await expect(page).toHaveURL(/#pochatok$/)
    await expect(page.getByRole('banner')).toBeInViewport()
  })
})

test.describe('Reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('keeps all content readable and avoids downloading the animated background', async ({ page }) => {
    const gradientRequests: string[] = []
    page.on('request', (request) => {
      if (gradientModule.test(request.url())) gradientRequests.push(request.url())
    })

    await page.goto('./')
    await waitForHydration(page)
    await expectReadableContent(page)
    await expect(page.locator('html')).toHaveCSS('scroll-behavior', 'auto')
    await expect(page.locator('.page-gradient-fallback')).toBeVisible()
    await expect(page.locator('.page-background canvas')).toHaveCount(0)
    await expectNoRunningAnimations(page)

    await page.getByRole('banner').getByRole('link', { name: 'Контакти', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Будьмо на зв’язку' })).toBeInViewport()
    await expectNoRunningAnimations(page)
    expect(gradientRequests, 'Reduced motion must avoid the Three.js background download').toEqual([])
  })
})

test.describe('Progressive enhancements', () => {
  test.use({ reducedMotion: 'no-preference' })

  test('applies a changed reduced-motion preference to content that has not been visited', async ({ page }) => {
    await page.goto('./')
    await waitForHydration(page)
    await expect(page.locator('#kontakty')).not.toBeInViewport()
    await expect(page.locator('#kontakty .animate-on-scroll')).toHaveAttribute('data-scroll-state', 'pending')

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(page.locator('#kontakty .animate-on-scroll')).toHaveAttribute('data-scroll-state', 'done')
    await expectReadableContent(page)
    await expect(page.locator('.page-background canvas')).toHaveCount(0)
    await expectNoRunningAnimations(page)
    await expect(page.locator('html')).toHaveCSS('scroll-behavior', 'auto')
  })

  test('avoids animated-background downloads when Save-Data is enabled', async ({ page }) => {
    await page.addInitScript(() => {
      const connection = new EventTarget()
      Object.defineProperty(connection, 'saveData', { value: true })
      Object.defineProperty(navigator, 'connection', { configurable: true, value: connection })
    })
    const gradientRequests: string[] = []
    page.on('request', (request) => {
      if (gradientModule.test(request.url())) gradientRequests.push(request.url())
    })

    await page.goto('./')
    await waitForHydration(page)
    await expect(page.locator('.page-background')).toHaveAttribute('data-motion', 'disabled')
    await expect(page.locator('.page-gradient-fallback')).toBeVisible()
    await expect(page.locator('.page-gradient-fallback')).toHaveCSS('animation-name', 'none')
    await expect(page.locator('.page-background canvas')).toHaveCount(0)

    await page.getByRole('banner').getByRole('link', { name: 'Контакти', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Будьмо на зв’язку' })).toBeInViewport()
    expect(gradientRequests, 'Data saving must avoid the Three.js background download').toEqual([])
  })

  test('keeps sections readable and navigation usable when IntersectionObserver is unavailable', async ({ page }) => {
    await page.addInitScript(() => { Reflect.deleteProperty(window, 'IntersectionObserver') })
    await page.goto('./')
    await waitForHydration(page)
    await expectReadableContent(page)

    await page.getByRole('banner').getByRole('link', { name: 'Контакти', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Будьмо на зв’язку' })).toBeInViewport()
    await expect(page.locator('#kontakty .animate-on-scroll')).toHaveAttribute('data-scroll-state', 'done')
  })

  test('keeps the fallback and contact journey usable when the animated-background import fails', async ({ page }) => {
    let blockedRequests = 0
    await page.route(gradientModule, async (route) => {
      blockedRequests += 1
      await route.abort('failed')
    })
    await page.goto('./')
    const animatedBackgroundSupported = await page.evaluate(() =>
      matchMedia('(min-width: 768px)').matches
      && matchMedia('(hover: hover) and (pointer: fine)').matches
      && 'WebGL2RenderingContext' in window,
    )
    test.skip(!animatedBackgroundSupported, 'This device uses the static background')

    await expect.poll(() => blockedRequests, { message: 'The optional background must actually fail to load' }).toBe(1)
    await expect(page.locator('.page-background')).toHaveAttribute('data-gradient-state', 'error')
    await expect(page.locator('.page-gradient-fallback')).toBeVisible()
    await expect(page.locator('.page-gradient-fallback')).toHaveCSS('background-image', /gradient/)
    await expect(page.locator('.page-background canvas')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(motto)

    await page.getByRole('banner').getByRole('link', { name: 'Контакти', exact: true }).click()
    await expect(page).toHaveURL(/#kontakty$/)
    await expect(page.getByRole('heading', { name: 'Будьмо на зв’язку' })).toBeInViewport()
    await expect(page.locator('#kontakty').getByRole('link', { name: /Instagram/ }))
      .toHaveAttribute('href', 'https://www.instagram.com/o.perhulyn/')
  })
})
