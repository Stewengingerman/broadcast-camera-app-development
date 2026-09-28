import { Redis } from '@upstash/redis'

export const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
})

export const LIVE_SLOTS = [2, 3] as const
export type LiveSlot = (typeof LIVE_SLOTS)[number]

export function parseSlot(value: string | null): LiveSlot | null {
  const n = Number(value)
  return (LIVE_SLOTS as readonly number[]).includes(n) ? (n as LiveSlot) : null
}

export const liveFrameKey = (slot: LiveSlot) => `live:frame:${slot}`

export interface LiveFrame {
  ts: number
  data: string
}
