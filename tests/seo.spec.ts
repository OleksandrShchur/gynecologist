import { access, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { site, type Doctor } from '../src/content/site'
import { createHead } from '../src/seo'

type SeoOverrides = { -readonly [Key in keyof typeof site.seo]?: (typeof site.seo)[Key] | undefined }
type DoctorOverrides = { -readonly [Key in keyof Doctor]?: Doctor[Key] | undefined }

// Each case restores the shared content, including when an assertion fails.
function withContent(overrides: { doctor?: DoctorOverrides; seo?: SeoOverrides }, check: (head: string) => void) {
  const original = { doctor: site.doctor, seo: site.seo }
  Object.assign(site, {
    doctor: { ...original.doctor, ...overrides.doctor },
    seo: { ...original.seo, ...overrides.seo },
  })
  try {
    check(createHead())
  } finally {
    Object.assign(site, original)
  }
}

function structuredData(html: string) {
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  expect(scripts, 'There should be exactly one JSON-LD document').toHaveLength(1)
  return JSON.parse(scripts[0]![1]!) as Record<string, unknown>
}

test.describe('SEO metadata', () => {
  test('publishes the doctor and practice content in search and social metadata', () => {
    const head = createHead()

    expect(head.match(/<title>/g)).toHaveLength(1)
    expect(head).toContain(`<title>${site.seo.title}</title>`)
    expect(head).toContain(`<meta name="description" content="${site.seo.description}" />`)
    expect(head).toContain('<meta property="og:type" content="website" />')
    expect(head).toContain(`<meta property="og:locale" content="${site.seo.locale}" />`)
    expect(head).toContain(`<meta property="og:title" content="${site.seo.title}" />`)
    expect(head).toContain(`<meta property="og:description" content="${site.seo.description}" />`)
    expect(head).toContain(`<meta property="og:site_name" content="${site.doctor.name}" />`)
    expect(structuredData(head)).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'Physician',
      name: site.doctor.name,
      description: site.doctor.title,
      medicalSpecialty: ['https://schema.org/Gynecologic', 'https://schema.org/Obstetric'],
      knowsAbout: site.directions.items.map((item) => item.title),
      sameAs: [site.doctor.instagram],
    })
  })

  for (const empty of [undefined, '']) {
    test(`omits unconfigured optional metadata when values are ${empty === undefined ? 'absent' : 'empty'}`, () => {
      withContent({
        doctor: { phone: empty, city: empty, address: empty },
        seo: { siteUrl: empty, ogImage: empty },
      }, (head) => {
        expect(head).not.toContain('rel="canonical"')
        expect(head).not.toContain('property="og:url"')
        expect(head).not.toContain('property="og:image')
        const physician = structuredData(head)
        for (const property of ['telephone', 'address', 'url']) {
          expect(physician).not.toHaveProperty(property)
        }
      })
    })
  }

  test('includes the public URL, preview image, and verified contact details when configured', () => {
    const siteUrl = 'https://doctor.example/practice/'
    const ogImage = 'https://doctor.example/preview.webp'
    withContent({
      doctor: { phone: '+380 44 123 45 67', city: 'Kyiv', address: 'Clinic, 12 Example Street' },
      seo: { siteUrl, ogImage },
    }, (head) => {
      expect(head).toContain(`<link rel="canonical" href="${siteUrl}" />`)
      expect(head).toContain(`<meta property="og:url" content="${siteUrl}" />`)
      expect(head).toContain(`<meta property="og:image" content="${ogImage}" />`)
      expect(head).toContain(`<meta property="og:image:alt" content="${site.seo.title}" />`)
      expect(structuredData(head)).toMatchObject({
        telephone: '+380 44 123 45 67',
        url: siteUrl,
        address: {
          '@type': 'PostalAddress',
          addressLocality: 'Kyiv',
          streetAddress: 'Clinic, 12 Example Street',
        },
      })
    })
  })

  test('keeps the canonical URL and preview image independently optional', () => {
    withContent({ seo: { siteUrl: 'https://doctor.example/', ogImage: undefined } }, (head) => {
      expect(head).toContain('rel="canonical"')
      expect(head).not.toContain('property="og:image')
    })
    withContent({ seo: { siteUrl: undefined, ogImage: 'https://doctor.example/preview.webp' } }, (head) => {
      expect(head).toContain('property="og:image"')
      expect(head).toContain('property="og:image:alt"')
      expect(head).not.toContain('rel="canonical"')
      expect(head).not.toContain('property="og:url"')
      expect(structuredData(head)).not.toHaveProperty('url')
    })
  })

  for (const location of [
    { city: 'Kyiv', address: undefined, expected: { '@type': 'PostalAddress', addressLocality: 'Kyiv' } },
    { city: undefined, address: '12 Example Street', expected: { '@type': 'PostalAddress', streetAddress: '12 Example Street' } },
  ]) {
    test(`publishes a partial postal address with only ${location.city ? 'a city' : 'a street'}`, () => {
      withContent({ doctor: { city: location.city, address: location.address } }, (head) => {
        expect(structuredData(head).address).toEqual(location.expected)
      })
    })
  }

  test('escapes all HTML delimiters in text and attributes', () => {
    const hostileText = `Dr. "A&B" <Care> 'clinic'`
    const escapedText = 'Dr. &quot;A&amp;B&quot; &lt;Care&gt; &#39;clinic&#39;'
    const hostileUrl = 'https://doctor.example/?a="<care>"&b=\'clinic\''
    const escapedUrl = 'https://doctor.example/?a=&quot;&lt;care&gt;&quot;&amp;b=&#39;clinic&#39;'
    withContent({
      doctor: { name: hostileText },
      seo: { title: hostileText, description: hostileText, locale: hostileText, siteUrl: hostileUrl, ogImage: hostileUrl },
    }, (head) => {
      expect(head).toContain(`<title>${escapedText}</title>`)
      for (const name of ['description', 'og:title', 'og:description', 'og:locale', 'og:site_name', 'og:image:alt']) {
        expect(head).toContain(`${name === 'description' ? 'name' : 'property'}="${name}" content="${escapedText}"`)
      }
      expect(head).toContain(`<link rel="canonical" href="${escapedUrl}" />`)
      for (const name of ['og:url', 'og:image']) {
        expect(head).toContain(`property="${name}" content="${escapedUrl}"`)
      }
      expect(structuredData(head)).toMatchObject({ name: hostileText, url: hostileUrl })
    })
  })

  test('prevents JSON-LD content from closing its script while preserving the original values', () => {
    const payload = '</script><script>alert("unexpected")</script><!--&\'\n'
    withContent({
      doctor: { name: payload, title: payload, instagram: payload, phone: payload, city: payload, address: payload },
      seo: { title: payload, description: payload, siteUrl: payload, ogImage: payload },
    }, (head) => {
      expect(head.match(/<script\b/g)).toHaveLength(1)
      expect(head.match(/<\/script>/g)).toHaveLength(1)
      expect(head).not.toContain(payload)
      expect(head).toContain('\\u003c/script>')
      expect(structuredData(head)).toMatchObject({
        name: payload,
        description: payload,
        sameAs: [payload],
        telephone: payload,
        address: { addressLocality: payload, streetAddress: payload },
        url: payload,
      })
    })
  })
})

