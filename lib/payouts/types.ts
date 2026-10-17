export type PayoutCurrency = 'USD' | 'USDC' | 'XLM';
export type PayoutType = 'fiat' | 'on-chain';
export type PayoutStatus = 'completed' | 'pending' | 'processing' | 'failed';

export interface FeeBreakdown {
  grossAmount: number;
  platformFeeRate: number; // e.g. 0.10 for 10%
  platformFeeAmount: number;
  netPayoutAmount: number;
  currency: PayoutCurrency;
}

export interface PayoutRecord {
  id: string;
  freelancerUserId: string;
  freelancerName: string;
  clientUserId: string;
  clientName: string;
  bountyId: string;
  bountyTitle: string;
  grossAmount: number;
  currency: PayoutCurrency;
  feeBreakdown: FeeBreakdown;
  type: PayoutType;
  status: PayoutStatus;
  stellarTxHash?: string;
  stellarExplorerUrl?: string;
  fiatPaymentRef?: string;
  createdAt: string;
  completedAt?: string;
}

export interface PayoutReceipt {
  receiptNumber: string;
  payoutId: string;
  issuedAt: string;
  freelancer: {
    userId: string;
    name: string;
    stellarAddress?: string;
  };
  client: {
    userId: string;
    name: string;
  };
  bounty: {
    id: string;
    title: string;
  };
  payoutType: PayoutType;
  currency: PayoutCurrency;
  feeBreakdown: FeeBreakdown;
  stellarTxHash?: string;
  stellarExplorerUrl?: string;
  status: PayoutStatus;
  notes: string;
}
