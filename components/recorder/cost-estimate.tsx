'use client'

import { useId, useState } from 'react'
import { Coins } from 'lucide-react'
import { DEFAULT_SEK_PER_USD, PROVIDERS, USD_PER_MINUTE, type ProviderId } from '@/lib/providers'

const kr = (value: number, digits = 2) =>
  new Intl.NumberFormat('sv-SE', {
    style: 'currency',
    currency: 'SEK',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)

const formatMinutes = (seconds: number) => {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m} min ${String(s).padStart(2, '0')} s`
}

type Props = {
  provider: ProviderId
  seconds: number
  lastRun: { provider: ProviderId; seconds: number } | null
}

export function CostEstimate({ provider, seconds, lastRun }: Props) {
  const [rateInput, setRateInput] = useState(String(DEFAULT_SEK_PER_USD).replace('.', ','))
  const rateId = useId()
  const parsedRate = Number.parseFloat(rateInput.replace(',', '.'))
  const rate = Number.isFinite(parsedRate) && parsedRate > 0 ? parsedRate : DEFAULT_SEK_PER_USD

  const perMinute = (id: ProviderId) => USD_PER_MINUTE[id] * rate
  const minutes = seconds / 60
  const lastRunCost = lastRun ? perMinute(lastRun.provider) * (lastRun.seconds / 60) : null

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          <Coins className="size-4 text-primary" aria-hidden="true" />
          Kostnad
        </span>
        <label htmlFor={rateId} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          1 USD =
          <input
            id={rateId}
            type="text"
            inputMode="decimal"
            value={rateInput}
            onChange={(e) => setRateInput(e.target.value)}
            className="h-7 w-14 rounded border border-border bg-card px-1.5 text-right font-mono text-xs tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          kr
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">Per minut</span>
          <span className="font-mono text-2xl font-semibold tabular-nums">{kr(perMinute(provider), 3)}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">{`Markering · ${formatMinutes(seconds)}`}</span>
          <span className="font-mono text-2xl font-semibold tabular-nums text-primary">
            {kr(perMinute(provider) * minutes)}
          </span>
        </div>
      </div>

      <ul className="flex flex-col divide-y divide-border border-t border-border text-xs" aria-label="Jämförelse per minut">
        {PROVIDERS.map((p) => (
          <li
            key={p.id}
            className={`flex items-center justify-between py-1.5 ${
              p.id === provider ? 'font-semibold text-foreground' : 'text-muted-foreground'
            }`}
          >
            <span>{p.name}</span>
            <span className="font-mono tabular-nums">{`${kr(perMinute(p.id), 3)}/min`}</span>
          </li>
        ))}
      </ul>

      {lastRunCost !== null && lastRun && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {`Senaste transkribering: ${formatMinutes(lastRun.seconds)} ≈ `}
          <span className="font-mono font-semibold text-foreground">{kr(lastRunCost)}</span>
        </p>
      )}

      <p className="text-pretty text-xs leading-relaxed text-muted-foreground">
        Uppskattning baserad på tjänsternas listpriser. Faktisk kostnad kan variera med abonnemang.
      </p>
    </div>
  )
}
