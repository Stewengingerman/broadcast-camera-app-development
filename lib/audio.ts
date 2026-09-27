import { Mp3Encoder } from '@breezystack/lamejs'

const pad = (n: number) => String(n).padStart(2, '0')

export function sermonFileName(date = new Date()) {
  return `predikan_${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.mp3`
}

export function formatTime(totalSeconds: number, withTenths = false) {
  const s = Math.max(0, totalSeconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const base = h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
  return withTenths ? `${base}.${Math.floor((s * 10) % 10)}` : base
}

export function computePeaks(buffer: AudioBuffer, buckets: number) {
  const left = buffer.getChannelData(0)
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null
  const size = Math.max(1, Math.floor(left.length / buckets))
  const step = Math.max(1, Math.floor(size / 256))
  const peaks = new Float32Array(buckets)
  let globalMax = 0

  for (let i = 0; i < buckets; i++) {
    const from = i * size
    const to = Math.min(from + size, left.length)
    let max = 0
    for (let j = from; j < to; j += step) {
      const v = right ? (Math.abs(left[j]) + Math.abs(right[j])) / 2 : Math.abs(left[j])
      if (v > max) max = v
    }
    peaks[i] = max
    if (max > globalMax) globalMax = max
  }

  if (globalMax > 0) {
    for (let i = 0; i < buckets; i++) peaks[i] /= globalMax
  }
  return peaks
}

const toInt16 = (v: number) => {
  const c = Math.max(-1, Math.min(1, v))
  return c < 0 ? c * 0x8000 : c * 0x7fff
}

type EncodeOptions = {
  kbps: number
  stereo: boolean
  onProgress?: (progress: number) => void
}

export async function encodeMp3(
  buffer: AudioBuffer,
  start: number,
  end: number,
  { kbps, stereo, onProgress }: EncodeOptions,
) {
  const sampleRate = buffer.sampleRate
  const from = Math.floor(start * sampleRate)
  const to = Math.min(buffer.length, Math.floor(end * sampleRate))
  const channels = stereo && buffer.numberOfChannels > 1 ? 2 : 1
  const encoder = new Mp3Encoder(channels, sampleRate, kbps)

  const left = buffer.getChannelData(0)
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left
  const blockSize = 1152 * 16
  const leftBlock = new Int16Array(blockSize)
  const rightBlock = new Int16Array(blockSize)
  const chunks: Uint8Array[] = []
  let iteration = 0

  for (let i = from; i < to; i += blockSize) {
    const len = Math.min(blockSize, to - i)
    const l = leftBlock.subarray(0, len)
    const r = rightBlock.subarray(0, len)
    for (let k = 0; k < len; k++) {
      if (channels === 1) {
        l[k] = toInt16((left[i + k] + right[i + k]) / 2)
      } else {
        l[k] = toInt16(left[i + k])
        r[k] = toInt16(right[i + k])
      }
    }
    const out = channels === 1 ? encoder.encodeBuffer(l) : encoder.encodeBuffer(l, r)
    if (out.length > 0) chunks.push(new Uint8Array(out))

    // Yield to the main thread so the UI and progress bar stay responsive on long sermons.
    if (++iteration % 12 === 0) {
      onProgress?.((i - from) / (to - from))
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  const tail = encoder.flush()
  if (tail.length > 0) chunks.push(new Uint8Array(tail))
  onProgress?.(1)

  return new Blob(chunks as BlobPart[], { type: 'audio/mpeg' })
}
