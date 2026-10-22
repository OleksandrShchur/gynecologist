import { m, useReducedMotion } from 'motion/react'
import { useRef } from 'react'
import { photos } from '../content/images.generated'
import { site } from '../content/site'
import { entrance, motionTiming } from '../motion'
import { Glass } from './Glass'
import { InstagramLink } from './InstagramLink'

export function HeroSection() {
  const reducedMotion = useReducedMotion()
  const surfaceRef = useRef<HTMLDivElement>(null)

  return (
    <section className="hero" aria-labelledby="hero-heading">
      <div ref={surfaceRef} className="hero-surface">
        <div className="hero-layout page-shell">
          <div className="hero-copy">
            <h1 id="hero-heading" className="hero-heading">
              {site.hero.mottoLines.map((line, index) => (
                <m.span
                  key={line}
                  className={index === 2 ? 'font-accent' : ''}
                  initial={false}
                  {...(reducedMotion ? {} : { animate: entrance(0.08 + index * motionTiming.stagger, 10) })}
                >
                  {line}{index < site.hero.mottoLines.length - 1 && ' '}
                </m.span>
              ))}
            </h1>
            <m.p
              className="hero-subtitle"
              initial={false}
              {...(reducedMotion ? {} : { animate: entrance(0.22, 8) })}
            >
              {site.hero.subtitle}
            </m.p>
            <m.div
              className="hero-actions"
              initial={false}
              {...(reducedMotion ? {} : { animate: entrance(0.28, 8) })}
            >
              <Glass
                className="hero-cta-glass information-glass action-glass"
                cornerRadius={20}
                padding="0"
                mouseContainer={surfaceRef}
                overLight={false}
                displacementScale={48}
                blurAmount={0.035}
                elasticity={0.12}
              >
                <InstagramLink className="button button-glass" />
              </Glass>
            </m.div>
          </div>
          {photos.portrait && (
            <Glass
              className="hero-doctor hero-photo-glass photo-glass glass-stage"
              cornerRadius={26}
              padding="0"
              overLight={false}
              displacementScale={48}
              blurAmount={0.035}
              elasticity={0.12}
            >
              <img
                src={photos.portrait.src}
                srcSet={photos.portrait.srcSet}
                sizes="(min-width: 1080px) 416px, (min-width: 1024px) calc(48vw - 88px), (min-width: 640px) 260px, clamp(204px, calc(68vw - 20px), 260px)"
                width={photos.portrait.width}
                height={photos.portrait.height}
                alt={site.photos.portraitAlt}
                loading="eager"
                {...{ fetchpriority: 'high' }}
                decoding="async"
              />
            </Glass>
          )}
        </div>
      </div>
    </section>
  )
}
