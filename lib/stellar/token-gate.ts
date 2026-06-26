/**
 * Client-side NFT / token ownership checks for gated portfolio content.
 *
 * The balance is read by simulating the token contract's `balance(address)`
 * view method against the public Soroban RPC. Simulation is read-only and
 * requires no signing and no admin/server secret — safe to run in the browser.
 */

import {
  Account,
  Address,
  Contract,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';

const RPC_URL =
  process.env.NEXT_PUBLIC_STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET;

/**
 * Read a holder's balance of a Soroban token contract. Returns the raw token
 * amount as a bigint (0 when the holder has no trustline / balance).
 */
export async function getTokenBalance(
  tokenContractId: string,
  holderPublicKey: string,
): Promise<bigint> {
  const server = new rpc.Server(RPC_URL);
  const contract = new Contract(tokenContractId);

  // A throwaway source account is fine — simulation never touches the ledger.
  const source = new Account(holderPublicKey, '0');

  const tx = new TransactionBuilder(source, {
    fee: '100',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        'balance',
        nativeToScVal(Address.fromString(holderPublicKey), { type: 'address' }),
      ),
    )
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim) || !sim.result?.retval) {
    return 0n;
  }

  try {
    return BigInt(scValToNative(sim.result.retval as xdr.ScVal));
  } catch {
    return 0n;
  }
}

/**
 * Whether a holder owns at least `minAmount` (default 1) of the token — i.e.
 * passes the ownership gate.
 */
export async function hasTokenBalance(
  tokenContractId: string,
  holderPublicKey: string,
  minAmount: bigint = 1n,
): Promise<boolean> {
  const balance = await getTokenBalance(tokenContractId, holderPublicKey);
  return balance >= minAmount;
}
