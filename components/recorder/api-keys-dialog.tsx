'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ExternalLink, KeyRound, Trash2, X } from 'lucide-react'
import { maskKey, useAiSettings } from '@/lib/api-keys'
import { PROVIDERS, type ProviderId } from '@/lib/providers'

type Props = { open: boolean; onClose: () => void }

export function ApiKeysDialog({ open, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      aria-labelledby="keys-title"
      className="m-0 mt-auto max-h-[90dvh] w-full max-w-none rounded-t-2xl bg-card p-0 text-foreground backdrop:bg-background/80 sm:m-auto sm:max-w-lg sm:rounded-2xl"
    >
      {open && <KeysContent onClose={onClose} />}
    </dialog>
  )
}

function KeysContent({ onClose }: { onClose: () => void }) {
  const { keys, setKey } = useAiSettings()

  return (
    <div className="flex flex-col gap-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="keys-title" className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest">
            <KeyRound className="size-4 text-primary" aria-hidden="true" />
            AI-nycklar
          </h2>
          <p className="text-pretty text-xs leading-relaxed text-muted-foreground">
            Lägg till egna API-nycklar för transkribering. Nycklarna sparas bara i den här webbläsaren och skickas med
            varje förfrågan – de lagras aldrig på servern.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Stäng"
        >
          <X className="size-5" />
        </button>
      </div>

      <ul className="flex flex-col gap-2 overflow-y-auto">
        {PROVIDERS.map((p) =>
          p.needsKey ? (
            <KeyRow
              key={p.id}
              id={p.id}
              name={p.name}
              model={p.model}
              keyUrl={p.keyUrl}
              placeholder={p.placeholder}
              saved={keys[p.id]}
              onSave={(v) => setKey(p.id, v)}
            />
          ) : (
            <li key={p.id} className="flex items-center justify-between gap-3 rounded-lg bg-background px-3 py-3">
              <div className="flex flex-col">
                <span className="text-sm font-medium">{p.name}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{p.model}</span>
              </div>
              <span className="text-xs text-muted-foreground">Ingen nyckel behövs</span>
            </li>
          ),
        )}
      </ul>
    </div>
  )
}

type RowProps = {
  id: ProviderId
  name: string
  model: string
  keyUrl: string | null
  placeholder: string
  saved?: string
  onSave: (value: string) => void
}

function KeyRow({ id, name, model, keyUrl, placeholder, saved, onSave }: RowProps) {
  const [draft, setDraft] = useState('')
  const inputId = `key-${id}`

  return (
    <li className="flex flex-col gap-2 rounded-lg bg-background px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <label htmlFor={inputId} className="text-sm font-medium">
            {name}
          </label>
          <span className="font-mono text-[11px] text-muted-foreground">{model}</span>
        </div>
        {keyUrl && (
          <a
            href={keyUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Skaffa nyckel
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        )}
      </div>

      {saved ? (
        <div className="flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-2">
          <span className="flex items-center gap-2 font-mono text-xs">
            <Check className="size-4 text-primary" aria-hidden="true" />
            {maskKey(saved)}
          </span>
          <button
            type="button"
            onClick={() => onSave('')}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            Ta bort
          </button>
        </div>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!draft.trim()) return
            onSave(draft)
            setDraft('')
          }}
        >
          <input
            id={inputId}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            className="h-10 min-w-0 flex-1 rounded-md border border-border bg-card px-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="h-10 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            Spara
          </button>
        </form>
      )}
    </li>
  )
}
