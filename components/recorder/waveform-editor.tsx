'use client'

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { formatTime } from '@/lib/audio'

const MIN_LENGTH = 0.5
const HANDLE_HIT_PX = 24

type Props = {
  peaks: Float32Array
  duration: number
  start: number
  end: number
  playhead: number
  onRangeChange: (start: number, end: number) => void
  onSeek: (time: number) => void
}

type DragMode = 'start' | 'end' | 'seek' | null

export function WaveformEditor({ peaks, duration, start, end, playhead, onRangeChange, onSeek }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<DragMode>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || size.w === 0 || duration === 0) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size.w * dpr)
    canvas.height = Math.round(size.h * dpr)
    const styles = getComputedStyle(canvas)
    const colorActive = styles.getPropertyValue('--primary').trim()
    const colorInactive = styles.getPropertyValue('--muted-foreground').trim()

    const barW = 2 * dpr
    const gap = 1 * dpr
    const cols = Math.floor(canvas.width / (barW + gap))
    const mid = canvas.height / 2
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    for (let i = 0; i < cols; i++) {
      const from = Math.floor((i / cols) * peaks.length)
      const to = Math.max(from + 1, Math.floor(((i + 1) / cols) * peaks.length))
      let max = 0
      for (let j = from; j < to; j++) if (peaks[j] > max) max = peaks[j]
      const t = ((i + 0.5) / cols) * duration
      const inside = t >= start && t <= end
      ctx.globalAlpha = inside ? 1 : 0.35
      ctx.fillStyle = inside ? colorActive : colorInactive
      const barH = Math.max(dpr, max * canvas.height * 0.9)
      ctx.fillRect(i * (barW + gap), mid - barH / 2, barW, barH)
    }
    ctx.globalAlpha = 1
  }, [peaks, duration, start, end, size])

  const timeAt = (clientX: number) => {
    const rect = containerRef.current!.getBoundingClientRect()
    return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration))
  }

  const apply = (mode: DragMode, t: number) => {
    if (mode === 'start') onRangeChange(Math.min(t, end - MIN_LENGTH), end)
    else if (mode === 'end') onRangeChange(start, Math.max(t, start + MIN_LENGTH))
    else if (mode === 'seek') onSeek(t)
  }

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const rect = containerRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    const startX = (start / duration) * rect.width
    const endX = (end / duration) * rect.width
    const dStart = Math.abs(x - startX)
    const dEnd = Math.abs(x - endX)
    let mode: DragMode = 'seek'
    if (dStart < HANDLE_HIT_PX && dStart <= dEnd) mode = 'start'
    else if (dEnd < HANDLE_HIT_PX) mode = 'end'
    dragRef.current = mode
    e.currentTarget.setPointerCapture(e.pointerId)
    apply(mode, timeAt(e.clientX))
  }

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) apply(dragRef.current, timeAt(e.clientX))
  }

  const handlePointerUp = () => {
    dragRef.current = null
  }

  const handleKey = (which: 'start' | 'end') => (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 1
    const delta = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
    if (!delta) return
    e.preventDefault()
    const current = which === 'start' ? start : end
    apply(which, Math.max(0, Math.min(duration, current + delta)))
  }

  const pct = (t: number) => (duration > 0 ? (t / duration) * 100 : 0)
  const ticks = [0, 0.25, 0.5, 0.75, 1]

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={containerRef}
        className="relative h-44 touch-none select-none rounded-lg bg-card"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />

        <div className="pointer-events-none absolute inset-y-0 left-0 rounded-l-lg bg-background/60" style={{ width: `${pct(start)}%` }} />
        <div className="pointer-events-none absolute inset-y-0 right-0 rounded-r-lg bg-background/60" style={{ width: `${100 - pct(end)}%` }} />

        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-foreground"
          style={{ left: `${pct(playhead)}%` }}
          aria-hidden="true"
        />

        <Handle
          label="Start"
          tabPosition="top"
          percent={pct(start)}
          value={start}
          min={0}
          max={end - MIN_LENGTH}
          onKeyDown={handleKey('start')}
        />
        <Handle
          label="Slut"
          tabPosition="bottom"
          percent={pct(end)}
          value={end}
          min={start + MIN_LENGTH}
          max={duration}
          onKeyDown={handleKey('end')}
        />
      </div>

      <div className="flex justify-between font-mono text-xs text-muted-foreground tabular-nums" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t}>{formatTime(t * duration)}</span>
        ))}
      </div>
    </div>
  )
}

function Handle({
  label,
  tabPosition,
  percent,
  value,
  min,
  max,
  onKeyDown,
}: {
  label: string
  tabPosition: 'top' | 'bottom'
  percent: number
  value: number
  min: number
  max: number
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void
}) {
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={`${label}punkt`}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      aria-valuetext={formatTime(value, true)}
      onKeyDown={onKeyDown}
      className="absolute inset-y-0 flex w-10 -translate-x-1/2 justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
      style={{ left: `${percent}%` }}
    >
      <div className="h-full w-0.5 bg-primary" />
      <span
        className={`absolute rounded-sm bg-primary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground ${
          tabPosition === 'top' ? '-top-3' : '-bottom-3'
        }`}
      >
        {label}
      </span>
    </div>
  )
}
