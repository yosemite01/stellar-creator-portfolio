/**
 * paymasterClient
 *
 * Account Abstraction (EIP-4337 style) Paymaster integration for the Stellar
 * frontend.  Soroban network fees are absorbed by the platform so Web2 users
 * never see a "fee" prompt.
 *
 * Architecture:
 *  1. `sponsorTransaction` — primary path: sends the XDR to the platform
 *     relay endpoint which wraps it in a fee-bump and broadcasts it.
 *  2. `relayFallback`      — if the relay is unavailable, falls back to a
 *     secondary relay URL (or direct submission with a platform-funded account).
 *
 * No "gas" or "fee" language is exposed to callers.
 */

const PRIMARY_RELAY_URL =
  process.env.NEXT_PUBLIC_PAYMASTER_RELAY_URL ?? '/api/relay/sponsor';
const FALLBACK_RELAY_URL =
  process.env.NEXT_PUBLIC_PAYMASTER_FALLBACK_URL ?? '/api/relay/fallback';

export interface SponsoredTxResult {
  txHash: string;
  /** Ledger sequence at which the transaction was included. */
  ledger: number;
}

export interface SmartWalletInterface {
  /** Sign an XDR envelope with the user's smart-wallet key. */
  signTransaction(xdr: string): Promise<string>;
  /** Return the user's smart-wallet public key. */
  getPublicKey(): Promise<string>;
}

/**
 * Submit a signed XDR transaction via the platform paymaster relay.
 * The relay adds a fee-bump so the user pays nothing.
 *
 * @param signedXdr  Base64-encoded signed transaction envelope.
 * @param wallet     Optional smart-wallet interface for re-signing if needed.
 */
export async function sponsorTransaction(
  signedXdr: string,
  wallet?: SmartWalletInterface,
): Promise<SponsoredTxResult> {
  try {
    return await _submitToRelay(PRIMARY_RELAY_URL, signedXdr);
  } catch (primaryErr) {
    console.warn('[Paymaster] Primary relay failed, trying fallback', primaryErr);
    try {
      return await _submitToRelay(FALLBACK_RELAY_URL, signedXdr);
    } catch (fallbackErr) {
      throw new Error(
        `Transaction submission failed on both relays: ${(fallbackErr as Error).message}`,
      );
    }
  }
}

async function _submitToRelay(
  url: string,
  signedXdr: string,
): Promise<SponsoredTxResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ xdr: signedXdr }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`Relay ${url} responded ${res.status}: ${body}`);
  }

  const json = await res.json();
  return { txHash: json.hash, ledger: json.ledger };
}

/**
 * Build a user-facing status message that never mentions fees or gas.
 * Maps internal relay status codes to friendly copy.
 */
export function friendlyTxStatus(status: string): string {
  const map: Record<string, string> = {
    pending: 'Processing your transaction…',
    success: 'Transaction confirmed!',
    failed: 'Something went wrong. Please try again.',
    timeout: 'This is taking longer than expected. Please check back shortly.',
  };
  return map[status] ?? 'Transaction submitted.';
}
