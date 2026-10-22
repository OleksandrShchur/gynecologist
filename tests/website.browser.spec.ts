import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { site } from '../src/content/site'

// Keep content and navigation checks independent of GPU-backed decoration.
// Motion preferences and enhancement failures are exercised in resilience tests.
test.use({ reducedMotion: 'reduce' })

async function expectAnchorDestination(page: Page, hash: string) {
  // Being partly visible can happen before native anchor scrolling finishes.
  await expect.poll(() => page.locator(hash).evaluate(element => {
    const padding = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0
    const margin = parseFloat(getComputedStyle(element).scrollMarginTop) || 0
    const target = element.getBoundingClientRect().top + scrollY - padding - margin
    const destination = Math.max(0, Math.min(document.documentElement.scrollHeight - innerHeight, target))
    return Math.abs(scrollY - destination)
  }), { message: `The browser must finish scrolling to ${hash}` }).toBeLessThanOrEqual(2)
}

test('visitors can read the doctor profile, practice areas, and contact details', async ({ page }) => {
  await page.goto('./')
  await expect(page).toHaveTitle(site.seo.title)
  await expect(page.locator('html')).toHaveAttribute('lang', 'uk')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Доказово. Без стресу. З турботою.')
  await expect(page.getByText(site.hero.subtitle, { exact: true })).toBeVisible()

  const directions = page.getByRole('region', { name: site.directions.heading.replace('\n', ' ') })
  for (const direction of site.directions.items) {
    await expect(directions.getByRole('heading', { name: direction.title, exact: true })).toBeVisible()
    await expect(directions.getByText(direction.description, { exact: true })).toBeVisible()
  }
  for (const principle of site.approach.principles) {
    await expect(page.getByRole('heading', { name: principle.title, exact: true })).toBeVisible()
  }
  await expect(page.getByText(site.about.intro, { exact: true })).toBeVisible()
  await expect(page.getByRole('contentinfo')).toContainText(site.footer.note)
})

for (const destination of site.navigation) {
  test(`navigation reaches ${destination.href} and identifies the current section`, async ({ page, isMobile }) => {
    await page.goto('./')
    if (isMobile) await page.getByLabel(site.labels.menu, { exact: true }).click()
    const navigation = page.locator(isMobile ? '.mobile-navigation nav' : '.desktop-navigation')
    const link = navigation.getByRole('link', { name: destination.label, exact: true, includeHidden: true })
    await link.click()

    await expect(page).toHaveURL(new RegExp(`${destination.href}$`))
    await expect(page.locator(destination.href).getByRole('heading', { level: 2 })).toBeInViewport()
    await expectAnchorDestination(page, destination.href)
    await expect(link).toHaveAttribute('aria-current', 'location')
    if (isMobile) await expect(page.locator('details')).not.toHaveAttribute('open', '')
  })
}

test('contacts and footer links take visitors to their destinations', async ({ page }) => {
  await page.goto('./')
  const contacts = page.getByRole('banner').getByRole('link', { name: site.labels.contacts, exact: true })
  await contacts.click()
  await expect(page).toHaveURL(/#kontakty$/)
  await expect(page.getByRole('heading', { name: site.contact.heading })).toBeInViewport()
  await expectAnchorDestination(page, '#kontakty')
  await expect(contacts).toHaveAttribute('aria-current', 'location')

  await page.getByRole('link', { name: site.labels.backToTop, exact: true }).click()
  await expect(page).toHaveURL(/#pochatok$/)
  await expect(page.getByRole('banner')).toBeInViewport()
  await expect(contacts).not.toHaveAttribute('aria-current', 'location')
})

for (const hash of ['#pro-likaria', '#kontakty']) {
  test(`direct links and reload preserve the destination ${hash}`, async ({ page }) => {
    await page.goto(`./${hash}`)
    const heading = page.locator(hash).getByRole('heading', { level: 2 })
    await expect(heading).toBeInViewport()
    await expectAnchorDestination(page, hash)
    await page.reload()
    await expect(page).toHaveURL(new RegExp(`${hash}$`))
    await expect(heading).toBeInViewport()
    await expectAnchorDestination(page, hash)
    for (const link of await page.locator(`header a[href="${hash}"]`).all()) {
      await expect(link).toHaveAttribute('aria-current', 'location')
    }
  })
}

test('the first keyboard action exposes the skip link and moves focus to main', async ({ page }) => {
  await page.goto('./')
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: site.labels.skipToContent })
  await expect(skip).toBeFocused()
  await expect(skip).toBeInViewport()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('main')).toBeFocused()
  await expect(page).toHaveURL(/#main$/)
})

