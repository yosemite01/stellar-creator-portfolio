/**
 * Abuse controls for the paymaster relay (#1510).
 *
 * Threat closed: the relay signs fee-bumps with the platform fee account, so
 * an open endpoint lets anyone submit arbitrary or very many transactions and
 * drain that account.  Every sponsorship request must now clear, before the
 * platform key is touched:
 *
 *  1. an operation allowlist: `invokeHostFunction` calls into our own
 *     contracts (deployment manifest) or classic operations named in
 *     `STELLAR_SPONSOR_ALLOWED_OPS` (none by default),
 *  2. a low-balance circuit breaker on the fee account,
 *  3. a per-user daily budget in stroops (`STELLAR_SPONSOR_DAILY_BUDGET`).
 *
 * Usage is process-local, like the other limiters in this repo; use a shared
 * store behind the same functions if the app runs on several instances.
 */

import { Address, type FeeBumpTransaction, type Transaction } from '@stellar/stellar-sdk';
import { CONTRACT_NAMES, getContractId } from '@/lib/contracts/deployments';
import { logger } from '@/lib/logger';
import { SponsorError, horizonUrl } from '@/lib/payments/feeBump';

const BALANCE_CACHE_MS = 60_000;

/** Max stroops of fees a single user may have sponsored per UTC day (default 0.1 XLM). */
function dailyBudget(): bigint {
  return BigInt(process.env.STELLAR_SPONSOR_DAILY_BUDGET ?? 1_000_000);
}

/** Sponsoring stops while the fee account holds less than this many stroops (default 5 XLM). */
function minFeeAccountBalance(): bigint {
  return BigInt(process.env.STELLAR_FEE_ACCOUNT_MIN_BALANCE ?? 50_000_000);
}

function allowedContractIds(): Set<string> {
  const ids = new Set<string>();
  for (const name of CONTRACT_NAMES) {
    const id = getContractId(name);
    if (id) ids.add(id);
  }
  return ids;
}

function allowedClassicOps(): Set<string> {
  return new Set(
    (process.env.STELLAR_SPONSOR_ALLOWED_OPS ?? '')
      .split(',')
      .map((op) => op.trim())
      .filter(Boolean),
  );
}

/** Reject (403) unless every operation is one the platform has agreed to sponsor. */
export function assertAllowedOperations(tx: Transaction): void {
  const contracts = allowedContractIds();
  const classicOps = allowedClassicOps();

  for (const op of tx.operations) {
    if (op.type === 'invokeHostFunction') {
      // Only calls into our own contracts; wasm uploads and contract creation are never sponsored.
      if (op.func.switch().name === 'hostFunctionTypeInvokeContract') {
        const target = Address.fromScAddress(op.func.invokeContract().contractAddress()).toString();
        if (contracts.has(target)) continue;
      }
      throw new SponsorError('Contract call is not eligible for sponsorship', 403);
    }
    if (!classicOps.has(op.type)) {
      throw new SponsorError(`Operation "${op.type}" is not eligible for sponsorship`, 403);
    }
  }
}

interface Usage {
  stroops: bigint;
  /** Inner transactions already charged today; each can only land on-chain once. */
  seen: Set<string>;
}

const usage = new Map<string, Usage>();

/**
 * Charge `stroops` to the user's daily budget, rejecting with 429 when it
 * would be exceeded.  A repeated inner transaction is not charged twice, which
 * also keeps the fallback relay from double-billing a retried transaction.
 */
export function reserveSponsorBudget(
  userId: string,
  innerHash: string,
  stroops: bigint,
  now: number = Date.now(),
): void {
  const day = new Date(now).toISOString().slice(0, 10);
  for (const key of usage.keys()) {
    if (!key.startsWith(day)) usage.delete(key);
  }

  const key = `${day}:${userId}`;
  const entry = usage.get(key) ?? { stroops: 0n, seen: new Set<string>() };
  if (entry.seen.has(innerHash)) return;

  if (entry.stroops + stroops > dailyBudget()) {
    throw new SponsorError('Daily sponsorship budget exhausted', 429);
  }
  entry.stroops += stroops;
  entry.seen.add(innerHash);
  usage.set(key, entry);
}

let balanceCache: { at: number; stroops: bigint } | null = null;

async function feeAccountBalance(now: number): Promise<bigint> {
  if (balanceCache && now - balanceCache.at < BALANCE_CACHE_MS) return balanceCache.stroops;

  const unavailable = () => new SponsorError('Paymaster relay is temporarily unavailable', 503);
  const feeAccount = process.env.STELLAR_FEE_ACCOUNT;
  if (!feeAccount) throw unavailable();

  const res = await fetch(`${horizonUrl()}/accounts/${feeAccount}`).catch(() => null);
  if (!res?.ok) {
    logger.error('[paymaster] could not read fee account balance; sponsoring disabled');
    throw unavailable();
  }
  const body = (await res.json().catch(() => ({}))) as {
    balances?: { asset_type: string; balance: string }[];
  };
  const native = body.balances?.find((b) => b.asset_type === 'native')?.balance;
  if (!native) throw unavailable();

  // Horizon reports XLM with 7 decimals ("12.3400000"); convert to stroops.
  const stroops = BigInt(native.replace('.', ''));
  balanceCache = { at: now, stroops };
  if (stroops < minFeeAccountBalance()) {
    logger.error('[paymaster] fee account balance is below the minimum; sponsoring disabled', {
      balanceStroops: stroops.toString(),
      minStroops: minFeeAccountBalance().toString(),
    });
  }
  return stroops;
}

/** Circuit breaker: refuse (503) while the fee account balance is below the minimum. */
export async function assertFeeAccountFunded(now: number = Date.now()): Promise<void> {
  if ((await feeAccountBalance(now)) < minFeeAccountBalance()) {
    throw new SponsorError('Paymaster relay is temporarily unavailable', 503);
  }
}

/** Every check a sponsored fee-bump must pass before it is signed. */
export async function authorizeSponsorship(
  userId: string,
  feeBump: FeeBumpTransaction,
): Promise<void> {
  const inner = feeBump.innerTransaction;
  assertAllowedOperations(inner);
  await assertFeeAccountFunded();
  // Charge the most the platform can be billed for this envelope.
  reserveSponsorBudget(userId, inner.hash().toString('hex'), BigInt(feeBump.fee));
}

/** The failover relay follows the same operation and budget rules as the primary. */
export function authorizeFallback(userId: string, inner: Transaction): void {
  assertAllowedOperations(inner);
  reserveSponsorBudget(userId, inner.hash().toString('hex'), BigInt(inner.fee));
}

/** Test helper: reset usage and the cached fee account balance. */
export function resetSponsorPolicy(): void {
  usage.clear();
  balanceCache = null;
}
