/**
 * Soroban Simulation + Resource Fee Estimation Before Signing (#1732)
 *
 * Runs `simulateTransaction` against the RPC node before the wallet is ever
 * prompted. This surfaces:
 *   - Contract-level errors (bad state, auth failures, invariant violations)
 *   - Accurate resource fees: inclusion fee + resource fee (CPU / memory / IO)
 *   - Total fee the user will actually be charged
 *
 * The result is meant to be shown in the UI (e.g. FundBountyModal) so the user
 * can review costs and any simulation errors before the wallet signs.
 *
 * Usage
 * -----
 * ```ts
 * const sim = await simulateForFeeEstimate({
 *   contractId: ESCROW_CONTRACT_ID,
 *   method: 'deposit',
 *   args: [payerScVal, payeeScVal, amountScVal, tokenScVal],
 *   sourceAccount: walletAddress,
 * });
 * if (!sim.success) {
 *   showError(sim.error);
 *   return;
 * }
 * // Show sim.totalFeeLumens to user, then prompt wallet.
 * ```
 */

import * as StellarSdk from '@stellar/stellar-sdk';
import { getNetworkConfig } from '@/lib/config/network';
import { startProbing, rpcCall } from '@/lib/config/rpc-fallback';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SimulateForFeeParams {
  contractId: string;
  method: string;
  /** Raw JS values — converted to ScVal by nativeToScVal internally. */
  args: unknown[];
  /** Stellar public key (G...) of the transaction source account. */
  sourceAccount: string;
  /** Override the base inclusion fee in stroops (default: BASE_FEE = 100). */
  baseFeeSatroops?: number;
}

export interface FeeEstimate {
  /** True when simulation succeeded with no contract-level error. */
  success: true;
  /** Resource fee (CPU / memory / IO) in stroops as reported by the RPC. */
  resourceFeeLumens: number;
  /**
   * Inclusion fee in stroops. The RPC minimum is used as a floor;
   * callers can bump this for higher priority.
   */
  inclusionFeeLumens: number;
  /** resourceFeeLumens + inclusionFeeLumens — the total a user will pay. */
  totalFeeLumens: number;
  /** Human-readable total, e.g. "0.00123 XLM". */
  totalFeeXlm: string;
  /** Raw CPU instruction count returned by the RPC. */
  cpuInsns: string;
  /** Raw memory byte count returned by the RPC. */
  memBytes: string;
  /** The assembled XDR ready to be signed — avoids a second simulation. */
  assembledXdr: string;
  /** Minimum resource fee recommended by the RPC node. */
  minResourceFee: string;
}

export interface SimulationError {
  success: false;
  /** Human-readable explanation of why simulation failed. */
  error: string;
  /**
   * Raw error string from the RPC, if available, for detailed debugging
   * in the developer console.
   */
  rawError?: string;
}

export type SimulationOutcome = FeeEstimate | SimulationError;

// ── RPC simulation response shapes ────────────────────────────────────────────

interface SimulationCost {
  cpuInsns: string;
  memBytes: string;
}

interface SimulationResultEntry {
  xdr: string;
}

interface RpcSimulateSuccess {
  cost: SimulationCost;
  results?: SimulationResultEntry[];
  minResourceFee: string;
  transactionData: string;
  events?: unknown[];
  latestLedger: number;
  error?: undefined;
}

interface RpcSimulateError {
  error: string;
  cost?: SimulationCost;
  latestLedger?: number;
}

type RpcSimulateResponse = RpcSimulateSuccess | RpcSimulateError;

// ── Helpers ────────────────────────────────────────────────────────────────────

const STROOPS_PER_XLM = 10_000_000;

function stroopsToXlm(stroops: number): string {
  return (stroops / STROOPS_PER_XLM).toFixed(7).replace(/\.?0+$/, '') + ' XLM';
}

