import { encodeMp3 } from './audio'
import type { Segment } from './srt'

const CHUNK_SECONDS = 300
const SAMPLE_RATE = 16000
const KBPS = 32
const CONCURRENCY = 3

/** Downmixes + resamples a slice to 16 kHz mono and encodes a small MP3 (~1.2 MB per 5 min). */
async function renderChunk(buffer: AudioBuffer, start: number, length: number) {
  const ctx = new OfflineAudioContext(1, Math.ceil(length * SAMPLE_RATE), SAMPLE_RATE)
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.connect(ctx.destination)
  src.start(0, start, length)
  const rendered = await ctx.startRendering()
  return encodeMp3(rendered, 0, rendered.duration, { kbps: KBPS, stereo: false })
}

async function transcribeChunk(blob: Blob, language: string, signal: AbortSignal) {
  const body = new FormData()
  body.append('audio', new File([blob], 'chunk.mp3', { type: 'audio/mpeg' }))
  body.append('language', language)
  const res = await fetch('/api/transcribe', { method: 'POST', body, signal })
  const data = (await res.json().catch(() => ({}))) as { segments?: Segment[]; error?: string }
  if (!res.ok || !data.segments) throw new Error(data.error ?? `Serverfel (${res.status})`)
  return data.segments
}

/**
 * Splits the selected range into short chunks (Vercel functions accept ~4.5 MB per request),
 * transcribes them in parallel, and returns segments with times relative to `start`.
 */
export async function transcribeRange(
  buffer: AudioBuffer,
  start: number,
  end: number,
  { language, signal, onProgress }: { language: string; signal: AbortSignal; onProgress: (done: number, total: number) => void },
) {
  const chunks: { offset: number; length: number }[] = []
  for (let t = start; t < end - 0.25; t += CHUNK_SECONDS) {
    chunks.push({ offset: t - start, length: Math.min(CHUNK_SECONDS, end - t) })
  }

  const results: Segment[][] = new Array(chunks.length)
  let next = 0
  let done = 0
  onProgress(0, chunks.length)

  const worker = async () => {
    while (next < chunks.length) {
      const index = next++
      const { offset, length } = chunks[index]
      const blob = await renderChunk(buffer, start + offset, length)
      signal.throwIfAborted()
      const segments = await transcribeChunk(blob, language, signal)
      results[index] = segments.map((s) => ({
        text: s.text,
        startSecond: Math.min(length, s.startSecond) + offset,
        endSecond: Math.min(length, s.endSecond) + offset,
      }))
      onProgress(++done, chunks.length)
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker))
  return results.flat()
}
