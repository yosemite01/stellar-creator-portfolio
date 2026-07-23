'use client'

import { SocialShare } from '@/components/common/social-share'

export function BountyShareButton({
  title,
  budget,
  currency,
  bountyId,
}: {
  title: string
  budget: number
  currency: string
  bountyId: string
}) {
  return (
    <SocialShare
      title={`${title} — ${currency} ${budget.toLocaleString()} bounty on Stellar Creators`}
      description={`Check out this bounty: ${title}`}
      url={`/bounties/${bountyId}`}
      hashtags={['StellarBounty', 'Web3', 'Stellar']}
    />
  )
}
