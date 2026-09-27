'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Captions, Download, Loader2, Share2, X } from 'lucide-react'
import { sermonBaseName } from '@/lib/audio'
import { buildCues, parseTimecode, srtTimestamp, toSrt, type Cue } from '@/lib/srt'
import { transcribeRange } from '@/lib/transcription'

type Status = 'idle' | 'running' | 'done' | 'error'

const LANGUAGE_OPTIONS = [
  { value: 'sv', label: 'Svenska' },
  { value: 'en', label: 'English' },
] as const

type Props = {
  buffer: AudioBuffer
  start: number
  end: number
}

export function TranscriptPanel({ buffer, start, end }: Props) {
  const [language, setLanguage] = useState<string>('sv')
  const [offsetInput, setOffsetInput] = useState('00:00:00')
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [cues, setCues] = useState<Cue[]>([])
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const offset = parseTimecode(offsetInput)
  const offsetValid = offset !== null
  const fileName = `${sermonBaseName()}.srt`
  const srt = useMemo(() => toSrt(cues, offset ?? 0), [cues, offset])

  const run = async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setStatus('running')
    setError(null)
    setCues([])
    try {
      const segments = await transcribeRange(buffer, start, end, {
        language,
        signal: controller.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      })
      const built = buildCues(segments)
      if (built.length === 0) throw new Error('Inget tal hittades i ljudet.')
      setCues(built)
      setStatus('done')
    } catch (err) {
      if (controller.signal.aborted) {
        setStatus('idle')
        return
      }
      controller.abort()
      setError(err instanceof Error ? err.message : 'Transkriberingen misslyckades.')
      setStatus('error')
    }
  }

  const cancel = () => {
    abortRef.current?.abort()
    setStatus('idle')
  }

  const makeFile = () => new File([srt], fileName, { type: 'application/x-subrip' })

  const download = () => {
    const url = URL.createObjectURL(makeFile())
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const canShare =
    status === 'done' && typeof navigator !== 'undefined' && typeof navigator.canShare === 'function'
      ? navigator.canShare({ files: [makeFile()] })
      : false

  const share = () => navigator.share({ files: [makeFile()], title: fileName }).catch(() => {})

  const running = status === 'running'
  const pct = progress.total ? progress.done / progress.total : 0

  return (
    <section aria-labelledby="srt-heading" className="flex flex-col gap-4 rounded-xl bg-card p-4">
      <div className="flex flex-col gap-1">
        <h2 id="srt-heading" className="text-sm font-semibold uppercase tracking-widest">
          Undertext (SRT)
        </h2>
        <p className="text-pretty text-xs leading-relaxed text-muted-foreground">
          Det markerade avsnittet skickas för transkribering och sparas som en undertextfil med tidskoder.
        </p>
      </div>

      <div className="flex items-center gap-3 rounded-lg bg-background px-3 py-2.5">
        <Captions className="size-5 shrink-0 text-primary" aria-hidden="true" />
        <span className="truncate font-mono text-sm">{fileName}</span>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs text-muted-foreground" id="lang-label">
          Språk
        </span>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-background p-1" role="radiogroup" aria-labelledby="lang-label">
          {LANGUAGE_OPTIONS.map((l) => (
            <button
              key={l.value}
              type="button"
              role="radio"
              aria-checked={language === l.value}
              disabled={running}
              onClick={() => setLanguage(l.value)}
              className={`rounded-md py-2 text-sm font-medium transition-colors ${
                language === l.value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-2">
        <span className="text-xs text-muted-foreground">Tidskod i filmen där predikan börjar</span>
        <input
          type="text"
          inputMode="numeric"
          value={offsetInput}
          onChange={(e) => setOffsetInput(e.target.value)}
          placeholder="00:00:00"
          aria-invalid={!offsetValid}
          aria-describedby="offset-help"
          className={`h-11 rounded-lg border bg-background px-3 font-mono text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            offsetValid ? 'border-border' : 'border-destructive'
          }`}
        />
        <span id="offset-help" className="text-xs leading-relaxed text-muted-foreground">
          {offsetValid
            ? 'Läggs till alla tidskoder så att texten synkar med videon. Kan ändras efteråt.'
            : 'Ange tid som TT:MM:SS, t.ex. 00:24:10.'}
        </span>
      </label>

      {running ? (
        <div className="flex flex-col gap-2" role="status">
          <div className="flex h-14 items-center justify-between gap-3 rounded-lg bg-background px-4">
            <span className="flex items-center gap-2 text-sm">
              <Loader2 className="size-5 animate-spin text-primary" aria-hidden="true" />
              {`Transkriberar… ${progress.done}/${progress.total || '–'} delar`}
            </span>
            <button
              type="button"
              onClick={cancel}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" aria-hidden="true" />
              Avbryt
            </button>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-background" aria-hidden="true">
            <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.max(4, pct * 100)}%` }} />
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={run}
          className="flex h-14 items-center justify-center gap-2 rounded-lg bg-muted text-base font-semibold text-foreground transition-colors hover:bg-muted/70"
        >
          <Captions className="size-5" aria-hidden="true" />
          {status === 'done' ? 'Transkribera igen' : 'Transkribera'}
        </button>
      )}

      {error && (
        <p role="alert" className="rounded-md bg-destructive/15 px-3 py-2 text-sm leading-relaxed text-destructive">
          {error}
        </p>
      )}

      {status === 'done' && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            <span className="font-mono tabular-nums text-foreground">{cues.length}</span> undertextrader
          </p>
          <ol className="flex max-h-72 flex-col gap-2 overflow-y-auto rounded-lg bg-background p-3" aria-label="Förhandsvisning av undertext">
            {cues.map((c, i) => (
              <li key={i} className="flex flex-col gap-0.5 border-b border-border pb-2 last:border-0 last:pb-0">
                <span className="font-mono text-[11px] tabular-nums text-primary">
                  {srtTimestamp(c.start + (offset ?? 0))} {'→'} {srtTimestamp(c.end + (offset ?? 0))}
                </span>
                <span className="whitespace-pre-line text-sm leading-relaxed">{c.text}</span>
              </li>
            ))}
          </ol>
          <button
            type="button"
            onClick={download}
            disabled={!offsetValid}
            className="flex h-14 items-center justify-center gap-2 rounded-lg bg-primary text-base font-semibold text-primary-foreground disabled:opacity-60"
          >
            <Download className="size-5" aria-hidden="true" />
            Spara SRT
          </button>
          {canShare && (
            <button
              type="button"
              onClick={share}
              disabled={!offsetValid}
              className="flex h-12 items-center justify-center gap-2 rounded-lg bg-muted text-sm font-medium transition-colors hover:bg-muted/70"
            >
              <Share2 className="size-4" aria-hidden="true" />
              Dela / spara i Filer
            </button>
          )}
        </div>
      )}
    </section>
  )
}
