/**
 * Contract addresses per network.
 *
 * Source of truth is the committed manifest in `deployments/<network>.json`,
 * written by `.github/workflows/deploy-contracts.yml` (see docs/deployments.md).
 * A `NEXT_PUBLIC_<NAME>_CONTRACT_ID` env var overrides the manifest, which is
 * how the mainnet release workflow injects addresses at build time.
 */

import testnetManifest from '@/deployments/testnet.json';

export const CONTRACT_NAMES = ['bounty', 'escrow', 'freelancer', 'governance', 'identity', 'oracle'] as const;
export type ContractName = (typeof CONTRACT_NAMES)[number];

export interface ContractDeployment {
  id: string;
  wasmHash: string;
}

export interface DeploymentManifest {
  network: string;
  contracts: Partial<Record<ContractName, ContractDeployment>>;
  gitSha: string | null;
  deployedAt: string | null;
}

const MANIFESTS: Record<string, DeploymentManifest> = {
  testnet: testnetManifest as DeploymentManifest,
};

// Literal property access so Next.js can inline these at build time.
function envOverride(name: ContractName): string | undefined {
  switch (name) {
    case 'bounty':
      return process.env.NEXT_PUBLIC_BOUNTY_CONTRACT_ID || undefined;
    case 'escrow':
      return process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ID || undefined;
    case 'freelancer':
      return process.env.NEXT_PUBLIC_FREELANCER_CONTRACT_ID || undefined;
    case 'governance':
      return process.env.NEXT_PUBLIC_GOVERNANCE_CONTRACT_ID || undefined;
    case 'identity':
      return process.env.NEXT_PUBLIC_IDENTITY_CONTRACT_ID || undefined;
    case 'oracle':
      return process.env.NEXT_PUBLIC_ORACLE_CONTRACT_ID || undefined;
  }
}

export function currentNetwork(): string {
  return process.env.NEXT_PUBLIC_STELLAR_NETWORK || 'testnet';
}

/** The committed manifest for `network`, or `null` if none is committed. */
export function getDeploymentManifest(network: string = currentNetwork()): DeploymentManifest | null {
  return MANIFESTS[network] ?? null;
}

/**
 * Contract ID for `name` on `network`, or `null` when it has not been
 * deployed there. Callers must handle `null`; there is no fallback address.
 */
export function getContractId(name: ContractName, network: string = currentNetwork()): string | null {
  const override = envOverride(name);
  if (override) return override;
  return getDeploymentManifest(network)?.contracts[name]?.id ?? null;
}

/** Verify that an on-chain WASM hash matches the source build attestation (#1727). */
export function verifyDeployedWasmHash(name: ContractName, onChainWasmHash: string, network: string = currentNetwork()): boolean {
  const expected = getDeploymentManifest(network)?.contracts[name]?.wasmHash;
  return !!expected && expected.toLowerCase() === onChainWasmHash.toLowerCase();
}
