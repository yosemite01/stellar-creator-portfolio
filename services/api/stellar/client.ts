/**
 * Stellar RPC Client — singleton with circuit breaker protection.
 *
 * Every call that hits the Stellar RPC node is routed through
 * `stellarCircuitBreaker.execute()` from
 * `backend/services/stellar-circuit-breaker.ts`.
 *
 * Circuit breaker configuration (matches Rust `CircuitBreakerConfig::for_rpc()`):
 *   - failure_threshold : 5 consecutive failures → OPEN
 *   - recovery_timeout  : 30 s, then HALF-OPEN probe
 *
 * When the circuit is OPEN:
 *   - `CircuitOpenError` is thrown immediately (no network call)
 *   - Callers / tRPC routers should catch it and return HTTP 503 with
 *     `Retry-After: 30`
 */

import { rpc, Networks } from '@stellar/stellar-sdk';
import { getSecret } from '@/backend/services/kms';
import {
  stellarCircuitBreaker,
  CircuitOpenError,
  type CircuitState,
} from '@/backend/services/stellar-circuit-breaker';
import type { StellarConfig } from './types';

// Re-export so callers that need to catch it don't need a second import path
export { CircuitOpenError };

// ── Defaults ───────────────────────────────────────────────────────────────

const defaultRpcUrl =
  process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org';
const defaultNetworkPassphrase =
  process.env.STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET;
const defaultContractId = process.env.CONTRACT_ID ?? '';

// ── Protected RPC Server ────────────────────────────────────────────────────

/**
 * Wraps `rpc.Server` so every method call is guarded by the circuit breaker.
 *
 * Only the methods actually used by ContractService / ImprovedContractService
 * are proxied here. Add more as the surface area grows.
 */
class ProtectedRpcServer {
  private readonly server: rpc.Server;

  constructor(rpcUrl: string) {
    this.server = new rpc.Server(rpcUrl);
  }

  /** Fetch account details — fails fast when circuit is OPEN. */
  getAccount(publicKey: string): Promise<rpc.Api.AccountResponse> {
    return stellarCircuitBreaker.execute(() =>
      this.server.getAccount(publicKey),
    );
  }

  /** Simulate a transaction — fails fast when circuit is OPEN. */
  simulateTransaction(
    tx: Parameters<rpc.Server['simulateTransaction']>[0],
  ): ReturnType<rpc.Server['simulateTransaction']> {
    return stellarCircuitBreaker.execute(() =>
      this.server.simulateTransaction(tx),
    ) as ReturnType<rpc.Server['simulateTransaction']>;
  }

  /** Submit a signed transaction — fails fast when circuit is OPEN. */
  sendTransaction(
    tx: Parameters<rpc.Server['sendTransaction']>[0],
  ): ReturnType<rpc.Server['sendTransaction']> {
    return stellarCircuitBreaker.execute(() =>
      this.server.sendTransaction(tx),
    ) as ReturnType<rpc.Server['sendTransaction']>;
  }

  /** Poll for transaction status — fails fast when circuit is OPEN. */
  getTransaction(
    hash: string,
  ): ReturnType<rpc.Server['getTransaction']> {
    return stellarCircuitBreaker.execute(() =>
      this.server.getTransaction(hash),
    ) as ReturnType<rpc.Server['getTransaction']>;
  }

  /** Read persistent contract storage — fails fast when circuit is OPEN. */
  getContractData(
    ...args: Parameters<rpc.Server['getContractData']>
  ): ReturnType<rpc.Server['getContractData']> {
    return stellarCircuitBreaker.execute(() =>
      this.server.getContractData(...args),
    ) as ReturnType<rpc.Server['getContractData']>;
  }

  /**
   * Expose the raw server for one-off calls not yet proxied above.
   * Prefer adding an explicit proxy method rather than using this directly.
   *
   * @internal
   */
  get _raw(): rpc.Server {
    return this.server;
  }
}

// ── StellarClient ──────────────────────────────────────────────────────────

export class StellarClient {
  private static instance: StellarClient;

  /** Circuit-breaker-protected RPC surface. */
  public readonly rpc: ProtectedRpcServer;
  public readonly config: StellarConfig;

  private constructor(config: StellarConfig) {
    this.config = config;
    this.rpc = new ProtectedRpcServer(config.rpcUrl);
  }

  /**
   * Async factory — resolves the admin secret via KMS before constructing
   * the singleton so the secret value is never stored in plain env vars.
   */
  public static async getInstance(
    config?: Partial<Omit<StellarConfig, 'adminSecret'>>,
  ): Promise<StellarClient> {
    if (StellarClient.instance) return StellarClient.instance;

    const adminSecret = await getSecret('STELLAR_ADMIN_SECRET');

    StellarClient.instance = new StellarClient({
      rpcUrl: config?.rpcUrl ?? defaultRpcUrl,
      networkPassphrase:
        config?.networkPassphrase ?? defaultNetworkPassphrase,
      contractId: config?.contractId ?? defaultContractId,
      adminSecret,
    });

    return StellarClient.instance;
  }

  /** Current circuit state — useful for health-check endpoints. */
  public get circuitState(): CircuitState {
    return stellarCircuitBreaker.getState();
  }
}

// ── Module-level singleton ─────────────────────────────────────────────────
//
// Used by ContractService and ImprovedContractService.
// The instance is initialised lazily on first `getInstance()` call; the
// module-level export provides a synchronous handle for code that imports
// the module after initialisation has already completed (common in Next.js).

let _stellarClient: StellarClient | undefined;

/**
 * Initialise (or return) the module-level `stellarClient` singleton.
 * Call this once at server startup (e.g. in `app/api/trpc/[trpc]/route.ts`).
 */
export async function initStellarClient(
  config?: Partial<Omit<StellarConfig, 'adminSecret'>>,
): Promise<StellarClient> {
  _stellarClient = await StellarClient.getInstance(config);
  return _stellarClient;
}

/**
 * Module-level singleton — only valid after `initStellarClient()` has been
 * awaited at least once.  Throws a clear error if accessed too early.
 */
export const stellarClient: StellarClient = new Proxy({} as StellarClient, {
  get(_target, prop) {
    if (!_stellarClient) {
      throw new Error(
        '[StellarClient] Accessed before initialisation. ' +
          'Await `initStellarClient()` at server startup first.',
      );
    }
    return (_stellarClient as any)[prop];
  },
});
