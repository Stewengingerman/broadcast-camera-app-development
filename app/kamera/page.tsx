import type { Metadata } from 'next'
import { BroadcastCamera } from '@/components/broadcast-camera'

export const metadata: Metadata = {
  title: 'Broadcast Camera – openlp-rs',
  description: 'Mobil sändningskamera med tally-ljus för openlp-rs bildmixer.',
}

export default function KameraPage() {
  return <BroadcastCamera />
}
