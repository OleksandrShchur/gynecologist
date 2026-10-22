import { useSyncExternalStore } from 'react'

const listeners = new Set<() => void>()
let scrolling = false
let timeout: ReturnType<typeof setTimeout> | undefined

function update(value: boolean) {
  if (scrolling === value) return
  scrolling = value
  // Hide expensive backdrops immediately, before React's next commit.
  document.documentElement.toggleAttribute('data-scrolling', value)
  listeners.forEach(listener => listener())
}

function onScroll() {
  update(true)
  clearTimeout(timeout)
  timeout = setTimeout(() => update(false), 180)
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener('scroll', onScroll, { passive: true })
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      window.removeEventListener('scroll', onScroll)
      clearTimeout(timeout)
      scrolling = false
      document.documentElement.removeAttribute('data-scrolling')
    }
  }
}

/** One passive listener; subscribers update only at scroll start and after settling. */
export function useScrollActivity() {
  return useSyncExternalStore(subscribe, () => scrolling, () => false)
}
