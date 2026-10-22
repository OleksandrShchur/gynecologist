import { ArrowUpRight, Instagram } from 'lucide-react'
import type { ReactNode } from 'react'
import { site } from '../content/site'

interface InstagramLinkProps {
  children?: ReactNode
  className?: string
  showIcon?: boolean
  showArrow?: boolean
}

export function InstagramLink({ children = site.labels.myInstagram, className = '', showIcon = true, showArrow = true }: InstagramLinkProps) {
  return (
    <a href={site.doctor.instagram} target="_blank" rel="noopener noreferrer" className={`instagram-link ${className}`}>
      {showIcon && <Instagram size={18} strokeWidth={1.5} aria-hidden="true" />}
      <span>{children}</span>
      {showArrow && <ArrowUpRight className="link-arrow" size={18} strokeWidth={1.5} aria-hidden="true" />}
      <span className="sr-only">{site.labels.newTab}</span>
    </a>
  )
}
