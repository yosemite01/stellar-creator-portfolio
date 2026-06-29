/**
 * Soroban Transaction Queue
 * Manages transaction submission with automatic retry and exponential backoff.
 *
 * Issue #880 improvements:
 * - Multi-endpoint RPC fallback via lib/config/rpc-fallback
 * - True exponential backoff with configurable jitter
 * - Per-attempt RPC health logging (endpoint, latency, error)
 * - Graceful failover when a specific endpoint returns transient errors
 */

import { prisma } from "@/lib/prisma";
import { getSequenceManager } from "./sequence-manager";
import { rpcCall, getPoolHealth, startProbing, type RpcCallResult } from "@/lib/config/rpc-fallback";
import type { NetworkName } from "@/lib/config/network";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueuedTransaction {
  id: string;
  accountId: string;
  contractId: string;
  method: string;
  args: any[];
  status: "pending" | "submitted" | "confirmed" | "failed";
  sequence?: bigint;
  txHash?: string;
  error?: string;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  submittedAt?: Date;
  confirmedAt?: Date;
}

export interface SubmissionResult {
  success: boolean;
  txHash?: string;
  sequence?: bigint;
  error?: string;
  attempts: number;
  /** Which RPC endpoint ultimately served the request. */
  endpoint?: string;
}

// ---------------------------------------------------------------------------
// RPC health logging
// ---------------------------------------------------------------------------

export interface RpcAttemptLog {
  txId: string;
  attempt: number;
  endpoint: string;
  latencyMs: number;
  success: boolean;
  error?: string;
}

/** In-memory ring buffer of the last 200 RPC attempt logs for the dashboard. */
const RPC_LOG_BUFFER_SIZE = 200;
const rpcAttemptLog: RpcAttemptLog[] = [];

function logRpcAttempt(entry: RpcAttemptLog): void {
  rpcAttemptLog.push(entry);
  if (rpcAttemptLog.length > RPC_LOG_BUFFER_SIZE) rpcAttemptLog.shift();
}

/** Returns a snapshot of recent RPC attempt logs (newest last). */
export function getRpcAttemptLog(): Readonly<RpcAttemptLog[]> {
  return rpcAttemptLog;
}

// ---------------------------------------------------------------------------
// Exponential backoff helper
// ---------------------------------------------------------------------------

/**
 * Compute exponential backoff delay with optional jitter.
 * @param attempt  1-based attempt number (1 = first retry)
 * @param base     base delay in ms (default 200)
 * @param cap      maximum delay in ms (default 30_000)
 * @param jitter   add up to ±25% random jitter when true (default true)
 */
export function backoffMs(
  attempt: number,
  base = 200,
  cap = 30_000,
  jitter = true,
): number {
  const exp = Math.min(cap, base * 2 ** (attempt - 1));
  if (!jitter) return exp;
  const delta = exp * 0.25;
  return Math.round(exp - delta + Math.random() * delta * 2);
}

// ---------------------------------------------------------------------------
// TransactionQueue
// ---------------------------------------------------------------------------

export class TransactionQueue {
  private accountId: string;
  private network: NetworkName;
  private queue: QueuedTransaction[] = [];
  private isProcessing = false;

  constructor(accountId: string, network: NetworkName = "mainnet") {
    this.accountId = accountId;
    this.network = network;
    // Start background health probing for this network
    startProbing(network);
  }

  async enqueue(
    contractId: string,
    method: string,
    args: any[],
    maxAttempts = 5,
  ): Promise<string> {
    const transaction: QueuedTransaction = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      accountId: this.accountId,
      contractId,
      method,
      args,
      status: "pending",
      attempts: 0,
      maxAttempts,
      createdAt: new Date(),
    };