test.describe('production prerender', () => {
  let html: string

  test.beforeAll(async () => {
    html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8')
  })

  test('ships the generated metadata and structured data in the initial HTML', () => {
    expect(html).toContain('<html lang="uk">')
    expect(html).not.toContain('<!--site-head-->')
    expect(html).not.toContain('<!--site-html-->')
    const head = html.match(/<head>([\s\S]*?)<\/head>/)?.[1]
    expect(head).toBeDefined()
    expect(head).toContain(createHead())
    expect(structuredData(html)).toEqual(structuredData(createHead()))
  })

  test('ships the main content and all navigation targets before JavaScript runs', () => {
    expect(html.match(/<h1\b/g)).toHaveLength(1)
    expect(html).toMatch(/<main\b[^>]*id="main"/)
    for (const target of [...site.navigation.map((item) => item.href.slice(1)), 'kontakty', 'pochatok']) {
      expect(html, `The #${target} navigation target must exist in the static HTML`).toContain(`id="${target}"`)
    }
    for (const line of site.hero.mottoLines) expect(html).toContain(line)
    for (const direction of site.directions.items) {
      expect(html).toContain(`<h3>${direction.title}</h3>`)
      expect(html).toContain(`<p>${direction.description}</p>`)
    }
    expect(html).toContain(site.doctor.name)
    expect(html).toContain(site.footer.note)
    expect(html).toContain(`href="${site.doctor.instagram}"`)
  })

  test('resolves image candidates, fonts, scripts, and styles to emitted production files', async () => {
    expect(html).not.toMatch(/(?:src|href|srcSet)="[^\"]*(?:\/src\/|\/node_modules\/)/i)
    const references = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((match) => match[1]!)
    for (const match of html.matchAll(/\bsrcset="([^"]+)"/gi)) {
      references.push(...match[1]!.split(',').map((candidate) => candidate.trim().split(/\s+/)[0]!))
    }
    const emittedAssets = [...new Set(references.flatMap((reference) => {
      const pathname = new URL(reference, 'https://doctor.example/').pathname
      const assetStart = pathname.indexOf('/assets/')
      return assetStart < 0 ? [] : [pathname.slice(assetStart + 1)]
    }))]
    for (const extension of ['webp', 'woff2', 'js', 'css']) {
      expect(emittedAssets.some((asset) => asset.endsWith(`.${extension}`)), `Expected a production ${extension} asset`).toBe(true)
    }
    for (const asset of emittedAssets) {
      const assetUrl = new URL(`../dist/${asset}`, import.meta.url)
      await expect(access(assetUrl), `Missing production asset: ${fileURLToPath(assetUrl)}`).resolves.toBeUndefined()
    }
  })
})
