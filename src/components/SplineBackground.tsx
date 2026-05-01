// SplineBackground.tsx
// Built using the spine-skill/react-spline-wrapper.tsx pattern
// Fixes: WebGL detection, hardware capability check, 8s timeout fallback,
//        deferred load (let UI render first), pointer-events:none, proper fade-in

import { lazy, Suspense, useState, useEffect, useRef } from 'react'

const Spline = lazy(() => import('@splinetool/react-spline'))

const SCENE_URL = 'https://prod.spline.design/KJuZNMLzLyry7O4i/scene.splinecode'

// — Capability check (from skill guide: mobile + low-end + WebGL) ————
function shouldLoadSpline(): boolean {
  if (typeof window === 'undefined') return false // SSR guard

  const isMobile = window.innerWidth < 768
  const isLowEnd = navigator.hardwareConcurrency <= 2

  // Test WebGL support — if device has no GPU with WebGL, skip entirely
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
  const noWebGL = !gl

  return !isMobile && !isLowEnd && !noWebGL
}

export default function SplineBackground() {
  const [splineLoaded, setSplineLoaded] = useState(false)
  const [splineFailed, setSplineFailed]  = useState(false)
  const [canLoad, setCanLoad]            = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>()

  // Evaluate capability client-side only (after mount)
  useEffect(() => {
    setCanLoad(shouldLoadSpline())
  }, [])

  // 8-second timeout fallback (from skill guide: CDN can be flaky)
  useEffect(() => {
    if (!canLoad) return

    timeoutRef.current = setTimeout(() => {
      if (!splineLoaded) setSplineFailed(true)
    }, 8000)

    return () => clearTimeout(timeoutRef.current)
  }, [canLoad, splineLoaded])

  function onLoad() {
    clearTimeout(timeoutRef.current)
    setSplineLoaded(true)
  }

  const showLiveScene = canLoad && !splineFailed

  return (
    <>
      {/* Gradient fallback — always visible, fades once Spline loads */}
      <div
        className="spline-bg-fallback"
        style={{
          opacity: splineLoaded ? 0 : 1,
          transition: 'opacity 1.2s ease',
          pointerEvents: 'none'
        }}
      />

      {/* Spline — only on WebGL-capable non-mobile devices */}
      {showLiveScene && (
        <div
          className="spline-bg"
          style={{
            opacity: splineLoaded ? 1 : 0,
            transition: 'opacity 1s ease',
            pointerEvents: 'none', // never block UI clicks
          }}
        >
          <Suspense fallback={null}>
            <Spline
              scene={SCENE_URL}
              onLoad={onLoad}
              style={{ width: '100%', height: '100%' }}
            />
          </Suspense>
        </div>
      )}

      {/* Dark overlay for readability */}
      <div className="spline-overlay" />
    </>
  )
}
