import { useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { useScrollActivity } from '../scroll-activity'

type LiquidGlassComponent = typeof import('liquid-glass-react')['default']

interface GlassProps {
  children: ReactNode
  className?: string
  padding?: string
  cornerRadius?: number
  style?: CSSProperties
  mouseContainer?: RefObject<HTMLElement | null> | null
  overLight?: boolean
  displacementScale?: number
  blurAmount?: number
  elasticity?: number
}

let glassModule: Promise<LiquidGlassComponent | null> | undefined

/** Vite's browser build and Node's CJS loader expose different default nesting. */
function resolveGlass(module: unknown): LiquidGlassComponent | null {
  let candidate = module
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof candidate === 'function') return candidate as LiquidGlassComponent
    if (!candidate || typeof candidate !== 'object' || !('default' in candidate)) return null
    candidate = (candidate as { default: unknown }).default
  }
  return null
}

function loadGlass() {
  glassModule ??= import('liquid-glass-react').then(resolveGlass).catch(() => null)
  return glassModule
}

/** Keep the content in one SSR-safe shell; enhance only its decorative backdrop. */
export function Glass({
  children,
  className = '',
  padding = '0',
  cornerRadius = 20,
  style,
  mouseContainer = null,
  overLight = true,
  displacementScale = 48,
  blurAmount = 0.08,
  elasticity = 0.2,
}: GlassProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()
  const [canEnhance, setCanEnhance] = useState(false)
  const [LiquidGlass, setLiquidGlass] = useState<LiquidGlassComponent | null>(null)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const scrolling = useScrollActivity()

  useEffect(() => {
    let nearViewport = !('IntersectionObserver' in window)
    const desktop = window.matchMedia('(min-width: 768px) and (hover: hover) and (pointer: fine)')
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    const update = () => {
      const enabled = nearViewport && desktop.matches && !connection?.saveData
      setCanEnhance(enabled)
    }
    const observer = 'IntersectionObserver' in window
      ? new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          nearViewport = true
          observer?.disconnect()
          update()
        }
      }, { rootMargin: '200px 0px' })
      : null
    if (surfaceRef.current) observer?.observe(surfaceRef.current)
    update()
    desktop.addEventListener('change', update)
    return () => {
      observer?.disconnect()
      desktop.removeEventListener('change', update)
    }
  }, [])

  const requested = canEnhance && (hovered || focused) && !scrolling && reducedMotion === false
  useEffect(() => {
    if (!requested) return
    let active = true
    void loadGlass().then((component) => {
      if (active && component) setLiquidGlass(() => component)
    })
    return () => { active = false }
  }, [requested])

  // Static glass has no backdrop sampling. Only the surface being used refracts.
  const enhanced = requested && LiquidGlass !== null
  const activeElasticity = enhanced ? elasticity : 0

  return (
    <div
      ref={surfaceRef}
      className={`glass-surface glass-fallback ${className}`.trim()}
      data-glass={enhanced ? 'enhanced' : 'fallback'}
      data-glass-elasticity={activeElasticity}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setFocused(false)
      }}
      style={{ position: 'relative', isolation: 'isolate', borderRadius: cornerRadius, padding, ...style }}
    >
      {enhanced && (
        <div className="glass-decoration" aria-hidden="true">
          <LiquidGlass
            className="glass-effect"
            mode="standard"
            displacementScale={displacementScale}
            blurAmount={blurAmount}
            saturation={120}
            aberrationIntensity={1.2}
            elasticity={activeElasticity}
            cornerRadius={cornerRadius}
            padding="0"
            style={{ position: 'absolute', top: '50%', left: '50%', width: '100%', height: '100%' }}
            mouseContainer={mouseContainer ?? surfaceRef}
            overLight={overLight}
          >
            <span />
          </LiquidGlass>
        </div>
      )}
      <div className="glass-content">{children}</div>
    </div>
  )
}
