'use client'

import { SocialShare } from '@/components/common/social-share'

/**
 * Props for the BountyShareButton component.
 */
export interface BountyShareButtonProps {
  /** The title of the bounty being shared. */
  title: string
  /** The allocated reward budget amount for the bounty. */
  budget: number
  /** The currency or token symbol for the bounty reward (e.g., 'XLM', 'USDC'). */
  currency: string
  /** The unique identifier of the bounty used to construct the relative URL. */
  bountyId: string
}

/**
 * Client-side interactive social sharing button component for bounties.
 *
 * Formats a standardized title with currency and reward budget, constructs
 * the canonical bounty URL, and attaches Web3/Stellar hashtags for social distribution.
 *
 * @param props - The configuration properties including title, budget, currency, and bountyId.
 * @returns A rendered SocialShare component configured for the bounty.
 */
export function BountyShareButton({
  title,
  budget,
  currency,
  bountyId,
}: BountyShareButtonProps) {
  return (
    <SocialShare
      title={`${title} — ${currency} ${budget.toLocaleString()} bounty on Tamgora`}
      description={`Check out this bounty: ${title}`}
      url={`/bounties/${bountyId}`}
      hashtags={['TamgoraBounty', 'Web3', 'Stellar']}
    />
  )
}
