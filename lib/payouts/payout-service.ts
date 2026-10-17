import { FeeBreakdown, PayoutRecord, PayoutReceipt, PayoutType, PayoutCurrency, PayoutStatus } from './types';
import { generateReceiptPdf } from './pdf-receipt';

const DEFAULT_PLATFORM_FEE_RATE = 0.10; // 10% platform fee

export function computeFeeBreakdown(
  grossAmount: number,
  currency: PayoutCurrency = 'USDC',
  feeRate: number = DEFAULT_PLATFORM_FEE_RATE
): FeeBreakdown {
  const platformFeeAmount = parseFloat((grossAmount * feeRate).toFixed(2));
  const netPayoutAmount = parseFloat((grossAmount - platformFeeAmount).toFixed(2));
  return {
    grossAmount,
    platformFeeRate: feeRate,
    platformFeeAmount,
    netPayoutAmount,
    currency,
  };
}

function getStellarExplorerUrl(txHash?: string, network: string = 'testnet'): string | undefined {
  if (!txHash) return undefined;
  return `https://stellar.expert/explorer/${network}/tx/${txHash}`;
}

// Global in-memory payouts registry
interface PayoutStore {
  payouts: Map<string, PayoutRecord>;
}

function getStore(): PayoutStore {
  const g = globalThis as unknown as { __payoutStore?: PayoutStore };
  if (!g.__payoutStore) {
    g.__payoutStore = { payouts: new Map() };
    seedDefaultPayouts(g.__payoutStore);
  }
  return g.__payoutStore;
}

function seedDefaultPayouts(store: PayoutStore) {
  const defaultItems: Omit<PayoutRecord, 'feeBreakdown' | 'stellarExplorerUrl'>[] = [
    {
      id: 'po-101',
      freelancerUserId: 'creator-1',
      freelancerName: 'Alex Rivera',
      clientUserId: 'client-1',
      clientName: 'Nexus Labs',
      bountyId: 'bounty-1',
      bountyTitle: 'Brand Identity Design for Web3 Startup',
      grossAmount: 3000,
      currency: 'USDC',
      type: 'on-chain',
      status: 'completed',
      stellarTxHash: 'e637841c7b8c8d5a2d0efb82cf7d12a938c8230b0e352ef164c4c51480f7457a',
      createdAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
      completedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    },
    {
      id: 'po-102',
      freelancerUserId: 'creator-1',
      freelancerName: 'Alex Rivera',
      clientUserId: 'client-2',
      clientName: 'DevCorp',
      bountyId: 'bounty-2',
      bountyTitle: 'Technical Documentation for API',
      grossAmount: 1500,
      currency: 'USD',
      type: 'fiat',
      status: 'completed',
      fiatPaymentRef: 'pi_3NzDevCorp99281',
      createdAt: new Date(Date.now() - 18 * 86_400_000).toISOString(),
      completedAt: new Date(Date.now() - 18 * 86_400_000).toISOString(),
    },
    {
      id: 'po-103',
      freelancerUserId: 'creator-1',
      freelancerName: 'Alex Rivera',
      clientUserId: 'client-3',
      clientName: 'GrowthHQ',
      bountyId: 'bounty-3',
      bountyTitle: 'Social Media Campaign Content',
      grossAmount: 25000,
      currency: 'XLM',
      type: 'on-chain',
      status: 'completed',
      stellarTxHash: 'b4a8e8f81395b058ad57b545d1d6a6c6a4618e95e4e84b8402dbca7bb577a331',
      createdAt: new Date(Date.now() - 32 * 86_400_000).toISOString(),
      completedAt: new Date(Date.now() - 32 * 86_400_000).toISOString(),
    },
  ];

  for (const item of defaultItems) {
    const feeBreakdown = computeFeeBreakdown(item.grossAmount, item.currency);
    const stellarExplorerUrl = getStellarExplorerUrl(item.stellarTxHash);
    store.payouts.set(item.id, {
      ...item,
      feeBreakdown,
      stellarExplorerUrl,
    });
  }
}

export function listPayoutsForFreelancer(
  freelancerUserId: string,
  filter?: { type?: PayoutType; status?: PayoutStatus; limit?: number }
): PayoutRecord[] {
  const store = getStore();
  let list = Array.from(store.payouts.values()).filter(
    (p) => p.freelancerUserId === freelancerUserId
  );

  if (filter?.type) {
    list = list.filter((p) => p.type === filter.type);
  }
  if (filter?.status) {
    list = list.filter((p) => p.status === filter.status);
  }

  list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (filter?.limit && filter.limit > 0) {
    list = list.slice(0, filter.limit);
  }

  return list;
}

export function getPayoutById(payoutId: string): PayoutRecord | undefined {
  return getStore().payouts.get(payoutId);
}

export function createPayoutRecord(params: {
  freelancerUserId: string;
  freelancerName: string;
  clientUserId: string;
  clientName: string;
  bountyId: string;
  bountyTitle: string;
  grossAmount: number;
  currency?: PayoutCurrency;
  feeRate?: number;
  type?: PayoutType;
  status?: PayoutStatus;
  stellarTxHash?: string;
  fiatPaymentRef?: string;
}): PayoutRecord {
  const id = `po-${crypto.randomUUID().slice(0, 8)}`;
  const currency = params.currency || 'USDC';
  const feeBreakdown = computeFeeBreakdown(params.grossAmount, currency, params.feeRate);
  const stellarExplorerUrl = getStellarExplorerUrl(params.stellarTxHash);

  const record: PayoutRecord = {
    id,
    freelancerUserId: params.freelancerUserId,
    freelancerName: params.freelancerName,
    clientUserId: params.clientUserId,
    clientName: params.clientName,
    bountyId: params.bountyId,
    bountyTitle: params.bountyTitle,
    grossAmount: params.grossAmount,
    currency,
    feeBreakdown,
    type: params.type || 'on-chain',
    status: params.status || 'completed',
    stellarTxHash: params.stellarTxHash,
    stellarExplorerUrl,
    fiatPaymentRef: params.fiatPaymentRef,
    createdAt: new Date().toISOString(),
    completedAt: params.status === 'completed' ? new Date().toISOString() : undefined,
  };

  getStore().payouts.set(id, record);
  return record;
}

export function generateReceiptFromPayout(payout: PayoutRecord): PayoutReceipt {
  return {
    receiptNumber: `RCP-${payout.id.toUpperCase()}`,
    payoutId: payout.id,
    issuedAt: new Date().toISOString(),
    freelancer: {
      userId: payout.freelancerUserId,
      name: payout.freelancerName,
    },
    client: {
      userId: payout.clientUserId,
      name: payout.clientName,
    },
    bounty: {
      id: payout.bountyId,
      title: payout.bountyTitle,
    },
    payoutType: payout.type,
    currency: payout.currency,
    feeBreakdown: payout.feeBreakdown,
    stellarTxHash: payout.stellarTxHash,
    stellarExplorerUrl: payout.stellarExplorerUrl,
    status: payout.status,
    notes: 'Official proof of earnings for income and tax reporting. Verified on Tamgora platform.',
  };
}

export { generateReceiptPdf };
