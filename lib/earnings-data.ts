/**
 * Earnings data types and mock data for the freelancer earnings dashboard.
 * In production, replace mock data with DB queries against the Transaction table.
 */

export type EarningCurrency = 'XLM' | 'USDC' | 'USD';

export interface EarningTransaction {
  id: string;
  bountyId: string;
  bountyTitle: string;
  clientName: string;
  /** Amount in the native currency of the transaction */
  amount: number;
  currency: EarningCurrency;
  /** USD equivalent at time of transaction (from oracle price) */
  usdEquivalent: number;
  /** ISO date string */
  date: string;
  status: 'completed' | 'pending' | 'failed';
  txHash: string;
}

export interface EarningsSummary {
  totalThisYear: number;
  totalThisMonth: number;
  pendingEscrow: number;
  /** All in USD */
  currency: 'USD';
}

// ── Mock oracle price rates (USD per unit) ──────────────────────────────────
const RATES: Record<EarningCurrency, number> = {
  XLM: 0.11,
  USDC: 1.0,
  USD: 1.0,
};

export function toUSD(amount: number, currency: EarningCurrency): number {
  return parseFloat((amount * RATES[currency]).toFixed(2));
}

// ── Mock transactions ────────────────────────────────────────────────────────
function makeTx(
  id: string,
  bountyId: string,
  bountyTitle: string,
  clientName: string,
  amount: number,
  currency: EarningCurrency,
  daysAgo: number,
  status: EarningTransaction['status'] = 'completed',
): EarningTransaction {
  const date = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  return {
    id,
    bountyId,
    bountyTitle,
    clientName,
    amount,
    currency,
    usdEquivalent: toUSD(amount, currency),
    date,
    status,
    txHash: `tx_${id}_${Math.random().toString(36).slice(2, 10)}`,
  };
}

export const mockTransactions: EarningTransaction[] = [
  makeTx('e1', 'bounty-1', 'Brand Identity Design for Web3 Startup', 'Nexus Labs', 3000, 'USDC', 5),
  makeTx('e2', 'bounty-2', 'Technical Documentation for API', 'DevCorp', 1500, 'USDC', 18),
  makeTx('e3', 'bounty-3', 'Social Media Campaign Content', 'GrowthHQ', 25000, 'XLM', 32),
  makeTx('e4', 'bounty-4', 'UX Research & Usability Testing', 'Fintech Inc', 4000, 'USDC', 45),
  makeTx('e5', 'bounty-5', 'Smart Contract Audit', 'DeFi Protocol', 18000, 'XLM', 62),
  makeTx('e6', 'bounty-6', 'Mobile App Redesign', 'StartupX', 2200, 'USDC', 75),
  makeTx('e7', 'bounty-7', 'Logo & Brand Guidelines', 'CreativeDAO', 800, 'USDC', 95),
  makeTx('e8', 'bounty-8', 'Backend API Integration', 'ScaleUp', 3500, 'USDC', 110),
  makeTx('e9', 'bounty-9', 'Content Strategy Q3', 'MediaGroup', 12000, 'XLM', 140),
  makeTx('e10', 'bounty-10', 'Whitepaper Writing', 'ChainVentures', 2000, 'USDC', 200),
  makeTx('e11', 'bounty-11', 'NFT Collection Design', 'ArtDAO', 5000, 'USDC', 250),
  makeTx('e12', 'bounty-12', 'Tokenomics Consulting', 'Web3Fund', 8000, 'USDC', 300),
  // pending
  makeTx('e13', 'bounty-13', 'Dashboard UI Component Library', 'TechStudio', 2800, 'USDC', 1, 'pending'),
  makeTx('e14', 'bounty-14', 'Video Explainer Production', 'LaunchCo', 15000, 'XLM', 3, 'pending'),
];

export function computeSummary(txs: EarningTransaction[]): EarningsSummary {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1).getTime();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  let totalThisYear = 0;
  let totalThisMonth = 0;
  let pendingEscrow = 0;

  for (const tx of txs) {
    const t = new Date(tx.date).getTime();
    if (tx.status === 'pending') {
      pendingEscrow += tx.usdEquivalent;
    } else if (tx.status === 'completed') {
      if (t >= startOfYear) totalThisYear += tx.usdEquivalent;
      if (t >= startOfMonth) totalThisMonth += tx.usdEquivalent;
    }
  }

  return {
    totalThisYear: parseFloat(totalThisYear.toFixed(2)),
    totalThisMonth: parseFloat(totalThisMonth.toFixed(2)),
    pendingEscrow: parseFloat(pendingEscrow.toFixed(2)),
    currency: 'USD',
  };
}
