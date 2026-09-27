'use client'

import { useEffect, useRef } from 'react'

type Sample = { level: number; clip: boolean }

export function LiveMeter({ analyser, active }: { analyser: AnalyserNode | null; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const historyRef = useRef<Sample[]>([])

  useEffect(() => {
    historyRef.current = []
  }, [analyser])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const styles = getComputedStyle(canvas)
    const colorLevel = styles.getPropertyValue('--primary').trim()
    const colorClip = styles.getPropertyValue('--destructive').trim()
    const colorIdle = styles.getPropertyValue('--muted').trim()
    const data = analyser ? new Float32Array(analyser.fftSize) : null
    let raf = 0
    let lastSample = 0

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      const dpr = window.devicePixelRatio || 1
      const w = Math.round(canvas.clientWidth * dpr)
      const h = Math.round(canvas.clientHeight * dpr)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }

      if (analyser && data && active && now - lastSample > 60) {
        lastSample = now
        analyser.getFloatTimeDomainData(data)
        let sum = 0
        let peak = 0
        for (let i = 0; i < data.length; i++) {
          const v = Math.abs(data[i])
          sum += v * v
          if (v > peak) peak = v
        }
        const rms = Math.sqrt(sum / data.length)
        historyRef.current.push({ level: Math.min(1, rms * 5), clip: peak > 0.98 })
        if (historyRef.current.length > 600) historyRef.current.shift()
      }

      ctx.clearRect(0, 0, w, h)
      const barW = 3 * dpr
      const gap = 2 * dpr
      const count = Math.floor(w / (barW + gap))
      const mid = h / 2

      for (let i = 0; i < count; i++) {
        ctx.fillStyle = colorIdle
        ctx.fillRect(i * (barW + gap), mid - dpr, barW, 2 * dpr)
      }

      const visible = historyRef.current.slice(-count)
      visible.forEach((sample, i) => {
        const x = w - (visible.length - i) * (barW + gap)
        const barH = Math.max(2 * dpr, sample.level * h * 0.92)
        ctx.fillStyle = sample.clip ? colorClip : colorLevel
        ctx.fillRect(x, mid - barH / 2, barW, barH)
      })
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [analyser, active])

  return <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" />
}
