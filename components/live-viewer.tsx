'use client'

import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { Maximize, Radio, VideoOff } from 'lucide-react'

type Slot = 2 | 3

const SLOT_NAMES: Record<Slot, string> = { 2: 'Predikstol', 3: 'Lovsång' }
const POLL_INTERVAL_MS = 100
const STALE_AFTER_MS = 5000

interface StatusResponse {
  slots: { slot: Slot; ts: number | null; live: boolean }[]
}

const fetcher = (url: string) => fetch(url, { cache: 'no-store' }).then((r) => r.json())

export function LiveViewer({ initialSlot }: { initialSlot: Slot }) {
  const [slot, setSlot] = useState<Slot>(initialSlot)
  const [frameUrl, setFrameUrl] = useState<string | null>(null)
  const [lastFrameAt, setLastFrameAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const stageRef = useRef<HTMLDivElement>(null)

  const { data: status } = useSWR<StatusResponse>('/api/live/status', fetcher, {
    refreshInterval: 3000,
  })

  // Continuous frame pull loop — this is a video render loop, not one-off data fetching.
  useEffect(() => {
    let cancelled = false
    let currentUrl: string | null = null
    let timer: number | undefined

    const pull = async () => {
      try {
        const res = await fetch(`/api/live/frame?slot=${slot}`, { cache: 'no-store' })
        if (res.ok) {
          const blob = await res.blob()
          if (cancelled) return
          const url = URL.createObjectURL(blob)
          if (currentUrl) URL.revokeObjectURL(currentUrl)
          currentUrl = url
          setFrameUrl(url)
          setLastFrameAt(Number(res.headers.get('X-Frame-Ts')) || Date.now())
        }
      } catch {
        // Network hiccup; the next tick retries.
      }
      if (!cancelled) timer = window.setTimeout(pull, POLL_INTERVAL_MS)
    }

    setFrameUrl(null)
    setLastFrameAt(null)
    void pull()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      if (currentUrl) URL.revokeObjectURL(currentUrl)
    }
  }, [slot])

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  const isLive = lastFrameAt !== null && now - lastFrameAt < STALE_AFTER_MS

  const selectSlot = (next: Slot) => {
    setSlot(next)
    const url = new URL(window.location.href)
    url.searchParams.set('slot', String(next))
    window.history.replaceState(null, '', url)
  }

  const goFullscreen = () => {
    void stageRef.current?.requestFullscreen?.().catch(() => undefined)
  }

  return (
    <main className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <Radio className="size-5 text-red-500" aria-hidden />
          <h1 className="font-mono text-sm font-bold tracking-widest">{'LIVESÄNDNING'}</h1>
        </div>
        <span
          className={`rounded px-2 py-1 font-mono text-xs font-bold tracking-wider ${isLive ? 'animate-pulse bg-red-600 text-zinc-50' : 'bg-zinc-800 text-zinc-400'}`}
        >
          {isLive ? '● LIVE' : '○ INGEN SIGNAL'}
        </span>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4">
        <div
          ref={stageRef}
          className="relative flex aspect-video w-full max-w-5xl items-center justify-center overflow-hidden rounded-lg bg-zinc-900"
        >
          {frameUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- blob: URLs from a live stream cannot go through next/image
            <img
              src={frameUrl}
              alt={`Livebild från kamera ${slot}: ${SLOT_NAMES[slot]}`}
              className={`size-full object-contain transition-opacity ${isLive ? 'opacity-100' : 'opacity-40 grayscale'}`}
            />
          ) : (
            <div className="flex flex-col items-center gap-3 text-zinc-500">
              <VideoOff className="size-10" aria-hidden />
              <p className="text-pretty text-center text-sm leading-relaxed">
                {'Sändningen har inte börjat ännu. Sidan uppdateras automatiskt.'}
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={goFullscreen}
            aria-label="Helskärm"
            className="absolute bottom-3 right-3 flex size-10 items-center justify-center rounded-full bg-zinc-950/70 text-zinc-100 hover:bg-zinc-950"
          >
            <Maximize className="size-5" aria-hidden />
          </button>
        </div>

        <div role="group" aria-label="Välj kamera" className="flex gap-2">
          {([2, 3] as const).map((s) => {
            const live = status?.slots.find((x) => x.slot === s)?.live
            return (
              <button
                key={s}
                type="button"
                onClick={() => selectSlot(s)}
                aria-pressed={slot === s}
                className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold ${slot === s ? 'border-zinc-100 bg-zinc-100 text-zinc-950' : 'border-zinc-700 text-zinc-300 hover:bg-zinc-800'}`}
              >
                <span
                  className={`size-2 rounded-full ${live ? 'bg-red-500' : 'bg-zinc-600'}`}
                  aria-hidden
                />
                {`Kamera ${s}: ${SLOT_NAMES[s]}`}
                <span className="sr-only">{live ? '(live)' : '(ingen signal)'}</span>
              </button>
            )
          })}
        </div>
      </div>
    </main>
  )
}
