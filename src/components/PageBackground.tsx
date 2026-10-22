import { Component, lazy, Suspense, useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useScrollActivity } from '../scroll-activity'

const HeroGradient = lazy(() =>
  import('./HeroGradient').then((module) => ({ default: module.HeroGradient })),
)

type DataConnection = EventTarget & { saveData?: boolean }

function useBackdropMotion() {
  const [allowed, setAllowed] = useState(false)
  const [motionAllowed, setMotionAllowed] = useState(false)
  const [idle, setIdle] = useState(false)
  const [pageVisible, setPageVisible] = useState(false)
  const scrolling = useScrollActivity()

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 768px)')
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)')
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const connection = (navigator as Navigator & { connection?: DataConnection }).connection
    const sync = () => {
      const canMove = !reducedMotion.matches && !connection?.saveData
      setMotionAllowed(canMove)
      setAllowed(desktop.matches && finePointer.matches && canMove && 'WebGL2RenderingContext' in window)
    }

    sync()
    const queries = [desktop, finePointer, reducedMotion]
    queries.forEach((query) => query.addEventListener('change', sync))
    connection?.addEventListener?.('change', sync)
    return () => {
      queries.forEach((query) => query.removeEventListener('change', sync))
      connection?.removeEventListener?.('change', sync)
    }
  }, [])

  useEffect(() => {
    const syncVisibility = () => setPageVisible(!document.hidden)
    syncVisibility()
    document.addEventListener('visibilitychange', syncVisibility)

    return () => {
      document.removeEventListener('visibilitychange', syncVisibility)
    }
  }, [])

  const active = motionAllowed && pageVisible && !scrolling

  useEffect(() => {
    if (!allowed || !active || idle) return

    // Let HTML, fonts and the CSS backdrop paint before fetching Three.js.
    if ('requestIdleCallback' in window) {
      const request = window.requestIdleCallback(() => setIdle(true), { timeout: 1500 })
      return () => window.cancelIdleCallback(request)
    }
    const request = globalThis.setTimeout(() => setIdle(true), 350)
    return () => globalThis.clearTimeout(request)
  }, [active, allowed, idle])

  return { enabled: allowed && idle, active, motionAllowed }
}

class GradientBoundary extends Component<{
  children: ReactNode
  onError: () => void
}, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    this.props.onError()
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

/** One viewport-sized backdrop follows the entire page, including touch devices. */
export function PageBackground() {
  const { enabled, active, motionAllowed } = useBackdropMotion()
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const onError = useCallback(() => setFailed(true), [])
  const state = failed ? 'error' : !enabled ? 'fallback' : !active ? 'paused'
    : ready ? 'active' : 'loading'

  return (
    <div
      className="page-background"
      data-gradient-state={state}
      data-motion={motionAllowed ? 'enabled' : 'disabled'}
      data-floating={active && (!ready || failed) ? 'active' : 'paused'}
      aria-hidden="true"
    >
      <div className="page-gradient-fallback" />
      {enabled && !failed && (
        <GradientBoundary onError={onError}>
          <Suspense fallback={null}>
            <HeroGradient active={active} onReady={setReady} onError={onError} />
          </Suspense>
        </GradientBoundary>
      )}
      <div className="page-gradient-scrim" />
    </div>
  )
}
