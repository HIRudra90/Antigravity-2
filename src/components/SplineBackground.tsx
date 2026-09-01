import { lazy, Suspense, useState, useEffect, useRef } from 'react'

const Spline = lazy(() => import('@splinetool/react-spline'))

const SCENE_URL = 'https://prod.spline.design/KJuZNMLzLyry7O4i/scene.splinecode'

function shouldLoadSpline(): boolean {
  if (typeof window === 'undefined') return false
  const isMobile = window.innerWidth < 768
  const isLowEnd = navigator.hardwareConcurrency <= 2
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
  return !isMobile && !isLowEnd && !!gl
}

function killWatermark() {
  // By href
  document.querySelectorAll('a[href*="spline.design"]').forEach(el => (el as HTMLElement).style.cssText = 'display:none!important')
  // By text content
  document.querySelectorAll('a, div, span').forEach(el => {
    if ((el as HTMLElement).innerText?.trim() === 'Built with Spline') {
      (el as HTMLElement).style.cssText = 'display:none!important'
      el.parentElement && ((el.parentElement as HTMLElement).style.cssText = 'display:none!important')
    }
  })
}

export default function SplineBackground() {
  const [splineLoaded, setSplineLoaded] = useState(false)
  const [splineFailed, setSplineFailed] = useState(false)
  const [canLoad, setCanLoad] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>()
  const observerRef = useRef<MutationObserver | null>(null)

  useEffect(() => {
    setCanLoad(shouldLoadSpline())
  }, [])

  // Start MutationObserver as soon as Spline might load
  useEffect(() => {
    if (!canLoad) return

    observerRef.current = new MutationObserver(() => {
      killWatermark()
    })
    observerRef.current.observe(document.body, { childList: true, subtree: true })

    // Stop watching after 15s (watermark will be gone by then)
    const stop = setTimeout(() => observerRef.current?.disconnect(), 15000)
    return () => {
      clearTimeout(stop)
      observerRef.current?.disconnect()
    }
  }, [canLoad])

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
    killWatermark()
    setTimeout(killWatermark, 300)
    setTimeout(killWatermark, 1000)
    setTimeout(killWatermark, 3000)
  }

  const showLiveScene = canLoad && !splineFailed

  return (
    <>
      <div
        className="spline-bg-fallback"
        style={{ opacity: splineLoaded ? 0 : 1, transition: 'opacity 1.2s ease', pointerEvents: 'none' }}
      />

      {showLiveScene && (
        <div
          className="spline-bg"
          style={{ opacity: splineLoaded ? 1 : 0, transition: 'opacity 1s ease', pointerEvents: 'none' }}
        >
          <Suspense fallback={null}>
            <Spline scene={SCENE_URL} onLoad={onLoad} style={{ width: '100%', height: '100%' }} />
          </Suspense>
        </div>
      )}

      <div className="spline-overlay" />
    </>
  )
}