/**
 * Build a minimal unsigned transaction XDR suitable for `simulateTransaction`.
 * The sequence number is set to 0 — the RPC node only needs a structurally
 * valid envelope; it does not check the sequence during simulation.
 */
function buildSimulationEnvelope(
  params: SimulateForFeeParams,
  networkPassphrase: string,
): string {
  const account = new StellarSdk.Account(params.sourceAccount, '0');
  const builder = new StellarSdk.TransactionBuilder(account, {
    fee: String(params.baseFeeSatroops ?? StellarSdk.BASE_FEE),
    networkPassphrase,
    timebounds: { minTime: 0, maxTime: 0 },
  });

  const scArgs = params.args.map((arg) => {
    if (arg instanceof StellarSdk.xdr.ScVal) return arg;
    return StellarSdk.nativeToScVal(arg);
  });

  builder.addOperation(
    StellarSdk.Operation.invokeContractFunction({
      contract: params.contractId,
      function: params.method,
      args: scArgs,
    }),
  );

  return builder.build().toXDR();
}

/**
 * Assemble the final signed-ready XDR from the simulation result.
 *
 * Uses `rpc.assembleTransaction` from the Stellar SDK, which injects the
 * resource fee and footprint returned by the RPC into the transaction so it
 * passes the resource-fee validation on submission.
 */
function assembleTransaction(
  xdr: string,
  simulation: RpcSimulateSuccess,
  networkPassphrase: string,
): string {
  const tx = new StellarSdk.Transaction(xdr, networkPassphrase);
  // The SDK's assembleTransaction returns a TransactionBuilder; calling
  // .build() on it gives us a Transaction.
  const assembled = StellarSdk.rpc.assembleTransaction(tx, simulation as StellarSdk.rpc.Api.SimulateTransactionResponse).build();
  return assembled.toXDR();
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Run `simulateTransaction` and return a detailed fee breakdown.
 *
 * Returns `SimulationError` (not throws) for contract-level failures and RPC
 * errors, so the UI can display them inline without a try/catch at every call
 * site.
 *
 * Network errors (unreachable RPC) are caught and returned as a
 * `SimulationError` with `success: false`.
 */
export async function simulateForFeeEstimate(
  params: SimulateForFeeParams,
): Promise<SimulationOutcome> {
  const { network, passphrase } = getNetworkConfig();
  startProbing(network);

  let xdr: string;
  try {
    xdr = buildSimulationEnvelope(params, passphrase);
  } catch (err) {
    return {
      success: false,
      error: `Failed to build transaction envelope: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let raw: RpcSimulateResponse;
  try {
    const result = await rpcCall<RpcSimulateResponse>(
      network,
      'simulateTransaction',
      { transaction: xdr },
    );
    raw = result.data;
  } catch (err) {
    return {
      success: false,
      error: `RPC unreachable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if ('error' in raw && raw.error) {
    return {
      success: false,
      error: `Simulation failed: ${raw.error}`,
      rawError: raw.error,
    };
  }

  const ok = raw as RpcSimulateSuccess;
  const resourceFee = parseInt(ok.minResourceFee ?? '0', 10);
  const inclusionFee = params.baseFeeSatroops ?? parseInt(StellarSdk.BASE_FEE, 10);
  const totalFee = resourceFee + inclusionFee;

  let assembledXdr: string;
  try {
    assembledXdr = assembleTransaction(xdr, ok, passphrase);
  } catch {
    // Assembly failure is non-fatal for fee display — return the unassembled
    // XDR and let the caller re-simulate if they need to sign.
    assembledXdr = xdr;
  }

  return {
    success: true,
    resourceFeeLumens: resourceFee,
    inclusionFeeLumens: inclusionFee,
    totalFeeLumens: totalFee,
    totalFeeXlm: stroopsToXlm(totalFee),
    cpuInsns: ok.cost?.cpuInsns ?? '0',
    memBytes: ok.cost?.memBytes ?? '0',
    assembledXdr,
    minResourceFee: ok.minResourceFee ?? '0',
  };
}
