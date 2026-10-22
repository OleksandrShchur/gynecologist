import { photos } from '../content/images.generated'
import { site } from '../content/site'
import { Glass } from './Glass'
import { Reveal } from './Reveal'

const areas = site.directions.items.map((direction) => direction.title.toLocaleLowerCase('uk-UA'))

export function AboutSection() {
  const { doctor } = site

  return (
    <section id="pro-likaria" className="about-section section-space page-shell" aria-labelledby="about-heading">
      <div className={`about-layout ${photos.standing ? 'with-photo' : 'without-photo'}`}>
        <Reveal className="about-content">
          <div className="about-intro-block section-intro">
            <p className="eyebrow">{site.about.eyebrow}</p>
            <h2 id="about-heading" className="section-heading">{doctor.name}</h2>
            <p className="about-title">{doctor.title}</p>
          </div>
          <div className="about-copy">
            {doctor.bio?.length ? doctor.bio.map((paragraph) => <p key={paragraph}>{paragraph}</p>) : (
              <>
                <p className="about-intro">{site.about.intro}</p>
                <p>{site.about.directionsLead} {areas.join(', ')}.</p>
              </>
            )}
            {doctor.education && doctor.education.length > 0 && (
              <div className="optional-info">
                <h3>{site.labels.education}</h3>
                <ul>{doctor.education.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            )}
            {doctor.yearsOfExperience !== undefined && (
              <p className="optional-info">
                <span className="experience-number">{doctor.yearsOfExperience}</span>{' '}
                {site.labels.experience.toLocaleLowerCase('uk-UA')}
              </p>
            )}
          </div>
        </Reveal>
        {photos.standing && (
          <Reveal className="about-photo-stage" delay={0.05}>
            <Glass
              className="about-photo-glass photo-glass glass-stage"
              cornerRadius={26}
              padding="0"
              overLight={false}
              displacementScale={48}
              blurAmount={0.035}
              elasticity={0.12}
            >
              <div className="about-photo">
                <img
                  src={photos.standing.src}
                  srcSet={photos.standing.srcSet}
                  sizes="(min-width: 640px) clamp(196px, calc(34vw - 24px), 300px), (max-width: 371px) calc(100vw - 72px), 300px"
                  width={photos.standing.width}
                  height={photos.standing.height}
                  alt={site.photos.standingAlt}
                  loading="lazy"
                  decoding="async"
                />
              </div>
            </Glass>
          </Reveal>
        )}
      </div>
    </section>
  )
}
