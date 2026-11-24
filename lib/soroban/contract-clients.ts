/**
 * Typed access to the canonical contracts via the generated bindings in
 * packages/contracts-ts, with contract IDs resolved from deployments/<network>.json.
 */

import { nativeToScVal, xdr } from '@stellar/stellar-sdk';
import type { ClientOptions, Spec } from '@stellar/stellar-sdk/contract';
// Import each contract module directly: the package entry re-exports
// './<name>/index.js', which Turbopack can't map back to index.ts.
import * as bounty from '@/packages/contracts-ts/src/bounty';
import * as escrow from '@/packages/contracts-ts/src/escrow';
import * as freelancer from '@/packages/contracts-ts/src/freelancer';
import * as governance from '@/packages/contracts-ts/src/governance';
import * as identity from '@/packages/contracts-ts/src/identity';
import * as oracle from '@/packages/contracts-ts/src/oracle';
import { CONTRACT_NAMES, currentNetwork, getContractId, type ContractName } from '@/lib/contracts/deployments';

const CLIENTS = {
  bounty: bounty.Client,
  escrow: escrow.Client,
  freelancer: freelancer.Client,
  governance: governance.Client,
  identity: identity.Client,
  oracle: oracle.Client,
};

export type ContractClient<N extends ContractName> = InstanceType<(typeof CLIENTS)[N]>;

export type NetworkOptions = Pick<ClientOptions, 'rpcUrl' | 'networkPassphrase'> &
  Partial<Omit<ClientOptions, 'contractId'>> & { network?: string };

/**
 * Typed client for one of our contracts. Throws if the contract has no
 * address on the network, rather than falling back to a placeholder.
 */
export function getContractClient<N extends ContractName>(name: N, options: NetworkOptions): ContractClient<N> {
  const { network = currentNetwork(), ...clientOptions } = options;
  const contractId = getContractId(name, network);
  if (!contractId) {
    throw new Error(`The ${name} contract has no address on ${network}; see deployments/${network}.json`);
  }
  return new CLIENTS[name]({ ...clientOptions, contractId }) as ContractClient<N>;
}

/** Which of our contracts `contractId` refers to on `network`, if any. */
export function contractNameForId(contractId: string, network: string = currentNetwork()): ContractName | null {
  return CONTRACT_NAMES.find((name) => getContractId(name, network) === contractId) ?? null;
}

const specCache = new Map<ContractName, Spec>();

function specFor(name: ContractName, options: NetworkOptions, contractId: string): Spec {
  let spec = specCache.get(name);
  if (!spec) {
    const { network: _network, ...clientOptions } = options;
    spec = new CLIENTS[name]({ ...clientOptions, contractId }).spec;
    specCache.set(name, spec);
  }
  return spec;
}

/**
 * Encode positional `args` for `method` on `contractId`.
 *
 * For our own contracts, the encoding follows the generated contract spec,
 * so a signature change fails here with a clear error. Without the spec it
 * would produce wrongly typed ScVals. Contracts we don't ship bindings for
 * (e.g. third-party tokens) fall back to `nativeToScVal` type inference.
 */
export function encodeContractArgs(
  contractId: string,
  method: string,
  args: unknown[],
  options: NetworkOptions,
): xdr.ScVal[] {
  const name = contractNameForId(contractId, options.network);
  if (!name) return args.map((arg) => nativeToScVal(arg));

  const spec = specFor(name, options, contractId);
  const inputs = spec.getFunc(method).inputs();
  if (inputs.length !== args.length) {
    throw new Error(`${name}.${method} expects ${inputs.length} argument(s), got ${args.length}`);
  }
  const named = Object.fromEntries(inputs.map((input, i) => [input.name().toString(), args[i]]));
  return spec.funcArgsToScVals(method, named);
}
