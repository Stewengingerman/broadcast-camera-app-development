'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { isProviderId, type ProviderId } from './providers'

type Settings = { provider: ProviderId; keys: Partial<Record<ProviderId, string>> }

const STORAGE_KEY = 'predikan:ai-settings'
const DEFAULT: Settings = { provider: 'gateway', keys: {} }

const listeners = new Set<() => void>()
let cachedRaw: string | null | undefined
let cached: Settings = DEFAULT

function read(): Settings {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw === cachedRaw) return cached
  cachedRaw = raw
  try {
    const parsed = raw ? (JSON.parse(raw) as Partial<Settings>) : {}
    const keys: Settings['keys'] = {}
    for (const [id, key] of Object.entries(parsed.keys ?? {})) {
      if (isProviderId(id) && typeof key === 'string' && key) keys[id] = key
    }
    const provider = isProviderId(parsed.provider) ? parsed.provider : 'gateway'
    cached = { provider: provider === 'gateway' || keys[provider] ? provider : 'gateway', keys }
  } catch {
    cached = DEFAULT
  }
  return cached
}

function write(next: Settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => e.key === STORAGE_KEY && listener()
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** API keys are kept only in this browser; they are sent per request and never stored on the server. */
export function useAiSettings() {
  const settings = useSyncExternalStore(subscribe, read, () => DEFAULT)

  const setKey = useCallback((id: ProviderId, key: string) => {
    const current = read()
    const keys = { ...current.keys }
    const trimmed = key.trim()
    if (trimmed) keys[id] = trimmed
    else delete keys[id]
    const provider = trimmed ? id : current.provider === id ? 'gateway' : current.provider
    write({ provider, keys })
  }, [])

  const setProvider = useCallback((provider: ProviderId) => {
    write({ ...read(), provider })
  }, [])

  return { ...settings, setKey, setProvider }
}

export function maskKey(key: string) {
  return key.length <= 8 ? '••••' : `${key.slice(0, 3)}••••${key.slice(-4)}`
}
