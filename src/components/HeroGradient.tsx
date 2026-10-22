import { ShaderGradient, ShaderGradientCanvas } from '@shadergradient/react'
import { useFrame, useThree } from '@react-three/fiber'
import { memo, useEffect, useLayoutEffect, useRef } from 'react'
import type { Mesh } from 'three'

const GradientSurface = memo(ShaderGradient)

const COLORS = {
  color1: '#3d2a5c',
  color2: '#c4a1e8',
  color3: '#e8b4a2',
} as const

type GradientProps = {
  active: boolean
  onReady: (ready: boolean) => void
  onError: () => void
}

function GradientLifecycle({ active, onReady, onError }: GradientProps) {
  const gl = useThree((state) => state.gl)
  const frameloop = useThree((state) => state.frameloop)
  const setFrameloop = useThree((state) => state.setFrameloop)
  const elapsed = useRef(0)

  useFrame(({ scene }, delta) => {
    // ShaderGradient's animate toggle restarts its own clock. Keep an independent
    // elapsed time that advances only while rendering, across every scroll pause.
    if (active) elapsed.current += Math.min(delta, 0.05)
    const mesh = scene.getObjectByName('shadergradient-mesh') as Mesh | undefined
    const material = mesh && !Array.isArray(mesh.material) ? mesh.material : undefined
    const time = material?.userData.uTime as { value: number } | undefined
    if (time) time.value = elapsed.current
  }, -1)

  useLayoutEffect(() => {
    // Preserve the canvas and elapsed time while suspending its render loop.
    const nextFrameloop = active ? 'always' : 'never'
    if (frameloop !== nextFrameloop) setFrameloop(nextFrameloop)
    gl.domElement.dataset.rendering = active ? 'active' : 'paused'
  }, [active, frameloop, gl, setFrameloop])

  useEffect(() => {
    const canvas = gl.domElement
    const previousShaderError = gl.debug.onShaderError
    const fail = () => {
      setFrameloop('never')
      onError()
    }
    gl.debug.onShaderError = fail
    canvas.addEventListener('webglcontextlost', fail)
    onReady(true)
    return () => {
      setFrameloop('never')
      gl.debug.onShaderError = previousShaderError
      canvas.removeEventListener('webglcontextlost', fail)
      onReady(false)
    }
  }, [gl, onError, onReady, setFrameloop])

  return null
}

export function HeroGradient({ active, onReady, onError }: GradientProps) {
  return (
    <div
      className="page-gradient-stage"
      data-rendering={active ? 'active' : 'paused'}
      style={{ position: 'absolute', inset: 0 }}
    >
      <ShaderGradientCanvas
        className="page-gradient-canvas"
        style={{ position: 'absolute', inset: 0 }}
        pixelDensity={0.75}
        fov={45}
        lazyLoad
        threshold={0.01}
        pointerEvents="none"
        powerPreference="low-power"
      >
        <GradientLifecycle active={active} onReady={onReady} onError={onError} />
        <GradientSurface
          control="props"
          type="waterPlane"
          animate="off"
          uSpeed={0.22}
          uStrength={2.8}
          uDensity={1.1}
          uFrequency={4.2}
          color1={COLORS.color1}
          color2={COLORS.color2}
          color3={COLORS.color3}
          cDistance={3.2}
          cPolarAngle={115}
          cAzimuthAngle={180}
          lightType="3d"
          brightness={1.15}
          // v2.4.20 ignores grainBlending; its fixed grain compositor is too noisy here.
          grain="off"
          reflection={0.12}
          positionY={0}
          rotationX={0}
          rotationY={0}
          rotationZ={40}
        />
      </ShaderGradientCanvas>
    </div>
  )
}
