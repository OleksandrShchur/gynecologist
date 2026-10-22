import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'

// Build-time HTML only. Nothing runs on a server after deployment.
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const [{ default: App }, { createHead }] = await Promise.all([
    server.ssrLoadModule('/src/App.tsx'),
    server.ssrLoadModule('/src/seo.ts'),
  ])
  const template = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8')
  // Vite's SSR asset paths are source paths; map them to the built, hashed assets.
  const { readdir } = await import('node:fs/promises')
  const assets = await readdir(new URL('../dist/assets/', import.meta.url))
  const sourceAssetPrefix = `${server.config.base}src/assets/generated/`
  const sourceAssetPattern = new RegExp(`${sourceAssetPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([a-z-]+-\\d+)\\.webp`, 'g')
  const markup = renderToString(createElement(App)).replace(sourceAssetPattern, (source, name) => {
    const asset = assets.find((file) => file.startsWith(`${name}-`) && file.endsWith('.webp'))
    return asset ? `${server.config.base}assets/${asset}` : source
  })
  await writeFile(new URL('../dist/index.html', import.meta.url), template.replace('<!--site-head-->', createHead()).replace('<!--site-html-->', markup))
  console.log('Готово: статичний HTML, SEO та JSON-LD з даних site.ts.')
} finally {
  await server.close()
}
