export type Segment = { text: string; startSecond: number; endSecond: number }
export type Cue = { start: number; end: number; text: string }

const MAX_LINE = 42
const MAX_CUE_CHARS = MAX_LINE * 2
const MAX_CUE_SECONDS = 6

const pad = (n: number, len = 2) => String(n).padStart(len, '0')

export function srtTimestamp(totalSeconds: number) {
  const ms = Math.max(0, Math.round(totalSeconds * 1000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`
}

/** Parses "HH:MM:SS", "MM:SS" or plain seconds. Returns null for invalid input. */
export function parseTimecode(value: string) {
  const parts = value.trim().split(':')
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0)
}

function wrapLines(text: string) {
  if (text.length <= MAX_LINE) return text
  const words = text.split(' ')
  let best = text
  let bestDiff = Infinity
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ')
    const b = words.slice(i).join(' ')
    const diff = Math.abs(a.length - b.length)
    if (a.length <= MAX_LINE + 4 && b.length <= MAX_LINE + 4 && diff < bestDiff) {
      best = `${a}\n${b}`
      bestDiff = diff
    }
  }
  return best
}

/**
 * Whisper segments can run 10–30 s. Subtitles are easier to read in short cues,
 * so long segments are split on word boundaries and time is distributed by character count.
 */
export function buildCues(segments: Segment[]): Cue[] {
  const cues: Cue[] = []
  for (const seg of segments) {
    const text = seg.text.replace(/\s+/g, ' ').trim()
    const duration = seg.endSecond - seg.startSecond
    if (!text || duration <= 0) continue

    const pieceCount = Math.max(Math.ceil(text.length / MAX_CUE_CHARS), Math.ceil(duration / MAX_CUE_SECONDS))
    const targetLen = Math.ceil(text.length / pieceCount)
    const words = text.split(' ')
    const pieces: string[] = []
    let current = ''
    for (const w of words) {
      const next = current ? `${current} ${w}` : w
      if (current && next.length > targetLen && next.length > 12) {
        pieces.push(current)
        current = w
      } else current = next
    }
    if (current) pieces.push(current)

    const totalChars = pieces.reduce((n, p) => n + p.length, 0)
    let t = seg.startSecond
    for (const p of pieces) {
      const end = t + (duration * p.length) / totalChars
      cues.push({ start: t, end, text: wrapLines(p) })
      t = end
    }
  }
  return cues
}

export function toSrt(cues: Cue[], offsetSeconds = 0) {
  return (
    cues
      .map(
        (c, i) =>
          `${i + 1}\n${srtTimestamp(c.start + offsetSeconds)} --> ${srtTimestamp(c.end + offsetSeconds)}\n${c.text}`,
      )
      .join('\n\n') + '\n'
  )
}
