/**
 * Soroban Indexer Service — Contract Simulation Pre-flight (#518)
 *
 * Provides RPC simulation endpoints that validate transactions before
 * wallet confirmation, parsing gas estimates and surfacing failures early.
 */

import { getNetworkConfig } from "@/lib/config/network";

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
 */
export async function simulateContractCall(
  params: SimulateParams
): Promise<SimulationResult> {
  const { rpcUrl } = getNetworkConfig();

  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "simulateTransaction",
    params: {
      transaction: buildTransactionEnvelope(params),
    },
  };

  let response: Response;
  try {
    response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      success: false,
      error: `RPC connection failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!response.ok) {
    return {
      success: false,
      error: `RPC HTTP error ${response.status}: ${response.statusText}`,
    };
  }

  const json = (await response.json()) as {
    result?: { cost?: { cpuInsns?: string }; error?: string };
    error?: { message?: string };
  };

  if (json.error) {
    return { success: false, error: json.error.message ?? "Unknown RPC error" };
  }

  const result = json.result;
  if (!result) {
    return { success: false, error: "Empty simulation result" };
  }

  if (result.error) {
    return { success: false, error: result.error };
  }

  const gasEstimate = result.cost?.cpuInsns
    ? parseInt(result.cost.cpuInsns, 10)
    : undefined;

  return { success: true, gasEstimate, rawResult: result };
}

/**
 * Minimal XDR-like envelope builder (placeholder for actual Stellar SDK usage).
 * In production, replace with StellarSdk.TransactionBuilder output.
 */
function buildTransactionEnvelope(params: SimulateParams): string {
  // Encode params as base64 JSON stub; real impl uses stellar-sdk XDR encoding.
  const payload = {
    contractId: params.contractId,
    method: params.method,
    args: params.args,
    source: params.sourceAccount,
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}
