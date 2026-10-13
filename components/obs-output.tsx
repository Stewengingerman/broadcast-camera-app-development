'use client'

import { useEffect, useRef, useState } from 'react'

const POLL_INTERVAL_MS = 80
const STALE_AFTER_MS = 5000
const OUTPUT_WIDTH = 1920
const OUTPUT_HEIGHT = 1080

export function ObsOutput({ slot, showStatus }: { slot: 2 | 3; showStatus: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [stale, setStale] = useState(true)

  // Continuous frame pull loop drawn to a canvas so OBS never sees a blank frame between images.
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    let cancelled = false
    let timer: number | undefined
    let lastTs = 0
    let lastSeenAt = 0

    const draw = (bitmap: ImageBitmap) => {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT)
      const scale = Math.min(OUTPUT_WIDTH / bitmap.width, OUTPUT_HEIGHT / bitmap.height)
      const w = bitmap.width * scale
      const h = bitmap.height * scale
      ctx.drawImage(bitmap, (OUTPUT_WIDTH - w) / 2, (OUTPUT_HEIGHT - h) / 2, w, h)
    }

    const pull = async () => {
      try {
        const res = await fetch(`/api/live/frame?slot=${slot}`, { cache: 'no-store' })
        if (res.ok) {
          const ts = Number(res.headers.get('X-Frame-Ts')) || Date.now()
          if (ts !== lastTs) {
            const bitmap = await createImageBitmap(await res.blob())
            if (cancelled) return
            draw(bitmap)
            bitmap.close()
            lastTs = ts
            lastSeenAt = Date.now()
          }
        }
      } catch {
        // Network hiccup; keep the last frame on screen and retry.
      }
      if (!cancelled) {
        setStale(Date.now() - lastSeenAt > STALE_AFTER_MS)
        timer = window.setTimeout(pull, POLL_INTERVAL_MS)
      }
    }

    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT)
    void pull()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [slot])

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-black">
      <h1 className="sr-only">{`OBS-utgång kamera ${slot}`}</h1>
      <canvas
        ref={canvasRef}
        width={OUTPUT_WIDTH}
        height={OUTPUT_HEIGHT}
        className="size-full object-contain"
        aria-label={`Livebild från kamera ${slot}`}
      />
      {showStatus && stale && (
        <p className="absolute left-4 top-4 rounded bg-zinc-900/80 px-3 py-1.5 font-mono text-sm text-zinc-300">
          {`KAMERA ${slot}: VÄNTAR PÅ SIGNAL`}
        </p>
      )}
    </main>
  )
}
