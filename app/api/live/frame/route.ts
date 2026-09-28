import { NextResponse, type NextRequest } from 'next/server'
import { liveFrameKey, parseSlot, redis, type LiveFrame } from '@/lib/redis'

const MAX_FRAME_BYTES = 400 * 1024
const FRAME_TTL_SECONDS = 15

export async function POST(req: NextRequest) {
  const slot = parseSlot(req.nextUrl.searchParams.get('slot'))
  if (!slot) return NextResponse.json({ error: 'Ogiltigt slot' }, { status: 400 })
  if (req.headers.get('content-type') !== 'image/jpeg') {
    return NextResponse.json({ error: 'Endast image/jpeg' }, { status: 415 })
  }

  const buffer = Buffer.from(await req.arrayBuffer())
  if (buffer.length === 0 || buffer.length > MAX_FRAME_BYTES) {
    return NextResponse.json({ error: 'Ogiltig bildstorlek' }, { status: 413 })
  }
  // JPEG files always start with the SOI marker FF D8.
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return NextResponse.json({ error: 'Inte en JPEG-bild' }, { status: 415 })
  }

  const frame: LiveFrame = { ts: Date.now(), data: buffer.toString('base64') }
  await redis.set(liveFrameKey(slot), frame, { ex: FRAME_TTL_SECONDS })
  return new NextResponse(null, { status: 204 })
}

export async function GET(req: NextRequest) {
  const slot = parseSlot(req.nextUrl.searchParams.get('slot'))
  if (!slot) return NextResponse.json({ error: 'Ogiltigt slot' }, { status: 400 })

  const frame = await redis.get<LiveFrame>(liveFrameKey(slot))
  if (!frame) return new NextResponse(null, { status: 404 })

  return new NextResponse(Buffer.from(frame.data, 'base64'), {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'no-store',
      'X-Frame-Ts': String(frame.ts),
    },
  })
}
