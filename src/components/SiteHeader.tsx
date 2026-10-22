import { Menu, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { site } from '../content/site'
import { Glass } from './Glass'

export function SiteHeader() {
  const mobileMenu = useRef<HTMLDetailsElement>(null)
  const [activeHref, setActiveHref] = useState<string | null>(null)
  const closeMenu = useCallback(() => {
    if (mobileMenu.current) mobileMenu.current.open = false
  }, [])

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !mobileMenu.current?.contains(event.target)) closeMenu()
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !mobileMenu.current?.open) return
      event.preventDefault()
      const summary = mobileMenu.current.querySelector('summary')
      closeMenu()
      if (summary?.getClientRects().length) summary.focus({ preventScroll: true })
    }
    const desktop = window.matchMedia('(min-width: 1024px)')
    const onResize = () => { if (desktop.matches) closeMenu() }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', dismissOnEscape)
    desktop.addEventListener('change', onResize)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', dismissOnEscape)
      desktop.removeEventListener('change', onResize)
    }
  }, [closeMenu])

  useEffect(() => {
    if (!('IntersectionObserver' in window)) return
    const hrefs = [...new Set([...site.navigation.map((link) => link.href), '#kontakty'])]
    const sections = hrefs
      .map((href) => document.getElementById(href.slice(1)))
      .filter((section): section is HTMLElement => section !== null)
    const visibleSections = new Set<HTMLElement>()
    let footerVisible = false
    const updateActiveSection = () => {
      const visible = sections.filter((section) => visibleSections.has(section))
      // Short final sections cannot always reach the observation band. At the
      // footer, keep an explicit visible destination or select the last section.
      const current = footerVisible
        ? sections.find((section) => `#${section.id}` === window.location.hash && section.getBoundingClientRect().top >= -1) ?? sections.at(-1)
        // Compact sections can share the band. Prefer the first heading still
        // below the top edge before advancing to a later section.
        : visible.find((section) => section.getBoundingClientRect().top >= -1) ?? visible.at(-1)
      setActiveHref(current ? `#${current.id}` : null)
    }
    let observer: IntersectionObserver | undefined
    const observeSections = () => {
      observer?.disconnect()
      visibleSections.clear()
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const section = entry.target as HTMLElement
          if (entry.isIntersecting) visibleSections.add(section)
          else visibleSections.delete(section)
        }
        updateActiveSection()
      }, { rootMargin: `0px 0px -${Math.round(window.innerHeight * 0.55)}px 0px`, threshold: 0 })
      sections.forEach((section) => observer?.observe(section))
    }
    const footer = document.querySelector('footer')
    const footerObserver = new IntersectionObserver(([entry]) => {
      footerVisible = Boolean(entry?.isIntersecting && entry.intersectionRatio === 1)
      updateActiveSection()
    }, { rootMargin: '0px 0px 2px 0px', threshold: 1 })
    if (footer) footerObserver.observe(footer)
    observeSections()
    window.addEventListener('resize', observeSections)
    window.addEventListener('hashchange', updateActiveSection)
    return () => {
      observer?.disconnect()
      footerObserver.disconnect()
      window.removeEventListener('resize', observeSections)
      window.removeEventListener('hashchange', updateActiveSection)
    }
  }, [])

  return (
    <header className="site-header page-shell" id="pochatok" data-active-section={activeHref?.slice(1)}>
      <a href="#pochatok" className="wordmark" onClick={closeMenu}>
        <span className="wordmark-emblem" aria-hidden="true">{site.doctor.initials}</span>
        <span className="wordmark-name">{site.doctor.name}{' '}<span>{site.doctor.title}</span></span>
      </a>
      <nav className="desktop-navigation" aria-label={site.labels.navigation}>
        {site.navigation.map((link) => (
          <a key={link.href} href={link.href} aria-current={activeHref === link.href ? 'location' : undefined}>
            {link.label}
          </a>
        ))}
      </nav>
      <Glass
        className="header-contact-glass information-glass action-glass"
        cornerRadius={16}
        padding="0"
        overLight={false}
        displacementScale={48}
        blurAmount={0.035}
        elasticity={0.12}
      >
        <a className="header-contact" href="#kontakty" aria-current={activeHref === '#kontakty' ? 'location' : undefined} onClick={closeMenu}>
          {site.labels.contacts}
        </a>
      </Glass>
      <details ref={mobileMenu} className="mobile-navigation">
        <summary
          aria-label={site.labels.menu}
          onClick={(event) => {
            event.preventDefault()
            const menu = mobileMenu.current
            if (menu) menu.open = !menu.open
          }}
        >
          <Menu className="menu-open-icon" size={20} strokeWidth={1.5} aria-hidden="true" />
          <X className="menu-close-icon" size={20} strokeWidth={1.5} aria-hidden="true" />
        </summary>
        <nav aria-label={site.labels.navigation}>
          {site.navigation.map((link) => (
            <a key={link.href} href={link.href} aria-current={activeHref === link.href ? 'location' : undefined} onClick={closeMenu}>
              {link.label}
            </a>
          ))}
        </nav>
      </details>
    </header>
  )
}