test('every internal link points to an existing unique destination', async ({ page }) => {
  await page.goto('./')
  const invalidLinks = await page.locator('a[href^="#"]').evaluateAll(links => links.flatMap(link => {
    const href = link.getAttribute('href') ?? ''
    const targets = [...document.querySelectorAll('[id]')].filter(target => target.id === href.slice(1))
    return targets.length === 1 ? [] : [href]
  }))
  expect(invalidLinks).toEqual([])
})

test('both Instagram actions open the correct account in a protected new tab', async ({ page }) => {
  await page.goto('./')
  const links = page.getByRole('link').filter({ hasText: /Instagram/ })
  await expect(links).toHaveCount(2)
  const visited: string[] = []
  // Fulfill the destination locally so the test never relies on Instagram or sends a message.
  await page.context().route('https://www.instagram.com/**', async route => {
    visited.push(route.request().url())
    await route.fulfill({ contentType: 'text/html', body: '<title>Instagram destination</title>' })
  })

  for (const link of await links.all()) {
    await expect(link).toHaveAttribute('href', 'https://www.instagram.com/o.perhulyn/')
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', /\bnoopener\b/)
    await expect(link).toHaveAttribute('rel', /\bnoreferrer\b/)
    await expect(link).toHaveAccessibleName(new RegExp(site.labels.newTab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    const popupPromise = page.waitForEvent('popup')
    await link.click()
    const popup = await popupPromise
    await expect(popup).toHaveURL('https://www.instagram.com/o.perhulyn/')
    await expect.poll(() => popup.evaluate(() => window.opener === null)).toBe(true)
    await popup.close()
  }
  expect(visited).toEqual([site.doctor.instagram, site.doctor.instagram])
})

test('photos decode and all resources load locally without browser errors', async ({ page, baseURL }) => {
  const errors: string[] = []
  const externalRequests: string[] = []
  const origin = new URL(baseURL!).origin
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`))
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`) })
  page.on('request', request => {
    const url = new URL(request.url())
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) externalRequests.push(url.href)
  })
  await page.goto('./')
  const photos = [page.getByRole('img', { name: site.photos.portraitAlt }), page.getByRole('img', { name: site.photos.standingAlt })]
  for (const photo of photos) {
    await photo.scrollIntoViewIfNeeded()
    await expect(photo).toBeVisible()
    await expect.poll(() => photo.evaluate(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)).toBe(true)
    await photo.evaluate(image => (image as HTMLImageElement).decode())
    const source = await photo.evaluate(image => (image as HTMLImageElement).currentSrc)
    expect(new URL(source).origin).toBe(origin)
    expect(new URL(source).pathname).toMatch(/\/assets\/photo-.*\.webp$/)
  }
  await page.getByRole('link', { name: site.labels.backToTop, exact: true }).scrollIntoViewIfNeeded()
  await page.waitForLoadState('networkidle')
  expect(errors).toEqual([])
  expect(externalRequests).toEqual([])
})

test('the layout stays inside narrow, tablet, and desktop viewports', async ({ page }) => {
  await page.goto('./')
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => document.fonts.ready)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const menu = page.getByLabel(site.labels.menu, { exact: true })
    if (width < 1024) await expect(menu).toBeVisible()
    else await expect(menu).toBeHidden()
  }
})

test.describe('mobile menu', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(!isMobile, 'The disclosure menu is only visible on smaller screens.')
    await page.goto('./')
  })

  test('keyboard opening and Escape restore focus and hide its links', async ({ page }) => {
    const menu = page.getByLabel(site.labels.menu, { exact: true })
    await menu.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('details')).toHaveAttribute('open', '')
    await page.keyboard.press('Tab')
    await expect(page.locator('nav:visible').getByRole('link').first()).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.locator('details')).not.toHaveAttribute('open', '')
    await expect(menu).toBeFocused()
    await page.keyboard.press('Space')
    await expect(page.locator('details')).toHaveAttribute('open', '')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/#napriamy$/)
    await expect(page.locator('details')).not.toHaveAttribute('open', '')
  })

  test('an outside click dismisses the menu', async ({ page }) => {
    await page.getByLabel(site.labels.menu, { exact: true }).click()
    await expect(page.locator('details')).toHaveAttribute('open', '')
    await page.getByRole('heading', { level: 1 }).click()
    await expect(page.locator('details')).not.toHaveAttribute('open', '')
  })

  test('resizing to desktop closes the menu before returning to mobile', async ({ page }) => {
    await page.getByLabel(site.labels.menu, { exact: true }).click()
    await expect(page.locator('details')).toHaveAttribute('open', '')
    await page.setViewportSize({ width: 1024, height: 900 })
    await expect(page.locator('details')).not.toHaveAttribute('open', '')
    await page.setViewportSize({ width: 375, height: 812 })
    await expect(page.getByLabel(site.labels.menu, { exact: true })).toBeVisible()
    await expect(page.locator('nav:visible')).toHaveCount(0)
  })
})
