import { ArrowUp, ArrowUpRight, Instagram } from 'lucide-react'
import { domAnimation, LazyMotion, MotionConfig } from 'motion/react'
import { useEffect } from 'react'
import { AboutSection } from './components/AboutSection'
import { ApproachSection } from './components/ApproachSection'
import { DirectionIcon } from './components/DirectionIcon'
import { Glass } from './components/Glass'
import { HeroSection } from './components/HeroSection'
import { InstagramLink } from './components/InstagramLink'
import { PageBackground } from './components/PageBackground'
import { Reveal, RevealItem } from './components/Reveal'
import { SiteHeader } from './components/SiteHeader'
import { site, type Direction } from './content/site'
import { initInViewAnimations } from './scroll-animations'

function DirectionCard({ direction }: { direction: Direction }) {
  return (
    <div className="direction-card">
      <div className="direction-heading">
        <span className="direction-icon" aria-hidden="true"><DirectionIcon name={direction.icon} /></span>
        <h3>{direction.title}</h3>
      </div>
      <p>{direction.description}</p>
    </div>
  )
}

function Directions() {
  return (
    <section id="napriamy" className="section-space page-shell" aria-labelledby="directions-heading">
      <div className="directions-layout section-layout">
        <Reveal className="section-header section-intro">
          <p className="eyebrow">{site.directions.eyebrow}</p>
          <h2 id="directions-heading" className="section-heading">{site.directions.heading}</h2>
          <p className="section-description">{site.directions.intro}</p>
        </Reveal>
        <div className="directions-stage glass-stage">
          <ul className="directions-grid">
            {site.directions.items.map((direction, index) => (
              <RevealItem key={direction.title} className="direction-reveal" index={index}>
                <Glass
                  className="direction-glass information-glass"
                  cornerRadius={20}
                  padding="0"
                  overLight={false}
                  displacementScale={48}
                  blurAmount={0.035}
                  elasticity={0.12}
                >
                  <DirectionCard direction={direction} />
                </Glass>
              </RevealItem>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

function Contact() {
  const { doctor } = site
  const location = [doctor.city, doctor.address].filter(Boolean).join(', ')
  return (
    <section id="kontakty" className="contact-section page-shell" aria-labelledby="contact-heading">
      <Reveal className="contact-panel">
        <div className="contact-intro">
          <p className="eyebrow">{site.contact.eyebrow}</p>
          <h2 id="contact-heading" className="section-heading">{site.contact.heading}</h2>
          <p className="contact-description">{site.contact.description}</p>
        </div>
        <div className="contact-channels glass-stage">
          <Glass
            className="contact-glass information-glass"
            cornerRadius={20}
            padding="0"
            overLight={false}
            displacementScale={56}
            blurAmount={0.035}
            elasticity={0.12}
          >
            <InstagramLink className="contact-instagram" showIcon={false} showArrow={false}>
              <span className="contact-account-row">
                <span className="contact-social-icon" aria-hidden="true"><Instagram size={24} strokeWidth={1.5} /></span>
                <span className="contact-account">
                  <span className="contact-channel">Instagram</span>
                  <span className="contact-handle">{doctor.instagramHandle}</span>
                </span>
              </span>
              <span className="contact-action">
                {site.contact.action}
                <ArrowUpRight className="link-arrow" size={20} strokeWidth={1.75} aria-hidden="true" />
              </span>
            </InstagramLink>
          </Glass>
        </div>
        {(doctor.phone || location) && (
          <dl className="contact-details">
            {doctor.phone && (
              <div>
                <dt>{site.labels.phone}</dt>
                <dd>
                  <a href={`tel:${doctor.phone.replace(/[^\d+]/g, '')}`}>{doctor.phone}</a>
                </dd>
              </div>
            )}
            {location && (
              <div>
                <dt>{site.labels.address}</dt>
                <dd>{location}</dd>
              </div>
            )}
          </dl>
        )}
      </Reveal>
    </section>
  )
}

function Footer() {
  return (
    <footer className="site-footer page-shell">
      <div className="footer-meta">
        <p className="footer-note">{site.footer.note}</p>
        <p className="footer-copyright">© {new Date().getFullYear()} {site.doctor.name}</p>
      </div>
      <Glass
        className="footer-top-glass information-glass action-glass"
        cornerRadius={16}
        padding="0"
        overLight={false}
        displacementScale={48}
        blurAmount={0.035}
        elasticity={0.12}
      >
        <a className="footer-top" href="#pochatok" aria-label={site.labels.backToTop} title={site.labels.backToTop}>
          <span className="footer-top-label">{site.labels.backToTop}</span>
          <ArrowUp size={20} strokeWidth={1.75} aria-hidden="true" />
        </a>
      </Glass>
    </footer>
  )
}

export default function App() {
  useEffect(() => initInViewAnimations(), [])

  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <PageBackground />
        <a href="#main" className="skip-link">{site.labels.skipToContent}</a>
        <SiteHeader />
        <main id="main" tabIndex={-1}>
          <HeroSection />
          <Directions />
          <ApproachSection />
          <AboutSection />
          <Contact />
        </main>
        <Footer />
      </MotionConfig>
    </LazyMotion>
  )
}
