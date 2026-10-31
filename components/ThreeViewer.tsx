'use client'

import { useEffect, useRef, useState } from 'react'

// model-viewer is a custom element: until its module is evaluated, React 19
// writes camelCase props as (lowercased) attributes, which model-viewer never
// observes — so camera-controls, auto-rotate, tonemapping etc. were silently
// dropped and the viewer was not interactive. We only mount the element once
// it is defined, so React assigns real properties instead. Events are wired
// natively because React's on* handlers call addEventListener('Load'/'Progress')
// for custom elements, and those event names never fire.
declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
        src?: string
        alt?: string
        poster?: string
        loading?: 'auto' | 'lazy' | 'eager'
        reveal?: 'auto' | 'manual'
        toneMapping?: string
        shadowIntensity?: string
        shadowSoftness?: string
        exposure?: string
        cameraControls?: boolean
        autoRotate?: boolean
        autoRotateDelay?: string
        rotationPerSecond?: string
        environmentImage?: string
        skyboxImage?: string
        interactionPrompt?: string
        cameraOrbit?: string
        minCameraOrbit?: string
        maxCameraOrbit?: string
        style?: React.CSSProperties
      }, HTMLElement>
    }
  }
}

interface ThreeViewerProps {
  glbUrl: string
  previewUrl?: string
  className?: string
  autoRotate?: boolean
}

type ModelViewerElement = HTMLElement & { loaded?: boolean }

