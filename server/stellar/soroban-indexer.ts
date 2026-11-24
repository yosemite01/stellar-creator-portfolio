/**
 * Soroban Indexer — unified thin adapter (#1734).
 *
 * Previously there were at least three independent event-indexing
 * implementations:
 *   1. This file (TS contract simulation / RPC pre-flight helper).
 *   2. backend/services/indexer/src/main.rs — the authoritative Rust indexer
 *      that polls `getEvents`, persists cursors in PostgreSQL, and handles
 *      webhook verification.
 *   3. event_indexer.rs inside the Rust API service.
 *
 * Fix: this module is now a thin TypeScript adapter over the Rust indexer
 * configuration.  Simulation pre-flight (the original purpose) is kept here
 * because it is a client-side convenience and not a duplicate of the Rust
 * indexer's cursor-based polling.  Any new TS code that wants indexed event
 * data should read from the database rows the Rust service writes — not
 * re-implement the polling loop in TypeScript.
 *
 * The Rust indexer is the single source of truth for on-chain events:
 *   backend/services/indexer/src/main.rs
 *
 * Environment variables consumed by both the Rust service and this adapter
 * are documented there.  This file re-exports only the values needed by
 * Next.js route handlers so they never reach directly into env themselves.
 */

import * as StellarSdk from '@stellar/stellar-sdk';
import { getNetworkConfig } from '@/lib/config/network';
import { rpcCall, startProbing } from '@/lib/config/rpc-fallback';

// ── Indexer configuration (mirrors backend/services/indexer/src/main.rs) ─────

/**
 * Returns the RPC URL the Rust indexer is configured to poll.
 * Next.js handlers that need a Soroban RPC endpoint should call this rather
 * than reading `STELLAR_RPC_URL` directly — it keeps the env key in one place.
 */
export function indexerRpcUrl(): string {
  return (
    process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org'
  );
}

/**
 * Contract IDs the Rust indexer watches.  Used by handlers that want to know
 * which contracts are considered "platform contracts" without importing the
 * full deployment manifest.
 */
export interface IndexerContracts {
  bounty: string;
  freelancer: string;
  escrow: string;
}

export function indexerContracts(): IndexerContracts {
  return {
    bounty: process.env.BOUNTY_CONTRACT_ID ?? '',
    freelancer: process.env.FREELANCER_CONTRACT_ID ?? '',
    escrow: process.env.ESCROW_CONTRACT_ID ?? '',
  };
}

// ── Simulation pre-flight (retained — not duplicated by the Rust indexer) ────

export interface SimulateParams {
  contractId: string;
  method: string;
  args: unknown[];
  sourceAccount: string;
}

export interface SimulationResult {
  success: boolean;
  gasEstimate?: number;
  error?: string;
  rawResult?: unknown;
}

/**
 * Simulate a Soroban contract invocation against the configured RPC endpoint.
 * Returns gas estimate on success or a structured error before wallet prompt.
 *
 * This is the only TS logic that remains in this file; it is a client-side
 * convenience that calls the same RPC endpoint the Rust indexer reads from,
 * but it does not duplicate the indexer's cursor-based event polling.
 */
export async function simulateContractCall(
  params: SimulateParams
): Promise<SimulationResult> {
  const { network } = getNetworkConfig();
  startProbing(network);

  let result: { result?: { cost?: { cpuInsns?: string }; error?: string } };
  try {
    const rpcResult = await rpcCall<{ cost?: { cpuInsns?: string }; error?: string }>(
      network,
      'simulateTransaction',
      { transaction: buildTransactionEnvelope(params) },
    );
    result = { result: rpcResult.data };
  } catch (err) {
    return {
      success: false,
      error: `RPC connection failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const res = result.result;
  if (!res) return { success: false, error: 'Empty simulation result' };
  if (res.error) return { success: false, error: res.error };

  const gasEstimate = res.cost?.cpuInsns
    ? parseInt(res.cost.cpuInsns, 10)
    : undefined;

  return { success: true, gasEstimate, rawResult: res };
}

/**
 * Minimal transaction envelope builder using Stellar SDK XDR encoding.
 * Constructs a valid Soroban transaction for RPC simulation without signing.
 *
 * @throws if the sourceAccount cannot be parsed as a valid Stellar address
 */
function buildTransactionEnvelope(params: SimulateParams): string {
  const { network: networkName } = getNetworkConfig();
  const network = networkName === 'mainnet'
    ? StellarSdk.Networks.PUBLIC
    : StellarSdk.Networks.TESTNET;

  const sourceAccount = new StellarSdk.Account(params.sourceAccount, '0');
  const txBuilder = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: network,
    timebounds: { minTime: 0, maxTime: 0 },
  });

  const scArgs = params.args.map((arg) => {
    if (typeof arg === 'string') return StellarSdk.nativeToScVal(arg);
    if (typeof arg === 'number') return StellarSdk.nativeToScVal(arg);
    if (typeof arg === 'boolean') return StellarSdk.nativeToScVal(arg);
    return StellarSdk.nativeToScVal(String(arg));
  });

  txBuilder.addOperation(
    StellarSdk.Operation.invokeContractFunction({
      contract: params.contractId,
      function: params.method,
      args: scArgs,
    }),
  );

  return txBuilder.build().toXDR();
}
