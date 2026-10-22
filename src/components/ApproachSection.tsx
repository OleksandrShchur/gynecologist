import { site } from '../content/site'
import { Glass } from './Glass'
import { Reveal, RevealItem } from './Reveal'

export function ApproachSection() {
  return (
    <section id="pidkhid" className="approach-section section-space page-shell" aria-labelledby="approach-heading">
      <div className="approach-layout section-layout">
        <Reveal className="approach-header section-intro">
          <p className="eyebrow">{site.approach.eyebrow}</p>
          <h2 id="approach-heading" className="section-heading">{site.approach.heading}</h2>
          <p className="section-description">{site.approach.intro}</p>
        </Reveal>
        <div className="principles-stage glass-stage">
          <ol className="principles-grid">
            {site.approach.principles.map((principle, index) => (
              <RevealItem key={principle.title} className="principle" index={index}>
                <Glass
                  className="principle-glass information-glass"
                  cornerRadius={20}
                  padding="0"
                  overLight={false}
                  displacementScale={48}
                  blurAmount={0.035}
                  elasticity={0.12}
                >
                  <div className="principle-content">
                    <span className="principle-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                    <div className="principle-copy">
                      <h3>{principle.title}</h3>
                      <p>{principle.description}</p>
                    </div>
                  </div>
                </Glass>
              </RevealItem>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}
