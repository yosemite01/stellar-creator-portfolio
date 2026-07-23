import * as DocumentPicker from 'expo-document-picker';
import * as Network from 'expo-network';
import type { PeerTransferSession, PeerTransferProgress } from '../types';

const CHUNK_SIZE = 256_000;
const BASE_FEE = 100; // stroops (0.00001 XLM)
const BASE_RESERVE = 2_000_000; // stroops per account

export interface XLMTransferParams {
  amount: number; // in XLM units
  recipientAddress: string;
  token: 'XLM' | 'USDC' | 'EURC';
}

export interface FeeEstimate {
  baseFee: number;
  totalFee: number;
  totalCostInXLM: number;
}

export interface TransferResult {
  success: boolean;
  hash?: string;
  error?: string;
}

export async function getCurrentNetworkLabelAsync(): Promise<string> {
  try {
    const state = await Network.getNetworkStateAsync();
    if (!state.isConnected) {
      return 'Offline';
    }
    return state.type === 'wifi' ? 'Wi-Fi network' : 'Cellular network';
  } catch {
    return 'Unknown network';
  }
}

export async function selectPeerFileAsync(): Promise<PeerTransferSession | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*' });
  if (result.type !== 'success') {
    return null;
  }

  const size = typeof result.size === 'number' ? result.size : 0;
  const totalChunks = Math.max(1, Math.ceil(size / CHUNK_SIZE));

  return {
    id: `${Date.now()}-${result.name}`,
    fileName: result.name,
    uri: result.uri,
    mimeType: result.mimeType ?? 'application/octet-stream',
    size,
    totalChunks,
    transferredChunks: 0,
    progress: 0,
    state: 'ready',
    connectedDevice: 'Nearby device',
    startedAt: Date.now(),
  };
}

export async function simulatePeerTransferAsync(
  session: PeerTransferSession,
  onProgress: (progress: PeerTransferProgress) => void,
): Promise<PeerTransferSession> {
  const chunkCount = session.totalChunks;
  let currentSession = { ...session, state: 'transferring', transferredChunks: 0, progress: 0 };

  for (let index = 1; index <= chunkCount; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 260));
    currentSession = {
      ...currentSession,
      transferredChunks: index,
      progress: Math.round((index / chunkCount) * 100),
    };
    onProgress({
      transferredChunks: currentSession.transferredChunks,
      totalChunks: chunkCount,
      progress: currentSession.progress,
      currentChunkSize: Math.min(CHUNK_SIZE, session.size - (index - 1) * CHUNK_SIZE),
    });
  }

  return { ...currentSession, state: 'completed' };
}

export async function estimateFee(params: XLMTransferParams): Promise<FeeEstimate> {
  // Estimate fee based on network, token, and amount
  const baseFee = BASE_FEE;
  const operationFee = baseFee * 1; // Single payment operation
  const totalFee = operationFee;
  const totalCostInXLM = params.amount + (totalFee / 10_000_000); // Convert stroops to XLM

  return {
    baseFee,
    totalFee,
    totalCostInXLM,
  };
}

export async function submitTransfer(
  params: XLMTransferParams,
  sourceKeypair: { publicKey: string; secretKey: string },
): Promise<TransferResult> {
  // In a real implementation, this would:
  // 1. Create a Stellar transaction builder
  // 2. Add payment operation
  // 3. Sign with sourceKeypair
  // 4. Submit to network
  // For now, simulate successful submission

  try {
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const mockHash = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    return {
      success: true,
      hash: mockHash,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Transfer failed',
    };
  }
}

export async function lookupUserByAddress(address: string): Promise<{ name?: string; id?: string } | null> {
  // Lookup if recipient is a platform user
  try {
    const response = await fetch(`https://api.stellar.app/api/users/lookup?address=${encodeURIComponent(address)}`);
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}
