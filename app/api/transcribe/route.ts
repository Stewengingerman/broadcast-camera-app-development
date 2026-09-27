import { APICallError, transcribe } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createGroq } from '@ai-sdk/groq'
import { createDeepgram } from '@ai-sdk/deepgram'
import { createElevenLabs } from '@ai-sdk/elevenlabs'
import { getProvider, isProviderId, type ProviderId } from '@/lib/providers'

export const maxDuration = 120

const MAX_BYTES = 4 * 1024 * 1024
const LANGUAGES = new Set(['sv', 'en', 'no', 'da', 'fi', 'de', 'es', 'ar', 'fa', 'ti'])

type TranscribeArgs = Parameters<typeof transcribe>[0]

function buildRequest(
  provider: ProviderId,
  apiKey: string,
  language: string | undefined,
): Pick<TranscribeArgs, 'model' | 'providerOptions'> {
  switch (provider) {
    case 'openai':
      return {
        model: createOpenAI({ apiKey }).transcription('whisper-1'),
        providerOptions: { openai: { language, timestampGranularities: ['segment'] } },
      }
    case 'groq':
      return {
        model: createGroq({ apiKey }).transcription('whisper-large-v3'),
        providerOptions: {
          groq: { language, responseFormat: 'verbose_json', timestampGranularities: ['segment'] },
        },
      }
    case 'deepgram':
      return {
        model: createDeepgram({ apiKey }).transcription('nova-3'),
        providerOptions: { deepgram: { language, smartFormat: true, punctuate: true } },
      }
    case 'elevenlabs':
      return {
        model: createElevenLabs({ apiKey }).transcription('scribe_v2'),
        providerOptions: { elevenlabs: { languageCode: language, tagAudioEvents: false, diarize: false } },
      }
    default:
      return {
        model: 'openai/whisper-1',
        providerOptions: { openai: { language, timestampGranularities: ['segment'] } },
      }
  }
}

export async function POST(req: Request) {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return Response.json({ error: 'Ogiltig begäran.' }, { status: 400 })
  }

  const file = form.get('audio')
  const rawLanguage = String(form.get('language') ?? 'sv')
  const language = LANGUAGES.has(rawLanguage) ? rawLanguage : undefined
  const rawProvider = form.get('provider') ?? 'gateway'
  const apiKey = req.headers.get('x-provider-key')?.trim() ?? ''

  if (!isProviderId(rawProvider)) {
    return Response.json({ error: 'Okänd AI-tjänst.' }, { status: 400 })
  }
  const provider = getProvider(rawProvider)
  if (provider.needsKey && !apiKey) {
    return Response.json({ error: `Ingen API-nyckel angiven för ${provider.name}.` }, { status: 400 })
  }
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: 'Ingen ljudfil skickades.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: 'Ljuddelen är för stor.' }, { status: 413 })
  }

  try {
    const { model, providerOptions } = buildRequest(provider.id, apiKey, language)
    const result = await transcribe({
      model,
      audio: new Uint8Array(await file.arrayBuffer()),
      providerOptions,
    })
    return Response.json({ text: result.text, segments: result.segments })
  } catch (err) {
    const status = APICallError.isInstance(err) ? err.statusCode : undefined
    console.error(`Transcription failed (${provider.id}, status ${status ?? 'n/a'})`)

    if (status === 401 || status === 403) {
      return Response.json(
        {
          error: provider.needsKey
            ? `${provider.name} godkände inte API-nyckeln. Kontrollera nyckeln under AI-nycklar.`
            : 'AI Gateway nekade åtkomst.',
        },
        { status: 401 },
      )
    }
    if (status === 429) {
      return Response.json({ error: `${provider.name}: för många förfrågningar eller slut på kvot.` }, { status: 429 })
    }
    if (!provider.needsKey && /credit card/i.test(String(err))) {
      return Response.json(
        {
          error:
            'AI Gateway är inte aktiverad: lägg till ett betalkort under AI-fliken i Vercel-teamet, eller använd en egen API-nyckel under AI-nycklar.',
        },
        { status: 402 },
      )
    }
    return Response.json({ error: `Transkriberingen via ${provider.name} misslyckades.` }, { status: 502 })
  }
}
