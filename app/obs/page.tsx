import type { Metadata } from 'next'
import { ObsOutput } from '@/components/obs-output'

export const metadata: Metadata = {
  title: 'OBS-utgång',
  robots: { index: false, follow: false },
}

export default async function ObsPage({
  searchParams,
}: {
  searchParams: Promise<{ slot?: string; status?: string }>
}) {
  const { slot, status } = await searchParams
  return <ObsOutput slot={slot === '3' ? 3 : 2} showStatus={status !== '0'} />
}
