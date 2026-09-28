import { NextResponse } from 'next/server'
import { LIVE_SLOTS, liveFrameKey, redis, type LiveFrame } from '@/lib/redis'

const LIVE_THRESHOLD_MS = 5000

export async function GET() {
  const frames = await redis.mget<(LiveFrame | null)[]>(...LIVE_SLOTS.map(liveFrameKey))
  const now = Date.now()
  const slots = LIVE_SLOTS.map((slot, i) => {
    const ts = frames[i]?.ts ?? null
    return { slot, ts, live: ts !== null && now - ts < LIVE_THRESHOLD_MS }
  })
  return NextResponse.json({ slots }, { headers: { 'Cache-Control': 'no-store' } })
}
