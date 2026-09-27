'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity,
  Camera,
  Gauge,
  Grid3x3,
  MicOff,
  Play,
  Settings,
  Square,
  SwitchCamera,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'

type Tally = 'onair' | 'standby' | 'offline'
type Facing = 'environment' | 'user'
type Slot = 2 | 3
type Resolution = '1080p' | '720p'

const RESOLUTIONS: Record<Resolution, { width: number; height: number }> = {
  '1080p': { width: 1920, height: 1080 },
  '720p': { width: 1280, height: 720 },
}

const SLOT_LABELS: Record<Slot, string> = {
  2: 'KAMERA 2: PREDIKSTOL',
  3: 'KAMERA 3: LOVSÅNG',
}

const ZOOM_LEVELS = [1, 1.5, 2, 3] as const

const TALLY_STYLES: Record<Tally, { frame: string; sign: string; label: string }> = {
  onair: {
    frame: 'border-red-600 shadow-[inset_0_0_60px_rgba(220,38,38,0.55)]',
    sign: 'bg-red-600 text-white animate-pulse shadow-[0_0_24px_rgba(220,38,38,0.8)]',
    label: '● ON AIR – UTE I SÄNDNING',
  },
  standby: {
    frame: 'border-emerald-500 shadow-[inset_0_0_40px_rgba(16,185,129,0.35)]',
    sign: 'bg-emerald-500 text-zinc-950',
    label: '● STANDBY – REDO',
  },
  offline: {
    frame: 'border-zinc-800',
    sign: 'bg-zinc-800 text-zinc-400',
    label: '○ OFFLINE',
  },
}

interface WakeLockSentinelLike {
  release: () => Promise<void>
}

