import React from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
// Weight stylesheets retain unicode-range, so Cyrillic and Latin coexist.
import '@fontsource/cormorant-garamond/500.css'
import '@fontsource/cormorant-garamond/500-italic.css'
import '@fontsource/manrope/400.css'
import '@fontsource/manrope/500.css'
import '@fontsource/manrope/600.css'
import App from './App'
import { createHead } from './seo'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Відсутній кореневий елемент сторінки.')

if (import.meta.env.DEV) document.head.insertAdjacentHTML('beforeend', createHead())

const application = <React.StrictMode><App /></React.StrictMode>
if (root.hasChildNodes() && root.querySelector('main')) hydrateRoot(root, application)
else createRoot(root).render(application)
