/**
 * Server-side reads of the on-chain `referral` Soroban contract
 * (backend/contracts/referral) — used to merge a referrer's unclaimed
 * on-chain reward balance into the DB-backed referral stats returned by
 * `GET /api/referrals?action=stats` (Issue #1612).
 *
 * Same read pattern as lib/stellar/token-gate.ts: simulate the contract's
 * view method against Soroban RPC with a throwaway source account.
 * Simulation is read-only and needs no signing.
 */

import {
  Account,
  Address,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import { getNetworkConfig } from '@/lib/config/network';

async function simulateReadonlyCall(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  /** Any valid-format G... address works as the simulation source — it's
   *  never submitted or required to exist/be funded. Reusing the address
   *  the call is about avoids needing a separate hardcoded dummy account. */
  sourceAddress: string,
): Promise<unknown | null> {
  const { rpcUrl, passphrase } = getNetworkConfig();
  const server = new rpc.Server(rpcUrl);
  const contract = new Contract(contractId);
  const source = new Account(sourceAddress, '0');

  const tx = new TransactionBuilder(source, {
    fee: '100',
    networkPassphrase: passphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim) || !sim.result?.retval) {
    return null;
  }
  return scValToNative(sim.result.retval);
}

/**
 * Reads `ReferralContract::get_unclaimed_rewards(referrer)` — the i128
 * reward balance (in the configured reward token's smallest unit) not yet
 * claimed by `referrerAddress` on-chain. Returns `null` if the contract
 * isn't configured (`REFERRAL_CONTRACT_ID` unset) or the read fails for any
 * reason (RPC outage, bad address, etc.) — callers treat this as
 * best-effort enrichment, never a hard dependency for the stats endpoint.
 */
export async function getUnclaimedRewardsOnChain(
  referrerAddress: string,
): Promise<bigint | null> {
  const contractId = process.env.REFERRAL_CONTRACT_ID;
  if (!contractId) return null;

  try {
    const result = await simulateReadonlyCall(
      contractId,
      'get_unclaimed_rewards',
      [nativeToScVal(Address.fromString(referrerAddress), { type: 'address' })],
      referrerAddress,
    );
    return result === null ? null : BigInt(result as string | number | bigint);
  } catch {
    return null;
  }
}

/**
 * Reads `ReferralContract::get_referral_count(referrer, month)` — the
 * number of referrals `referrerAddress` registered in the given month
 * (Unix seconds / 30 days, matching the contract's `ONE_MONTH_SECS`
 * bucketing). Returns `null` on any failure, same contract as above.
 */
export async function getReferralCountOnChain(
  referrerAddress: string,
  month: bigint,
): Promise<number | null> {
  const contractId = process.env.REFERRAL_CONTRACT_ID;
  if (!contractId) return null;

  try {
    const result = await simulateReadonlyCall(
      contractId,
      'get_referral_count',
      [
        nativeToScVal(Address.fromString(referrerAddress), { type: 'address' }),
        nativeToScVal(month, { type: 'u64' }),
      ],
      referrerAddress,
    );
    return result === null ? null : Number(result);
  } catch {
    return null;
  }
}

/**
 * Reads `ReferralContract::get_pool()` — `(available, reserved)` reward
 * token balances of the funded pool (Issue #1716). `available` is unreserved
 * funding; `reserved` backs unclaimed rewards. Returns `null` on any failure.
 * `sourceAddress` is any valid G... address used only for simulation.
 */
export async function getReferralPoolOnChain(
  sourceAddress: string,
): Promise<{ available: bigint; reserved: bigint } | null> {
  const contractId = process.env.REFERRAL_CONTRACT_ID;
  if (!contractId) return null;

  try {
    const result = await simulateReadonlyCall(contractId, 'get_pool', [], sourceAddress);
    if (!Array.isArray(result) || result.length !== 2) return null;
    return { available: BigInt(result[0]), reserved: BigInt(result[1]) };
  } catch {
    return null;
  }
}