export function BroadcastCamera() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null)
  const framesSentRef = useRef(0)

  const [serverUrl, setServerUrl] = useState('http://192.168.1.50:4316')
  const [slot, setSlot] = useState<Slot>(2)
  const [resolution, setResolution] = useState<Resolution>('1080p')
  const [fps, setFps] = useState<25 | 30>(25)
  const [quality, setQuality] = useState(0.75)

  const [facingMode, setFacingMode] = useState<Facing>('environment')
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [zoom, setZoom] = useState<number>(1)
  const [showGrid, setShowGrid] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [flash, setFlash] = useState(false)
  const [lastPhoto, setLastPhoto] = useState<{ blob: Blob; url: string; name: string } | null>(null)

  const [serverTally, setServerTally] = useState<Tally>('offline')
  const [demoTally, setDemoTally] = useState<Tally | null>(null)
  const [ping, setPing] = useState<number | null>(null)
  const [measuredFps, setMeasuredFps] = useState(0)
  const [sendError, setSendError] = useState(false)

  const tally: Tally = demoTally ?? (streaming ? serverTally : 'offline')
  const tallyStyle = TALLY_STYLES[tally]
  const baseUrl = serverUrl.replace(/\/+$/, '')

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraActive(false)
  }, [])

  const startCamera = useCallback(
    async (facing: Facing = facingMode) => {
      setCameraError(null)
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Kameran stöds inte i denna webbläsare (kräver HTTPS).')
        return
      }
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop())
        const { width, height } = RESOLUTIONS[resolution]
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facing,
            width: { ideal: width },
            height: { ideal: height },
            frameRate: { ideal: fps },
          },
          audio: false,
        })
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => undefined)
        }
        setCameraActive(true)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setCameraError(`Kunde inte starta kameran: ${message}`)
        setCameraActive(false)
      }
    },
    [facingMode, resolution, fps],
  )

  const switchCamera = useCallback(() => {
    const next: Facing = facingMode === 'environment' ? 'user' : 'environment'
    setFacingMode(next)
    if (cameraActive) void startCamera(next)
  }, [facingMode, cameraActive, startCamera])

  const requestWakeLock = useCallback(async () => {
    try {
      const nav = navigator as Navigator & {
        wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> }
      }
      if (nav.wakeLock) wakeLockRef.current = await nav.wakeLock.request('screen')
    } catch {
      wakeLockRef.current = null
    }
  }, [])

  const releaseWakeLock = useCallback(() => {
    void wakeLockRef.current?.release().catch(() => undefined)
    wakeLockRef.current = null
  }, [])

  const toggleStreaming = useCallback(async () => {
    if (streaming) {
      setStreaming(false)
      releaseWakeLock()
      return
    }
    if (!cameraActive) await startCamera()
    if (!streamRef.current) return
    await requestWakeLock()
    framesSentRef.current = 0
    setStreaming(true)
  }, [streaming, cameraActive, startCamera, requestWakeLock, releaseWakeLock])

  // Re-acquire wake lock after the tab returns to the foreground; browsers drop it on hide.
  useEffect(() => {
    if (!streaming) return
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void requestWakeLock()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [streaming, requestWakeLock])

  // Frame capture + upload loop
  useEffect(() => {
    if (!streaming) return
    const { width, height } = RESOLUTIONS[resolution]
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    canvas.width = width
    canvas.height = height

    let inFlight = false
    const endpoint = `${baseUrl}/api/camera/frame?slot=${slot}`

    const sendFrame = () => {
      const video = videoRef.current
      if (inFlight || !video || video.readyState < 2) return
      const vw = video.videoWidth
      const vh = video.videoHeight
      if (!vw || !vh) return

      const targetAspect = width / height
      let sw = vw / zoom
      let sh = vh / zoom
      if (sw / sh > targetAspect) sw = sh * targetAspect
      else sh = sw / targetAspect
      const sx = (vw - sw) / 2
      const sy = (vh - sh) / 2
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height)

      inFlight = true
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            inFlight = false
            return
          }
          fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'image/jpeg' },
            body: blob,
          })
            .then((res) => {
              if (res.ok) {
                framesSentRef.current += 1
                setSendError(false)
              } else setSendError(true)
            })
            .catch(() => setSendError(true))
            .finally(() => {
              inFlight = false
            })
        },
        'image/jpeg',
        quality,
      )
    }

    const frameTimer = window.setInterval(sendFrame, 1000 / fps)
    const fpsTimer = window.setInterval(() => {
      setMeasuredFps(framesSentRef.current)
      framesSentRef.current = 0
    }, 1000)

    return () => {
      window.clearInterval(frameTimer)
      window.clearInterval(fpsTimer)
      setMeasuredFps(0)
    }
  }, [streaming, resolution, fps, quality, zoom, slot, baseUrl])

  // Tally + ping polling (every 500 ms)
  useEffect(() => {
    let inFlight = false
    const poll = async () => {
      if (inFlight) return
      inFlight = true
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), 1500)
      const start = performance.now()
      try {
        const res = await fetch(`${baseUrl}/api/stream/status`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(String(res.status))
        const data: { active_camera_id?: number | string } = await res.json()
        setPing(Math.round(performance.now() - start))
        setServerTally(Number(data.active_camera_id) === slot ? 'onair' : 'standby')
      } catch {
        setPing(null)
        setServerTally('offline')
      } finally {
        window.clearTimeout(timeout)
        inFlight = false
      }
    }
    void poll()
    const timer = window.setInterval(poll, 500)
    return () => window.clearInterval(timer)
  }, [baseUrl, slot])

  useEffect(() => {
    return () => {
      stopCamera()
      releaseWakeLock()
    }
  }, [stopCamera, releaseWakeLock])

  const toggleDemo = (value: Tally) => setDemoTally((cur) => (cur === value ? null : value))

  const takePhoto = useCallback(async () => {
    const video = videoRef.current
    if (!cameraActive || !video || !video.videoWidth) {
      setCameraError('Aktivera kameran först för att ta foto.')
      return
    }
    const vw = video.videoWidth
    const vh = video.videoHeight
    const sw = vw / zoom
    const sh = vh / zoom
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(sw)
    canvas.height = Math.round(sh)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height)

    setFlash(true)
    setTimeout(() => setFlash(false), 150)

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
    if (!blob) return
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    const name = `foto_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.jpg`
    const url = URL.createObjectURL(blob)
    setLastPhoto((prev) => {
      if (prev) URL.revokeObjectURL(prev.url)
      return { blob, url, name }
    })
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
  }, [cameraActive, zoom])

  const sharePhoto = useCallback(async () => {
    if (!lastPhoto) return
    const file = new File([lastPhoto.blob], lastPhoto.name, { type: 'image/jpeg' })
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: lastPhoto.name }).catch(() => undefined)
    } else {
      window.open(lastPhoto.url, '_blank')
    }
  }, [lastPhoto])

  const videoTransform = `scale(${zoom})${facingMode === 'user' ? ' scaleX(-1)' : ''}`

  return (
    <main
      className={`relative flex h-dvh w-screen select-none flex-col overflow-hidden border-8 bg-zinc-950 text-white transition-colors duration-300 ${tallyStyle.frame}`}
    >
      {/* TOP BAR */}
      <header className="relative z-20 flex flex-col gap-2 bg-zinc-950/85 px-3 pb-2 pt-2 backdrop-blur">
        <div
          role="status"
          aria-live="assertive"
          className={`flex items-center justify-center rounded-md px-3 py-1.5 text-center font-mono text-sm font-bold tracking-widest sm:text-base ${tallyStyle.sign}`}
        >
          {tallyStyle.label}
          {demoTally && <span className="ml-2 text-xs font-normal opacity-80">{'(DEMO)'}</span>}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-xs">
          <span className="font-bold tracking-wider text-white">{SLOT_LABELS[slot]}</span>

          <span className="flex items-center gap-1 text-zinc-300">
            <Gauge className="size-3.5" aria-hidden />
            <span className="tabular-nums">{streaming ? measuredFps : '--'}</span>
            <span className="text-zinc-500">{`/ ${fps} FPS`}</span>
          </span>

          <span
            className={`flex items-center gap-1 ${ping === null ? 'text-red-400' : ping > 150 ? 'text-amber-400' : 'text-emerald-400'}`}
          >
            {ping === null ? <WifiOff className="size-3.5" aria-hidden /> : <Wifi className="size-3.5" aria-hidden />}
            <span className="tabular-nums">{ping === null ? 'NO LINK' : `${ping} ms`}</span>
            <span className="text-zinc-500">{':4316'}</span>
          </span>

          <span className="flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-300">
            <MicOff className="size-3" aria-hidden />
            {'LJUD: X32 MIXER (MOBIL-MIK AV)'}
          </span>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => toggleDemo('onair')}
              aria-pressed={demoTally === 'onair'}
              className={`rounded border px-2 py-1 text-[11px] font-bold transition-colors ${demoTally === 'onair' ? 'border-red-600 bg-red-600 text-white' : 'border-red-600/60 text-red-400 hover:bg-red-600/20'}`}
            >
              {'Demo: ON AIR'}
            </button>
            <button
              type="button"
              onClick={() => toggleDemo('standby')}
              aria-pressed={demoTally === 'standby'}
              className={`rounded border px-2 py-1 text-[11px] font-bold transition-colors ${demoTally === 'standby' ? 'border-emerald-500 bg-emerald-500 text-zinc-950' : 'border-emerald-500/60 text-emerald-400 hover:bg-emerald-500/20'}`}
            >
              {'Demo: STANDBY'}
            </button>
          </div>
        </div>
      </header>

      {/* VIEWFINDER */}
      <section aria-label="Kamerasökare" className="relative flex-1 overflow-hidden bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`absolute inset-0 h-full w-full object-cover transition-transform duration-200 ${cameraActive ? 'opacity-100' : 'opacity-0'}`}
          style={{ transform: videoTransform }}
        />
        <canvas ref={canvasRef} className="hidden" aria-hidden />

        {!cameraActive && (
          <div className="absolute inset-0 flex flex-col items-center justify-end gap-4 bg-[radial-gradient(ellipse_at_center,#18181b_0%,#09090b_75%)] px-6 pb-[18%] text-center">
            <p className="font-mono text-xs tracking-widest text-zinc-500">{'NO SIGNAL'}</p>
            <button
              type="button"
              onClick={() => void startCamera()}
              className="flex items-center gap-2 rounded-lg border border-zinc-600 bg-zinc-900 px-5 py-3 font-semibold text-white transition-colors hover:bg-zinc-800"
            >
              <Camera className="size-5" aria-hidden />
              {'Aktivera Mobilkamera'}
            </button>
            {cameraError && <p className="max-w-sm text-pretty text-sm leading-relaxed text-red-400">{cameraError}</p>}
          </div>
        )}

        {showGrid && (
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            <div className="absolute inset-y-0 left-1/3 w-px bg-white/25" />
            <div className="absolute inset-y-0 left-2/3 w-px bg-white/25" />
            <div className="absolute inset-x-0 top-1/3 h-px bg-white/25" />
            <div className="absolute inset-x-0 top-2/3 h-px bg-white/25" />
          </div>
        )}

        {/* Centre crosshair + safe-area corners */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
          <div className="relative size-10">
            <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/60" />
            <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-white/60" />
          </div>
        </div>
        <div className="pointer-events-none absolute inset-[6%]" aria-hidden>
          <div className="absolute left-0 top-0 size-6 border-l-2 border-t-2 border-white/40" />
          <div className="absolute right-0 top-0 size-6 border-r-2 border-t-2 border-white/40" />
          <div className="absolute bottom-0 left-0 size-6 border-b-2 border-l-2 border-white/40" />
          <div className="absolute bottom-0 right-0 size-6 border-b-2 border-r-2 border-white/40" />
        </div>

        {streaming && (
          <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded bg-zinc-950/70 px-2 py-1 font-mono text-[11px] text-zinc-200">
            <Activity className={`size-3.5 ${sendError ? 'text-red-400' : 'text-emerald-400'}`} aria-hidden />
            {sendError ? 'SERVERFEL – FÖRSÖKER IGEN' : `TX ${resolution} · Q${quality.toFixed(2)}`}
          </div>
        )}

        {/* Zoom + grid controls */}
        <div className="absolute right-3 top-1/2 flex -translate-y-1/2 flex-col gap-2">
          {ZOOM_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => setZoom(level)}
              aria-pressed={zoom === level}
              aria-label={`Zoom ${level}x`}
              className={`flex size-11 items-center justify-center rounded-full border font-mono text-xs font-bold backdrop-blur transition-colors ${zoom === level ? 'border-amber-400 bg-amber-400 text-zinc-950' : 'border-white/30 bg-zinc-950/60 text-white hover:bg-zinc-800'}`}
            >
              {`${level}x`}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowGrid((g) => !g)}
            aria-pressed={showGrid}
            aria-label="Visa eller dölj rutnät"
            className={`mt-2 flex size-11 items-center justify-center rounded-full border backdrop-blur transition-colors ${showGrid ? 'border-white bg-white/20 text-white' : 'border-white/30 bg-zinc-950/60 text-zinc-400'}`}
          >
            <Grid3x3 className="size-5" aria-hidden />
          </button>
        </div>

        {/* Photo capture */}
        <div className="absolute left-3 top-1/2 flex -translate-y-1/2 flex-col items-center gap-3">
          <button
            type="button"
            onClick={() => void takePhoto()}
            aria-label="Ta foto och spara på mobilen"
            className="flex size-16 items-center justify-center rounded-full border-4 border-white/90 bg-zinc-950/40 backdrop-blur transition-transform active:scale-90"
          >
            <span className="size-11 rounded-full bg-white" />
          </button>
          {lastPhoto && (
            <button
              type="button"
              onClick={() => void sharePhoto()}
              aria-label={`Spara eller dela ${lastPhoto.name}`}
              className="size-12 overflow-hidden rounded-lg border-2 border-white/80 bg-zinc-900"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
              <img src={lastPhoto.url} alt="" className="size-full object-cover" />
            </button>
          )}
          {lastPhoto && <span className="font-mono text-[10px] tracking-wider text-white/70">{'SPARA'}</span>}
        </div>

        {flash && <div className="pointer-events-none absolute inset-0 bg-white/80" aria-hidden />}
      </section>

      {/* BOTTOM PANEL */}
      <footer className="relative z-20 flex items-center justify-between gap-3 bg-zinc-950/90 px-4 py-4 backdrop-blur">
        <button
          type="button"
          onClick={switchCamera}
          aria-label={`Byt till ${facingMode === 'environment' ? 'främre' : 'bakre'} kamera`}
          className="flex size-14 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-white transition-colors hover:bg-zinc-800"
        >
          <SwitchCamera className="size-6" aria-hidden />
        </button>

        <button
          type="button"
          onClick={() => void toggleStreaming()}
          className={`flex min-h-14 flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-center text-sm font-black tracking-wider transition-colors sm:text-base ${streaming ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-white text-zinc-950 hover:bg-zinc-200'}`}
        >
          {streaming ? (
            <>
              <Square className="size-5 shrink-0 fill-current" aria-hidden />
              {'STOPPA SÄNDNING'}
            </>
          ) : (
            <>
              <Play className="size-5 shrink-0 fill-current" aria-hidden />
              <span className="text-balance">{'STARTA SÄNDNING TILL OPENLP-RS'}</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="Öppna inställningar"
          aria-expanded={settingsOpen}
          className="flex size-14 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-white transition-colors hover:bg-zinc-800"
        >
          <Settings className="size-6" aria-hidden />
        </button>
      </footer>

      {/* SETTINGS SHEET */}
      <div
        className={`absolute inset-0 z-30 bg-zinc-950/60 transition-opacity ${settingsOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={() => setSettingsOpen(false)}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Inställningar"
        aria-hidden={!settingsOpen}
        inert={!settingsOpen}
        className={`absolute inset-x-0 bottom-0 z-40 max-h-[80%] overflow-y-auto rounded-t-2xl border-t border-zinc-800 bg-zinc-900 p-5 transition-transform duration-300 ${settingsOpen ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-mono text-sm font-bold tracking-widest">{'INSTÄLLNINGAR'}</h2>
          <button
            type="button"
            onClick={() => setSettingsOpen(false)}
            aria-label="Stäng inställningar"
            className="flex size-9 items-center justify-center rounded-full bg-zinc-800 hover:bg-zinc-700"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="flex flex-col gap-4 text-sm">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-zinc-400">{'Server-URL (openlp-rs)'}</span>
            <input
              type="url"
              inputMode="url"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              disabled={streaming}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 font-mono text-white outline-none focus:border-zinc-400 disabled:opacity-50"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-zinc-400">{'Kameraslott'}</span>
            <select
              value={slot}
              onChange={(e) => setSlot(Number(e.target.value) as Slot)}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-white outline-none focus:border-zinc-400"
            >
              <option value={2}>{'Kamera 2 (Mobil 1 - Predikstol, slot=2)'}</option>
              <option value={3}>{'Kamera 3 (Mobil 2 - Lovsång, slot=3)'}</option>
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-zinc-400">{'Upplösning'}</span>
              <select
                value={resolution}
                onChange={(e) => setResolution(e.target.value as Resolution)}
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-white outline-none focus:border-zinc-400"
              >
                <option value="1080p">{'1080p'}</option>
                <option value="720p">{'720p'}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-zinc-400">{'Bildfrekvens'}</span>
              <select
                value={fps}
                onChange={(e) => setFps(Number(e.target.value) as 25 | 30)}
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-white outline-none focus:border-zinc-400"
              >
                <option value={25}>{'25 fps'}</option>
                <option value={30}>{'30 fps'}</option>
              </select>
            </label>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="flex justify-between text-xs font-semibold text-zinc-400">
              {'JPEG-kvalitet'}
              <span className="font-mono text-white">{quality.toFixed(2)}</span>
            </span>
            <input
              type="range"
              min={0.3}
              max={0.95}
              step={0.05}
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
              className="accent-white"
            />
          </label>

          {cameraActive && (
            <button
              type="button"
              onClick={() => void startCamera()}
              className="rounded-lg border border-zinc-700 px-3 py-2.5 text-sm font-semibold hover:bg-zinc-800"
            >
              {'Tillämpa upplösning/fps på kameran'}
            </button>
          )}

          <p className="text-xs leading-relaxed text-zinc-500">
            {'Frames skickas som JPEG via POST till '}
            <code className="font-mono text-zinc-300">{`/api/camera/frame?slot=${slot}`}</code>
            {'. Tally hämtas från '}
            <code className="font-mono text-zinc-300">{'/api/stream/status'}</code>
            {' var 500 ms.'}
          </p>
        </div>
      </aside>
    </main>
  )
}
