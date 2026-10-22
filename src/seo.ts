import { site } from './content/site'

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)

export function createHead(): string {
  const { doctor, seo } = site
  const physician = {
    '@context': 'https://schema.org',
    '@type': 'Physician',
    name: doctor.name,
    description: doctor.title,
    medicalSpecialty: [
      'https://schema.org/Gynecologic',
      'https://schema.org/Obstetric',
    ],
    knowsAbout: site.directions.items.map((item) => item.title),
    sameAs: [doctor.instagram],
    ...(doctor.phone ? { telephone: doctor.phone } : {}),
    ...(doctor.city || doctor.address ? { address: { '@type': 'PostalAddress', ...(doctor.city ? { addressLocality: doctor.city } : {}), ...(doctor.address ? { streetAddress: doctor.address } : {}) } } : {}),
    ...(seo.siteUrl ? { url: seo.siteUrl } : {}),
  }

  return [
    `<title>${escapeHtml(seo.title)}</title>`,
    `<meta name="description" content="${escapeHtml(seo.description)}" />`,
    '<meta property="og:type" content="website" />',
    `<meta property="og:locale" content="${escapeHtml(seo.locale)}" />`,
    `<meta property="og:title" content="${escapeHtml(seo.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(seo.description)}" />`,
    `<meta property="og:site_name" content="${escapeHtml(doctor.name)}" />`,
    ...(seo.siteUrl ? [`<link rel="canonical" href="${escapeHtml(seo.siteUrl)}" />`, `<meta property="og:url" content="${escapeHtml(seo.siteUrl)}" />`] : []),
    ...(seo.ogImage ? [`<meta property="og:image" content="${escapeHtml(seo.ogImage)}" />`, `<meta property="og:image:alt" content="${escapeHtml(seo.title)}" />`] : []),
    `<script type="application/ld+json">${JSON.stringify(physician).replace(/</g, '\\u003c')}</script>`,
  ].join('\n    ')
}
