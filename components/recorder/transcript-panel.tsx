'use client'

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Captions, Download, FileText, KeyRound, Loader2, Plus, Share2, Trash2, X } from 'lucide-react'
import { sermonBaseName } from '@/lib/audio'
import { buildCues, parseSrt, parseSrtTimestamp, parseTimecode, srtTimestamp, toSrt, type Cue } from '@/lib/srt'
import { transcribeRange } from '@/lib/transcription'
import { useAiSettings } from '@/lib/api-keys'
import { PROVIDERS, getProvider, isProviderId, type ProviderId } from '@/lib/providers'
import { CostEstimate } from './cost-estimate'

type Status = 'idle' | 'running' | 'error'
type EditableCue = Cue & { id: number }

const LANGUAGE_OPTIONS = [
  { value: 'sv', label: 'Svenska' },
  { value: 'en', label: 'English' },
] as const

let nextId = 1
const withIds = (cues: Cue[]): EditableCue[] => cues.map((c) => ({ ...c, id: nextId++ }))

type Props = {
  buffer: AudioBuffer | null
  start?: number
  end?: number
  onManageKeys: () => void
}

export function TranscriptPanel({ buffer, start = 0, end = 0, onManageKeys }: Props) {
  const { provider, keys, setProvider } = useAiSettings()
  const [language, setLanguage] = useState<string>('sv')
  const [offsetInput, setOffsetInput] = useState('00:00:00')
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [cues, setCues] = useState<EditableCue[]>([])
  const [openedName, setOpenedName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastRun, setLastRun] = useState<{ provider: ProviderId; seconds: number } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const srtInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const offset = parseTimecode(offsetInput)
  const offsetValid = offset !== null
  const shift = offset ?? 0
  const fileName = openedName ?? `${sermonBaseName()}.srt`
  const srt = useMemo(() => toSrt(cues, shift), [cues, shift])
  const activeProvider = getProvider(provider)
  const selectionSeconds = buffer ? (end > start ? end - start : buffer.duration) : 0

  const run = async () => {
    if (!buffer) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setStatus('running')
    setError(null)
    try {
      const segments = await transcribeRange(buffer, start, end, {
        language,
        provider,
        apiKey: keys[provider],
        signal: controller.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      })
      const built = buildCues(segments)
      if (built.length === 0) throw new Error('Inget tal hittades i ljudet.')
      setCues(withIds(built))
      setLastRun({ provider, seconds: selectionSeconds })
      setOpenedName(null)
      setStatus('idle')
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

  const openSrt = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const parsed = parseSrt(await file.text())
    if (parsed.length === 0) {
      setError('Kunde inte läsa några undertextrader i filen.')
      return
    }
    setError(null)
    setCues(withIds(parsed))
    setOffsetInput('00:00:00')
    setOpenedName(file.name.toLowerCase().endsWith('.srt') ? file.name : `${file.name}.srt`)
  }

  const updateCue = (id: number, patch: Partial<Cue>) =>
    setCues((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))

  const removeCue = (id: number) => setCues((prev) => prev.filter((c) => c.id !== id))

  const insertAfter = (index: number) =>
    setCues((prev) => {
      const cur = prev[index]
      const next = prev[index + 1]
      const s = cur ? cur.end : 0
      const e = next ? Math.max(s, Math.min(next.start, s + 2)) : s + 2
      const copy = [...prev]
      copy.splice(index + 1, 0, { id: nextId++, start: s, end: e, text: '' })
      return copy
    })

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

  const hasCues = cues.length > 0
  const canShare =
    hasCues && typeof navigator !== 'undefined' && typeof navigator.canShare === 'function'
      ? navigator.canShare({ files: [makeFile()] })
      : false

  const share = () => navigator.share({ files: [makeFile()], title: fileName }).catch(() => {})

  const running = status === 'running'
  const pct = progress.total ? progress.done / progress.total : 0

  return (
    <section aria-labelledby="srt-heading" className="flex flex-col gap-4 rounded-xl bg-card p-4">
      <input
        ref={srtInputRef}
        type="file"
        accept=".srt,application/x-subrip,text/plain"
        className="sr-only"
        onChange={openSrt}
        tabIndex={-1}
        aria-hidden="true"
      />
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="srt-heading" className="text-sm font-semibold uppercase tracking-widest">
            Undertext (SRT)
          </h2>
          <p className="text-pretty text-xs leading-relaxed text-muted-foreground">
            {buffer
              ? 'Transkribera det markerade avsnittet, eller öppna en befintlig SRT-fil för att redigera texten.'
              : 'Öppna en SRT-fil för att redigera text och tidskoder.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => srtInputRef.current?.click()}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
        >
          <FileText className="size-4" aria-hidden="true" />
          Öppna SRT
        </button>
      </div>

      <div className="flex items-center gap-3 rounded-lg bg-background px-3 py-2.5">
        <Captions className="size-5 shrink-0 text-primary" aria-hidden="true" />
        <span className="truncate font-mono text-sm">{fileName}</span>
      </div>

      {buffer && (
        <>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label htmlFor="provider-select" className="text-xs text-muted-foreground">
                AI-tjänst
              </label>
              <button
                type="button"
                onClick={onManageKeys}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <KeyRound className="size-3.5" aria-hidden="true" />
                Hantera nycklar
              </button>
            </div>
            <select
              id="provider-select"
              value={provider}
              disabled={running}
              onChange={(e) => isProviderId(e.target.value) && setProvider(e.target.value)}
              className="h-11 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {PROVIDERS.map((p) => {
                const missing = p.needsKey && !keys[p.id]
                return (
                  <option key={p.id} value={p.id} disabled={missing}>
                    {`${p.name} – ${p.model}${missing ? ' (ingen nyckel)' : ''}`}
                  </option>
                )
              })}
            </select>
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

          <CostEstimate provider={provider} seconds={selectionSeconds} lastRun={lastRun} />
        </>
      )}

      <label className="flex flex-col gap-2">
        <span className="text-xs text-muted-foreground">
          {openedName ? 'Förskjut alla tidskoder' : 'Tidskod i filmen där predikan börjar'}
        </span>
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
            ? 'Läggs till alla tidskoder så att texten synkar med videon.'
            : 'Ange tid som TT:MM:SS, t.ex. 00:24:10.'}
        </span>
      </label>

      {buffer &&
        (running ? (
          <div className="flex flex-col gap-2" role="status">
            <div className="flex h-14 items-center justify-between gap-3 rounded-lg bg-background px-4">
              <span className="flex items-center gap-2 text-sm">
                <Loader2 className="size-5 animate-spin text-primary" aria-hidden="true" />
                {`${activeProvider.name}: ${progress.done}/${progress.total || '–'} delar`}
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
            {hasCues ? 'Transkribera igen' : 'Transkribera'}
          </button>
        ))}

      {error && (
        <p role="alert" className="rounded-md bg-destructive/15 px-3 py-2 text-sm leading-relaxed text-destructive">
          {error}
        </p>
      )}

      {hasCues && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            <span className="font-mono tabular-nums text-foreground">{cues.length}</span> undertextrader · tryck på en
            rad för att redigera
          </p>
          <ol
            className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto rounded-lg bg-background p-2"
            aria-label="Redigera undertext"
          >
            {cues.map((c, i) => (
              <CueRow
                key={c.id}
                index={i}
                cue={c}
                shift={shift}
                onChange={(patch) => updateCue(c.id, patch)}
                onRemove={() => removeCue(c.id)}
                onInsertAfter={() => insertAfter(i)}
              />
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

type CueRowProps = {
  index: number
  cue: Cue
  shift: number
  onChange: (patch: Partial<Cue>) => void
  onRemove: () => void
  onInsertAfter: () => void
}

function CueRow({ index, cue, shift, onChange, onRemove, onInsertAfter }: CueRowProps) {
  return (
    <li className="flex flex-col gap-2 rounded-md border border-border p-2">
      <div className="flex items-center gap-2">
        <span className="w-7 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">{index + 1}</span>
        <TimeInput label={`Start rad ${index + 1}`} seconds={cue.start + shift} onCommit={(t) => onChange({ start: Math.max(0, t - shift) })} />
        <span className="text-xs text-muted-foreground" aria-hidden="true">
          {'→'}
        </span>
        <TimeInput label={`Slut rad ${index + 1}`} seconds={cue.end + shift} onCommit={(t) => onChange({ end: Math.max(0, t - shift) })} />
      </div>
      <textarea
        value={cue.text}
        onChange={(e) => onChange({ text: e.target.value })}
        rows={2}
        aria-label={`Text rad ${index + 1}`}
        className={`field-sizing-content min-h-12 w-full resize-none rounded-md bg-card px-2.5 py-2 text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          cue.end < cue.start ? 'ring-1 ring-destructive' : ''
        }`}
      />
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={onInsertAfter}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Ny rad efter
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-destructive"
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
          Ta bort
        </button>
      </div>
    </li>
  )
}

function TimeInput({ label, seconds, onCommit }: { label: string; seconds: number; onCommit: (t: number) => void }) {
  const formatted = srtTimestamp(seconds)
  const [draft, setDraft] = useState<string | null>(null)
  const value = draft ?? formatted
  const valid = draft === null || parseSrtTimestamp(draft) !== null

  const commit = () => {
    if (draft === null) return
    const t = parseSrtTimestamp(draft)
    if (t !== null) onCommit(t)
    setDraft(null)
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={label}
      value={value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
          e.preventDefault()
          commit()
        }
        if (e.key === 'Escape') setDraft(null)
      }}
      className={`h-8 min-w-0 flex-1 rounded bg-card px-2 font-mono text-[12px] tabular-nums text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        valid ? '' : 'ring-1 ring-destructive'
      }`}
    />
  )
}
