import { transcribe } from 'ai'

export const maxDuration = 120

const MAX_BYTES = 4 * 1024 * 1024
const LANGUAGES = new Set(['sv', 'en', 'no', 'da', 'fi', 'de', 'es', 'ar', 'fa', 'ti'])

export async function POST(req: Request) {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return Response.json({ error: 'Ogiltig begäran.' }, { status: 400 })
  }

  const file = form.get('audio')
  const language = String(form.get('language') ?? 'sv')

  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: 'Ingen ljudfil skickades.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: 'Ljuddelen är för stor.' }, { status: 413 })
  }

  try {
    const result = await transcribe({
      model: 'openai/whisper-1',
      audio: new Uint8Array(await file.arrayBuffer()),
      providerOptions: {
        openai: {
          ...(LANGUAGES.has(language) && { language }),
          timestampGranularities: ['segment'],
        },
      },
    })
    return Response.json({ text: result.text, segments: result.segments })
  } catch (err) {
    console.error('Transcription failed:', err)
    const message = String(err)
    if (/credit card/i.test(message)) {
      return Response.json(
        { error: 'AI Gateway är inte aktiverad: lägg till ett betalkort under AI-fliken i Vercel-teamet för att låsa upp transkribering.' },
        { status: 402 },
      )
    }
    return Response.json({ error: 'Transkriberingen misslyckades.' }, { status: 502 })
  }
}
