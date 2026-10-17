export interface DisputeEvidenceItem {
  id: string;
  disputeId: string;
  uploadedById: string;
  fileUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
  mimeType: string | null;
  message: string | null;
  messageId: string | null;
  createdAt: string;
  uploadedBy?: {
    id: string;
    name: string | null;
    email: string | null;
    role: string;
  };
}

export interface Dispute {
  id: string;
  escrowId: string;
  creatorId: string;
  clientId: string;
  status: string;
  reason: string | null;
  deadline?: string | null;
  evidence?: DisputeEvidenceItem[];
  createdAt: string;
  updatedAt: string;
}

export type StatusFilter = 'open' | 'resolved' | 'all';

export type Resolution = 'release_to_freelancer' | 'refund_to_creator' | 'split_50_50';

export const RESOLUTION_LABELS: Record<Resolution, string> = {
  release_to_freelancer: 'Release to Freelancer',
  refund_to_creator: 'Refund to Creator',
  split_50_50: 'Split 50/50',
};

export function ageLabel(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days > 0) return `${days}d ago`;
  const hrs = Math.floor(ms / 3_600_000);
  if (hrs > 0) return `${hrs}h ago`;
  return 'just now';
}