export default function ThreeViewer({
  glbUrl,
  previewUrl,
  className = '',
  autoRotate = true,
}: ThreeViewerProps) {
  const [ready, setReady] = useState(false)
  const [loadedSrc, setLoadedSrc] = useState('')
  const [progress, setProgress] = useState(0)
  const [failed, setFailed] = useState<string | null>(null)
  const viewerRef = useRef<ModelViewerElement | null>(null)

  const loaded = loadedSrc === glbUrl

  // model-viewer fetches the GLB with fetch(), so a cross-origin R2 URL needs
  // CORS headers the public bucket doesn't send. /r2/* is proxied to R2 by
  // next.config.ts, making the request same-origin.
  const src = glbUrl.replace(/^https:\/\/[^/]+\.r2\.dev\//, '/r2/')

  // Load the model-viewer module once and flip `ready` after the custom
  // element is defined.
  useEffect(() => {
    if (typeof window === 'undefined') return
    let cancelled = false

    const markReady = () => {
      if (!cancelled) setReady(true)
    }

    if (customElements.get('model-viewer')) {
      markReady()
      return () => {
        cancelled = true
      }
    }

    let script = document.querySelector<HTMLScriptElement>('script[data-model-viewer]')
    if (!script) {
      script = document.createElement('script')
      script.type = 'module'
      script.dataset.modelViewer = 'true'
      script.src = 'https://unpkg.com/@google/model-viewer@4.3.1/dist/model-viewer.min.js'
      script.onerror = () => {
        if (!cancelled) setFailed('Could not load the 3D viewer library.')
      }
      document.head.appendChild(script)
    }

    customElements.whenDefined('model-viewer').then(markReady).catch(() => {})

    return () => {
      cancelled = true
    }
  }, [])

  // Native listeners: load/error do not bubble and progress is a custom event.
  useEffect(() => {
    const el = viewerRef.current
    if (!ready || !el) return

    const onProgress = (e: Event) => {
      const detail = (e as CustomEvent<{ totalProgress?: number }>).detail
      setProgress(Math.round((detail?.totalProgress ?? 0) * 100))
    }
    const onLoad = () => {
      setLoadedSrc(glbUrl)
      setProgress(100)
      setFailed(null)
    }
    const onError = () => setFailed('Could not load the 3D model file.')

    el.addEventListener('progress', onProgress)
    el.addEventListener('load', onLoad)
    el.addEventListener('error', onError)
    if (el.loaded) onLoad() // already finished before the listeners attached

    return () => {
      el.removeEventListener('progress', onProgress)
      el.removeEventListener('load', onLoad)
      el.removeEventListener('error', onError)
    }
  }, [ready, glbUrl])

  // 4 MB models on a slow connection can take a while (and R2/CORS failures
  // otherwise spin forever), so give up eventually instead of showing 0%.
  useEffect(() => {
    if (loaded || failed) return
    const timer = setTimeout(() => {
      setFailed((prev) => prev ?? 'Model is taking too long to load.')
    }, 120_000)
    return () => clearTimeout(timer)
  }, [loaded, failed, glbUrl])

  const progressPct = Math.max(0, Math.min(100, progress))

  return (
    <div
      className={`relative w-full overflow-hidden rounded-2xl ${className}`}
      style={{ background: 'linear-gradient(135deg, #0a0b0f 0%, #0f0f1e 50%, #0a0b0f 100%)' }}
    >
      {ready && (
        <model-viewer
          ref={viewerRef}
          src={src}
          {...(previewUrl ? { poster: previewUrl } : {})}
          alt="3D model preview"
          loading="eager"
          reveal="auto"
          toneMapping="aces"
          shadowIntensity="1.6"
          shadowSoftness="1.0"
          exposure="1.3"
          cameraControls
          autoRotate={autoRotate}
          autoRotateDelay="800"
          rotationPerSecond="16deg"
          environmentImage="neutral"
          interactionPrompt="none"
          style={{
            width: '100%',
            height: '100%',
            minHeight: '520px',
            backgroundColor: 'transparent',
            '--poster-color': 'transparent',
          } as React.CSSProperties}
        >
          {/* model-viewer's progress-bar slot shows while the model downloads. */}
          <div slot="progress-bar" className="mv-progress-wrap">
            {previewUrl && (
              // Dynamic R2 preview URL — next/image would need remotePatterns config
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="" className="mv-progress-poster" />
            )}
            <div className="mv-progress-content">
              <div className="mv-progress-ring">
                <svg viewBox="0 0 64 64" className="mv-progress-svg">
                  <circle cx="32" cy="32" r="28" fill="none" stroke="#ffffff10" strokeWidth="4"/>
                  <circle
                    cx="32" cy="32" r="28"
                    fill="none" stroke="#7c3aed" strokeWidth="4"
                    strokeDasharray={`${(progressPct / 100) * 175.9} 175.9`}
                    strokeLinecap="round"
                    style={{ transition: 'stroke-dasharray 0.3s ease' }}
                  />
                </svg>
                <span className="mv-progress-pct">{progressPct}%</span>
              </div>
              <p className="mv-progress-label">Loading model</p>
            </div>
          </div>
        </model-viewer>
      )}

      {/* Overlay until the model is visible. pointer-events stays off so the
          viewer is draggable the moment it renders. */}
      {!loaded && (
        <div className="viewer-overlay">
          {failed ? (
            <>
              <span className="viewer-overlay-title">Viewer unavailable</span>
              <span className="viewer-overlay-hint">{failed}</span>
              <a href={src} download className="viewer-overlay-link">
                Download the GLB instead
              </a>
            </>
          ) : (
            <>
              <span className="viewer-overlay-title">
                {ready ? 'Loading model…' : 'Starting 3D viewer…'}
              </span>
              <span className="viewer-overlay-hint">
                {ready ? `${progressPct}% · drag to rotate once it appears` : 'Warming up the renderer'}
              </span>
            </>
          )}
        </div>
      )}

      {/* Bottom HUD bar */}
      <div
        className="absolute bottom-0 left-0 right-0 px-4 py-2.5 flex items-center justify-between pointer-events-none"
        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)' }}
      >
        <div className="flex items-center gap-2 pointer-events-auto">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-white/40 text-xs">Drag to rotate · Scroll to zoom · Right-click to pan</span>
        </div>
        <a
          href={src}
          download
          className="text-xs text-purple-400 hover:text-purple-300 transition-colors flex items-center gap-1 pointer-events-auto"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <path d="M5 7L1.5 3.5h2V1h3v2.5h2L5 7zM1 8.5h8V10H1z"/>
          </svg>
          GLB
        </a>
      </div>
    </div>
  )
}