    this.queue.push(transaction);
    if (!this.isProcessing) this.processQueue();
    return transaction.id;
  }

  async getStatus(txId: string): Promise<QueuedTransaction | null> {
    return this.queue.find((tx) => tx.id === txId) ?? null;
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (this.queue.length > 0) {
        const transaction = this.queue[0]!;

        const result = await this.submitWithRetry(transaction);

        if (result.success) {
          this.queue.shift();
          transaction.status = "confirmed";
          transaction.txHash = result.txHash;
          transaction.confirmedAt = new Date();
        } else {
          // Exhausted in submitWithRetry — mark failed and remove
          this.queue.shift();
          transaction.status = "failed";
          transaction.error = result.error;
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Attempt submission with exponential backoff across all configured RPC
   * endpoints. Logs each attempt for the health dashboard.
   */
  private async submitWithRetry(
    transaction: QueuedTransaction,
  ): Promise<SubmissionResult> {
    for (let attempt = 1; attempt <= transaction.maxAttempts; attempt++) {
      transaction.attempts = attempt;

      const t0 = Date.now();
      try {
        const sequenceManager = getSequenceManager(this.accountId);
        const sequence = await sequenceManager.getNextSequence();
        transaction.sequence = sequence;

        const rpcResult = await this.submitToSorobanRpc(transaction, sequence);

        logRpcAttempt({
          txId: transaction.id,
          attempt,
          endpoint: rpcResult.endpoint,
          latencyMs: Date.now() - t0,
          success: true,
        });

        transaction.status = "submitted";
        transaction.submittedAt = new Date();
        transaction.txHash = rpcResult.txHash;

        return {
          success: true,
          txHash: rpcResult.txHash,
          sequence,
          attempts: attempt,
          endpoint: rpcResult.endpoint,
        };
      } catch (err) {
        const errorMsg = (err as Error).message;

        logRpcAttempt({
          txId: transaction.id,
          attempt,
          endpoint: "unknown",
          latencyMs: Date.now() - t0,
          success: false,
          error: errorMsg,
        });

        transaction.error = errorMsg;

        if (attempt < transaction.maxAttempts) {
          const delay = backoffMs(attempt);
          await this.sleep(delay);
        }
      }
    }

    return { success: false, error: transaction.error, attempts: transaction.maxAttempts };
  }

  /**
   * Submit via the multi-endpoint RPC pool. The pool handles endpoint
   * rotation internally; we just call rpcCall and let it failover.
   */
  private async submitToSorobanRpc(
    transaction: QueuedTransaction,
    sequence: bigint,
  ): Promise<{ txHash: string; endpoint: string }> {
    const result = await rpcCall<{ hash: string }>(
      this.network,
      "sendTransaction",
      [{
        contractId: transaction.contractId,
        method: transaction.method,
        args: transaction.args,
        sequence: sequence.toString(),
      }],
    );

    return {
      txHash: result.data?.hash ?? `tx_${transaction.id}_${sequence}`,
      endpoint: result.endpoint,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getQueueSize(): number { return this.queue.length; }

  getQueueStatus() {
    return {
      size: this.queue.length,
      pending:   this.queue.filter((tx) => tx.status === "pending").length,
      submitted: this.queue.filter((tx) => tx.status === "submitted").length,
      confirmed: this.queue.filter((tx) => tx.status === "confirmed").length,
      failed:    this.queue.filter((tx) => tx.status === "failed").length,
    };
  }

  /** Snapshot of RPC endpoint health for the dashboard. */
  getRpcHealth() {
    return getPoolHealth(this.network);
  }
}

// ---------------------------------------------------------------------------
// Global registry
// ---------------------------------------------------------------------------

const queues = new Map<string, TransactionQueue>();

export function getTransactionQueue(
  accountId: string,
  network: NetworkName = "mainnet",
): TransactionQueue {
  if (!queues.has(accountId)) {
    queues.set(accountId, new TransactionQueue(accountId, network));
  }
  return queues.get(accountId)!;
}

export function clearTransactionQueues(): void {
  queues.clear();
}
