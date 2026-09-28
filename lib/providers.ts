export const PROVIDERS = [
  {
    id: 'gateway',
    name: 'Vercel AI Gateway',
    model: 'Whisper · standard',
    needsKey: false,
    keyUrl: null,
    placeholder: '',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    model: 'whisper-1',
    needsKey: true,
    keyUrl: 'https://platform.openai.com/api-keys',
    placeholder: 'sk-…',
  },
  {
    id: 'groq',
    name: 'Groq',
    model: 'whisper-large-v3',
    needsKey: true,
    keyUrl: 'https://console.groq.com/keys',
    placeholder: 'gsk_…',
  },
  {
    id: 'deepgram',
    name: 'Deepgram',
    model: 'nova-3',
    needsKey: true,
    keyUrl: 'https://console.deepgram.com/',
    placeholder: 'Deepgram API key',
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    model: 'scribe_v2',
    needsKey: true,
    keyUrl: 'https://elevenlabs.io/app/settings/api-keys',
    placeholder: 'sk_…',
  },
] as const

export type ProviderId = (typeof PROVIDERS)[number]['id']

/** Approximate public list prices in USD per audio minute. */
export const USD_PER_MINUTE: Record<ProviderId, number> = {
  gateway: 0.006,
  openai: 0.006,
  groq: 0.111 / 60,
  deepgram: 0.0043,
  elevenlabs: 0.4 / 60,
}

export const DEFAULT_SEK_PER_USD = 9.5

export const PROVIDER_IDS = PROVIDERS.map((p) => p.id) as ProviderId[]

export function getProvider(id: ProviderId) {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]
}

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (PROVIDER_IDS as string[]).includes(value)
}
