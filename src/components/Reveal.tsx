import type { ReactNode } from 'react'

const revealClass = 'animate-on-scroll [animation:animationIn_0.68s_cubic-bezier(0.22,1,0.36,1)_both]'
const staggerClasses = ['[animation-delay:0ms]', '[animation-delay:50ms]', '[animation-delay:100ms]'] as const

interface RevealProps {
  children: ReactNode
  className?: string
  delay?: number
}

export function Reveal({ children, className = '', delay = 0 }: RevealProps) {
  return (
    <div
      className={`${revealClass} ${className}`}
      style={{ animationDelay: `${delay}s` }}
    >
      {children}
    </div>
  )
}

// Each item observes its own entry, including tall single-column mobile lists.
export function RevealItem({ children, className = '', index = 0 }: RevealProps & { index?: number }) {
  return (
    <li
      className={`${revealClass} ${staggerClasses[index % staggerClasses.length] ?? staggerClasses[0]} ${className}`}
    >
      {children}
    </li>
  )
}
