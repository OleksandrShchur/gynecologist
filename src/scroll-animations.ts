export const scrollAnimationOptions = {
  threshold: 0.2,
  rootMargin: '0px 0px -10% 0px',
} as const

const unfinished = new Set<HTMLElement>()
const completed = new WeakSet<HTMLElement>()
let observer: IntersectionObserver | undefined
let motionPreference: MediaQueryList | undefined
let listening = false

function complete(element: HTMLElement): void {
  observer?.unobserve(element)
  unfinished.delete(element)
  completed.add(element)
  element.classList.add('animate')
  element.dataset.scrollState = 'done'
}

function onAnimationEnd(event: AnimationEvent): void {
  if (event.animationName === 'animationIn' && event.target instanceof HTMLElement && unfinished.has(event.target)) {
    complete(event.target)
  }
}

function onFocus(event: FocusEvent): void {
  if (!(event.target instanceof Element)) return
  // Keyboard focus always exposes its content immediately, even mid-reveal.
  let element = event.target.closest<HTMLElement>('.animate-on-scroll')
  while (element) {
    if (unfinished.has(element)) complete(element)
    element = element.parentElement?.closest<HTMLElement>('.animate-on-scroll') ?? null
  }
}

function onMotionPreferenceChange(): void {
  if (motionPreference?.matches) {
    for (const element of unfinished) complete(element)
  }
}

function listen(): void {
  if (listening) return
  motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
  motionPreference.addEventListener('change', onMotionPreferenceChange)
  document.addEventListener('animationend', onAnimationEnd, true)
  document.addEventListener('focusin', onFocus, true)
  listening = true
}

function getObserver(): IntersectionObserver {
  observer ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!(entry.target instanceof HTMLElement) || entry.target.dataset.scrollState !== 'pending') continue
      // A very tall biography cannot reach a 20% ratio; its entering edge is enough.
      const tall = entry.rootBounds !== null && entry.boundingClientRect.height >= entry.rootBounds.height
      if (entry.isIntersecting && (entry.intersectionRatio >= scrollAnimationOptions.threshold || tall)) {
        entry.target.dataset.scrollState = 'running'
        entry.target.classList.add('animate')
        observer?.unobserve(entry.target)
      }
    }
  }, scrollAnimationOptions)
  return observer
}

export function observeScrollAnimation(element: HTMLElement): () => void {
  listen()
  if (completed.has(element) || element.dataset.scrollState === 'done') return () => {}
  if (motionPreference?.matches || !('IntersectionObserver' in window) || element.contains(document.activeElement)) {
    complete(element)
    return () => {}
  }
  // Only React's post-hydration effect opts an element into paused keyframes.
  element.dataset.scrollState = 'pending'
  unfinished.add(element)
  getObserver().observe(element)

  return () => {
    observer?.unobserve(element)
    unfinished.delete(element)
    if (!completed.has(element)) {
      delete element.dataset.scrollState
      element.classList.remove('animate')
    }
  }
}

export function initInViewAnimations(selector = '.animate-on-scroll'): () => void {
  const cleanups: Array<() => void> = []
  document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
    if (!unfinished.has(element) && !completed.has(element)) cleanups.push(observeScrollAnimation(element))
  })
  return () => cleanups.forEach((cleanup) => cleanup())
}

declare global {
  interface Window {
    initInViewAnimations?: typeof initInViewAnimations
  }
}

if (typeof window !== 'undefined') window.initInViewAnimations = initInViewAnimations

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const element of unfinished) complete(element)
    observer?.disconnect()
    if (typeof window !== 'undefined') {
      motionPreference?.removeEventListener('change', onMotionPreferenceChange)
      document.removeEventListener('animationend', onAnimationEnd, true)
      document.removeEventListener('focusin', onFocus, true)
      if (window.initInViewAnimations === initInViewAnimations) delete window.initInViewAnimations
    }
  })
}
