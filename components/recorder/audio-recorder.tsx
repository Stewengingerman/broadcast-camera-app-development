'use client'

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import Link from 'next/link'
import {
  Camera,
  Download,
  FileAudio,
  Flag,
  FlagOff,
  Loader2,
  Mic,
  Pause,
  Play,
  RotateCcw,
  Share2,
  Square,
  Trash2,
} from 'lucide-react'
import { computePeaks, encodeMp3, formatTime, sermonFileName } from '@/lib/audio'
import { LiveMeter } from './live-meter'
import { WaveformEditor } from './waveform-editor'

type Phase = 'idle' | 'recording' | 'paused' | 'processing' | 'editing'
type Bitrate = 96 | 128 | 192

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus']

export function AudioRecorder() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)

  const [buffer, setBuffer] = useState<AudioBuffer | null>(null)
  const [peaks, setPeaks] = useState<Float32Array | null>(null)
  const [range, setRange] = useState({ start: 0, end: 0 })
  const [playhead, setPlayhead] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)

  const [bitrate, setBitrate] = useState<Bitrate>(128)
  const [stereo, setStereo] = useState(false)
  const [encodeProgress, setEncodeProgress] = useState<number | null>(null)
  const [mp3, setMp3] = useState<{ blob: Blob; url: string; name: string } | null>(null)
  const [canShare, setCanShare] = useState(false)

  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordCtxRef = useRef<AudioContext | null>(null)
  const accumulatedRef = useRef(0)
  const segmentStartRef = useRef(0)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)

  const playCtxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const playRafRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const getPlayCtx = () => {
    if (!playCtxRef.current) playCtxRef.current = new AudioContext()
    return playCtxRef.current
  }

  const invalidateMp3 = useCallback(() => {
    setMp3((prev) => {
      if (prev) URL.revokeObjectURL(prev.url)
      return null
    })
  }, [])

  const releaseRecordingResources = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    recordCtxRef.current?.close().catch(() => {})
    recordCtxRef.current = null
    wakeLockRef.current?.release().catch(() => {})
    wakeLockRef.current = null
    setAnalyser(null)
  }, [])

  useEffect(() => {
    if (phase !== 'recording') return
    const id = setInterval(() => {
      setElapsed(accumulatedRef.current + (performance.now() - segmentStartRef.current) / 1000)
    }, 200)
    return () => clearInterval(id)
  }, [phase])

  useEffect(() => {
    return () => {
      releaseRecordingResources()
      cancelAnimationFrame(playRafRef.current)
      sourceRef.current?.stop()
      playCtxRef.current?.close().catch(() => {})
    }
  }, [releaseRecordingResources])

  useEffect(() => {
    if (!mp3) return setCanShare(false)
    const file = new File([mp3.blob], mp3.name, { type: 'audio/mpeg' })
    setCanShare(typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] }))
  }, [mp3])

  const loadAudio = async (blob: Blob) => {
    setPhase('processing')
    try {
      const decoded = await getPlayCtx().decodeAudioData(await blob.arrayBuffer())
      setBuffer(decoded)
      setPeaks(computePeaks(decoded, 3000))
      setRange({ start: 0, end: decoded.duration })
      setPlayhead(0)
      invalidateMp3()
      setPhase('editing')
    } catch {
      setError('Kunde inte läsa ljudet. Prova en annan fil eller spela in igen.')
      setPhase('idle')
    }
  }

  const startRecording = async () => {
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Den här webbläsaren stöder inte ljudinspelning.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      streamRef.current = stream

      const ctx = new AudioContext()
      const node = ctx.createAnalyser()
      node.fftSize = 2048
      ctx.createMediaStreamSource(stream).connect(node)
      recordCtxRef.current = ctx
      setAnalyser(node)

      const mimeType = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m))
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType })
        releaseRecordingResources()
        loadAudio(blob)
      }
      recorder.start(1000)
      recorderRef.current = recorder

      accumulatedRef.current = 0
      segmentStartRef.current = performance.now()
      setElapsed(0)
      setPhase('recording')

      wakeLockRef.current = (await navigator.wakeLock?.request('screen').catch(() => null)) ?? null
    } catch {
      releaseRecordingResources()
      setError('Mikrofonen kunde inte startas. Kontrollera att appen har behörighet att använda mikrofonen.')
    }
  }

  const pauseRecording = () => {
    recorderRef.current?.pause()
    accumulatedRef.current += (performance.now() - segmentStartRef.current) / 1000
    setElapsed(accumulatedRef.current)
    setPhase('paused')
  }

  const resumeRecording = () => {
    recorderRef.current?.resume()
    segmentStartRef.current = performance.now()
    setPhase('recording')
  }

  const stopRecording = () => {
    recorderRef.current?.stop()
    recorderRef.current = null
    setPhase('processing')
  }

  const handleImport = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) {
      setError(null)
      loadAudio(file)
    }
  }

  const stopPlayback = useCallback(() => {
    const src = sourceRef.current
    sourceRef.current = null
    src?.stop()
    cancelAnimationFrame(playRafRef.current)
    setIsPlaying(false)
  }, [])

  const playFrom = (from: number) => {
    if (!buffer) return
    const ctx = getPlayCtx()
    ctx.resume()
    const startAt = from < range.start || from >= range.end - 0.05 ? range.start : from
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(ctx.destination)
    src.start(0, startAt, range.end - startAt)
    const ctxStart = ctx.currentTime
    src.onended = () => {
      if (sourceRef.current !== src) return
      sourceRef.current = null
      cancelAnimationFrame(playRafRef.current)
      setIsPlaying(false)
      setPlayhead(range.end)
    }
    sourceRef.current = src
    setIsPlaying(true)

    const tick = () => {
      setPlayhead(Math.min(range.end, startAt + ctx.currentTime - ctxStart))
      playRafRef.current = requestAnimationFrame(tick)
    }
    tick()
  }

  const togglePlay = () => {
    if (isPlaying) stopPlayback()
    else playFrom(playhead)
  }

  const seek = (t: number) => {
    const wasPlaying = isPlaying
    if (wasPlaying) stopPlayback()
    setPlayhead(t)
    if (wasPlaying) playFrom(t)
  }

  const changeRange = (start: number, end: number) => {
    if (isPlaying) stopPlayback()
    setRange({ start, end })
    setPlayhead((p) => Math.max(start, Math.min(end, p)))
    invalidateMp3()
  }

  const exportMp3 = async () => {
    if (!buffer) return
    stopPlayback()
    invalidateMp3()
    setEncodeProgress(0)
    try {
      const blob = await encodeMp3(buffer, range.start, range.end, {
        kbps: bitrate,
        stereo,
        onProgress: setEncodeProgress,
      })
      const name = sermonFileName()
      const url = URL.createObjectURL(blob)
      setMp3({ blob, url, name })
      triggerDownload(url, name)
    } catch {
      setError('MP3-kodningen misslyckades. Försök igen.')
    } finally {
      setEncodeProgress(null)
    }
  }

  const shareMp3 = async () => {
    if (!mp3) return
    const file = new File([mp3.blob], mp3.name, { type: 'audio/mpeg' })
    await navigator.share({ files: [file], title: mp3.name }).catch(() => {})
  }

  const discard = () => {
    if (!window.confirm('Vill du kasta inspelningen och börja om?')) return
    stopPlayback()
    invalidateMp3()
    setBuffer(null)
    setPeaks(null)
    setElapsed(0)
    setPhase('idle')
  }

  const isCapturing = phase === 'recording' || phase === 'paused'

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={`size-2.5 rounded-full ${phase === 'recording' ? 'animate-pulse bg-destructive' : 'bg-muted-foreground/40'}`}
            aria-hidden="true"
          />
          <h1 className="text-sm font-semibold uppercase tracking-widest">Predikoinspelning</h1>
        </div>
        <Link
          href="/kamera"
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Camera className="size-4" aria-hidden="true" />
          Kamera
        </Link>
      </header>

      <main className="flex flex-1 flex-col overflow-y-auto">
        {error && (
          <p role="alert" className="mx-4 mt-4 rounded-md bg-destructive/15 px-3 py-2 text-sm leading-relaxed text-destructive">
            {error}
          </p>
        )}

        {phase === 'editing' && buffer && peaks ? (
          <EditorView
            buffer={buffer}
            peaks={peaks}
            range={range}
            playhead={playhead}
            isPlaying={isPlaying}
            bitrate={bitrate}
            stereo={stereo}
            encodeProgress={encodeProgress}
            mp3={mp3}
            canShare={canShare}
            onRangeChange={changeRange}
            onSeek={seek}
            onTogglePlay={togglePlay}
            onBitrateChange={(b) => {
              setBitrate(b)
              invalidateMp3()
            }}
            onStereoChange={(s) => {
              setStereo(s)
              invalidateMp3()
            }}
            onExport={exportMp3}
            onShare={shareMp3}
            onDiscard={discard}
          />
        ) : (
          <section className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-8" aria-live="polite">
            <div className="flex flex-col items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                {phase === 'recording' && 'Spelar in'}
                {phase === 'paused' && 'Pausad'}
                {phase === 'processing' && 'Bearbetar ljud…'}
                {phase === 'idle' && 'Redo att spela in'}
              </span>
              <time className="font-mono text-6xl font-medium tabular-nums tracking-tight">{formatTime(elapsed)}</time>
            </div>

            <div className="h-36 w-full max-w-xl rounded-lg bg-card px-3">
              <LiveMeter analyser={analyser} active={phase === 'recording'} />
            </div>

            {phase === 'idle' && (
              <p className="max-w-xs text-pretty text-center text-sm leading-relaxed text-muted-foreground">
                Tryck på den röda knappen för att börja. Efteråt kan du klippa start och slut och spara som MP3.
              </p>
            )}
          </section>
        )}
      </main>

      {phase !== 'editing' && (
        <footer className="flex items-center justify-center gap-6 border-t border-border px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5">
          {phase === 'idle' && (
            <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex size-14 items-center justify-center rounded-full bg-muted text-foreground transition-colors hover:bg-muted/70"
                aria-label="Importera ljudfil"
              >
                <FileAudio className="size-6" />
              </button>
              <input ref={fileInputRef} type="file" accept="audio/*" className="sr-only" onChange={handleImport} tabIndex={-1} />
              <RecordButton onClick={startRecording} />
              <span className="size-14" aria-hidden="true" />
            </>
          )}

          {isCapturing && (
            <>
              <button
                type="button"
                onClick={phase === 'recording' ? pauseRecording : resumeRecording}
                className="flex size-14 items-center justify-center rounded-full bg-muted text-foreground transition-colors hover:bg-muted/70"
                aria-label={phase === 'recording' ? 'Pausa inspelning' : 'Återuppta inspelning'}
              >
                {phase === 'recording' ? <Pause className="size-6" /> : <Mic className="size-6" />}
              </button>
              <button
                type="button"
                onClick={stopRecording}
                className="flex size-20 items-center justify-center rounded-full border-4 border-destructive/40 bg-destructive text-foreground transition-transform active:scale-95"
                aria-label="Stoppa inspelning"
              >
                <Square className="size-7 fill-current" />
              </button>
              <span className="size-14" aria-hidden="true" />
            </>
          )}

          {phase === 'processing' && (
            <div className="flex h-20 items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-5 animate-spin" aria-hidden="true" />
              Förbereder vågform…
            </div>
          )}
        </footer>
      )}
    </div>
  )
}

function RecordButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex size-20 items-center justify-center rounded-full border-4 border-foreground/80 transition-transform active:scale-95"
      aria-label="Starta inspelning"
    >
      <span className="size-14 rounded-full bg-destructive" />
    </button>
  )
}

type EditorProps = {
  buffer: AudioBuffer
  peaks: Float32Array
  range: { start: number; end: number }
  playhead: number
  isPlaying: boolean
  bitrate: Bitrate
  stereo: boolean
  encodeProgress: number | null
  mp3: { url: string; name: string } | null
  canShare: boolean
  onRangeChange: (start: number, end: number) => void
  onSeek: (t: number) => void
  onTogglePlay: () => void
  onBitrateChange: (b: Bitrate) => void
  onStereoChange: (s: boolean) => void
  onExport: () => void
  onShare: () => void
  onDiscard: () => void
}

function EditorView({
  buffer,
  peaks,
  range,
  playhead,
  isPlaying,
  bitrate,
  stereo,
  encodeProgress,
  mp3,
  canShare,
  onRangeChange,
  onSeek,
  onTogglePlay,
  onBitrateChange,
  onStereoChange,
  onExport,
  onShare,
  onDiscard,
}: EditorProps) {
  const encoding = encodeProgress !== null
  const length = range.end - range.start
  const trimmed = range.start > 0.05 || range.end < buffer.duration - 0.05
  const estimatedMb = (length * bitrate * 1000) / 8 / 1024 / 1024

  return (
    <div className="flex flex-col gap-6 px-4 py-6">
      <section aria-labelledby="edit-heading" className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <h2 id="edit-heading" className="text-sm font-semibold uppercase tracking-widest">
            Klipp ljudet
          </h2>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            Totalt {formatTime(buffer.duration)}
          </span>
        </div>

        <div className="px-1 pt-3 pb-1">
          <WaveformEditor
            peaks={peaks}
            duration={buffer.duration}
            start={range.start}
            end={range.end}
            playhead={playhead}
            onRangeChange={onRangeChange}
            onSeek={onSeek}
          />
        </div>

        <dl className="grid grid-cols-3 gap-2 text-center">
          <Readout label="Start" value={formatTime(range.start, true)} />
          <Readout label="Längd" value={formatTime(length)} highlight />
          <Readout label="Slut" value={formatTime(range.end, true)} />
        </dl>

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onRangeChange(Math.min(playhead, range.end - 0.5), range.end)}
            className="flex flex-1 flex-col items-center gap-1 rounded-lg bg-muted py-2.5 text-xs font-medium transition-colors hover:bg-muted/70"
          >
            <Flag className="size-4" aria-hidden="true" />
            Start här
          </button>
          <button
            type="button"
            onClick={onTogglePlay}
            className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform active:scale-95"
            aria-label={isPlaying ? 'Pausa uppspelning' : 'Spela markerat avsnitt'}
          >
            {isPlaying ? <Pause className="size-7 fill-current" /> : <Play className="ml-1 size-7 fill-current" />}
          </button>
          <button
            type="button"
            onClick={() => onRangeChange(range.start, Math.max(playhead, range.start + 0.5))}
            className="flex flex-1 flex-col items-center gap-1 rounded-lg bg-muted py-2.5 text-xs font-medium transition-colors hover:bg-muted/70"
          >
            <FlagOff className="size-4" aria-hidden="true" />
            Slut här
          </button>
        </div>

        <p className="text-pretty text-center text-xs leading-relaxed text-muted-foreground">
          Dra i markörerna Start och Slut, eller tryck i vågen för att flytta uppspelningen.
          {trimmed && (
            <>
              {' '}
              <button
                type="button"
                onClick={() => onRangeChange(0, buffer.duration)}
                className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
              >
                <RotateCcw className="size-3" aria-hidden="true" />
                Återställ
              </button>
            </>
          )}
        </p>
      </section>

      <section aria-labelledby="save-heading" className="flex flex-col gap-4 rounded-xl bg-card p-4">
        <h2 id="save-heading" className="text-sm font-semibold uppercase tracking-widest">
          Spara som MP3
        </h2>

        <div className="flex items-center gap-3 rounded-lg bg-background px-3 py-2.5">
          <FileAudio className="size-5 shrink-0 text-primary" aria-hidden="true" />
          <span className="truncate font-mono text-sm">{sermonFileName()}</span>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground" id="bitrate-label">
            Kvalitet
          </span>
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-background p-1" role="radiogroup" aria-labelledby="bitrate-label">
            {([96, 128, 192] as const).map((b) => (
              <button
                key={b}
                type="button"
                role="radio"
                aria-checked={bitrate === b}
                onClick={() => onBitrateChange(b)}
                className={`rounded-md py-2 text-sm font-medium transition-colors ${
                  bitrate === b ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {b} kbps
              </button>
            ))}
          </div>
        </div>

        {buffer.numberOfChannels > 1 && (
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Stereo</span>
            <input
              type="checkbox"
              checked={stereo}
              onChange={(e) => onStereoChange(e.target.checked)}
              className="size-5 accent-[var(--primary)]"
            />
          </label>
        )}

        <p className="text-xs text-muted-foreground">
          {'Uppskattad storlek: '}
          <span className="font-mono tabular-nums text-foreground">{estimatedMb.toFixed(1)} MB</span>
        </p>

        <button
          type="button"
          onClick={onExport}
          disabled={encoding}
          className="flex h-14 items-center justify-center gap-2 rounded-lg bg-primary text-base font-semibold text-primary-foreground transition-opacity disabled:opacity-80"
        >
          {encoding ? (
            <>
              <Loader2 className="size-5 animate-spin" aria-hidden="true" />
              Kodar MP3… {Math.round((encodeProgress ?? 0) * 100)}%
            </>
          ) : (
            <>
              <Download className="size-5" aria-hidden="true" />
              Spara MP3
            </>
          )}
        </button>

        {encoding && (
          <div className="h-1.5 overflow-hidden rounded-full bg-background" aria-hidden="true">
            <div className="h-full bg-primary transition-[width]" style={{ width: `${(encodeProgress ?? 0) * 100}%` }} />
          </div>
        )}

        {mp3 && !encoding && (
          <div className="flex flex-col gap-2" role="status">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {'Sparad. Om nedladdningen inte startade: '}
              <a href={mp3.url} download={mp3.name} className="font-medium text-primary underline underline-offset-2">
                ladda ner {mp3.name}
              </a>
            </p>
            {canShare && (
              <button
                type="button"
                onClick={onShare}
                className="flex h-12 items-center justify-center gap-2 rounded-lg bg-muted text-sm font-medium transition-colors hover:bg-muted/70"
              >
                <Share2 className="size-4" aria-hidden="true" />
                Dela / spara i Filer
              </button>
            )}
          </div>
        )}
      </section>

      <button
        type="button"
        onClick={onDiscard}
        className="mb-[env(safe-area-inset-bottom)] flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground transition-colors hover:text-destructive"
      >
        <Trash2 className="size-4" aria-hidden="true" />
        Ny inspelning
      </button>
    </div>
  )
}

function Readout({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-card py-2">
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className={`font-mono text-sm tabular-nums ${highlight ? 'text-primary' : ''}`}>{value}</dd>
    </div>
  )
}

function triggerDownload(url: string, name: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
}
