import type { TargetAndTransition } from 'motion/react'

export const motionTiming = {
  ease: [0.22, 1, 0.36, 1] as const,
  reveal: 0.68,
  stagger: 0.05,
}

// Visible static HTML is the starting point; motion never gates content or links.
export function entrance(delay = 0, distance = 18): TargetAndTransition {
  return {
    opacity: [0.98, 1],
    transform: [`translateY(${distance}px)`, 'translateY(0px)'],
    transition: { duration: motionTiming.reveal, delay, ease: motionTiming.ease },
  }
}
