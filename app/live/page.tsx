import type { Metadata } from 'next'
import { LiveViewer } from '@/components/live-viewer'

export const metadata: Metadata = {
  title: 'Livesändning – Gudstjänst',
  description: 'Se gudstjänsten live från kyrkans kameror.',
}

export default async function LivePage({
  searchParams,
}: {
  searchParams: Promise<{ slot?: string }>
}) {
  const { slot } = await searchParams
  return <LiveViewer initialSlot={slot === '3' ? 3 : 2} />
}
