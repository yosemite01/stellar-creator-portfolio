# Contract deployments

Deployed contract addresses live in committed manifests under
[`deployments/`](../deployments). Read them from there. Don't dig through CI
artifacts.

| Network | Manifest | Written by |
|---|---|---|
| testnet | [`deployments/testnet.json`](../deployments/testnet.json) | `.github/workflows/deploy-contracts.yml` (commits the file) |
| mainnet | `deployments/mainnet.json` attached to each GitHub release | `.github/workflows/deploy-mainnet.yml` (release asset) |

## Schema

```json
{
  "network": "testnet",
  "contracts": {
    "escrow": { "id": "C…", "wasmHash": "<64 hex chars>" }
  },
  "gitSha": "<commit the WASM was built from>",
  "deployedAt": "2026-01-01T00:00:00.000Z"
}
```

`contracts` keys are `bounty`, `escrow`, `freelancer`, `governance`, `identity` and `oracle`. A
contract that has never been deployed to a network is absent. A brand-new
manifest has `"contracts": {}` and null `gitSha`/`deployedAt`.
`__tests__/contract-deployments.test.ts` validates every file in
`deployments/` against this schema.

## How the app reads it

`lib/contracts/deployments.ts` exposes `getContractId(name, network?)`:

1. `NEXT_PUBLIC_<NAME>_CONTRACT_ID`, if set, wins. The mainnet release
   workflow injects these at build time.
2. Otherwise the ID comes from `deployments/<network>.json`, where
   `network` defaults to `NEXT_PUBLIC_STELLAR_NETWORK`.
3. Otherwise it returns `null`. Callers must treat the contract as
   unavailable. There is no placeholder address.

`lib/soroban/contract-clients.ts` builds typed clients from these IDs (see
[`packages/contracts-ts`](../packages/contracts-ts/README.md)).

## Runbook

### Deploy to testnet

The workflow runs automatically on every push to `main`. To run it manually:

1. Go to **Actions → Deploy Soroban Contracts → Run workflow** and pick the
   branch. Running on a feature branch is a safe dry run: the manifest commit
   goes to that branch.
2. The workflow runs the contract tests. It then builds and optimizes the six
   contracts for `wasm32v1-none` and deploys them with
   `scripts/deploy.cjs --manifest deployments/testnet.json`. It uploads
   `contracts.json` and the manifest as the `contracts-testnet-<sha>`
   artifact, then commits the manifest as `github-actions[bot]` with
   `[skip ci]`.
3. The run summary links to the committed manifest.

Deployer account: set the `TESTNET_DEPLOYER_SECRET` repository secret to
deploy from a fixed account. Without it, the workflow generates a throwaway
Friendbot-funded identity.

Contract admin: bounty and escrow take their admin as a constructor argument
at deploy (issue #1708), so there is no follow-up `set_admin` transaction to
front-run. Set the `TESTNET_CONTRACT_ADMIN` / `MAINNET_CONTRACT_ADMIN`
repository variables to the governance address (a `G...` key). On testnet
the workflow falls back to the throwaway deployer's address.

If `main` is branch-protected against bot pushes, allow `github-actions[bot]`
to bypass, or the commit step will fail. The deployment itself and the
uploaded artifact are unaffected.

### Deploy to mainnet

Publishing a `vX.Y.Z` GitHub release runs `deploy-mainnet.yml`. After the
deploy, `deployments/mainnet.json` is attached to the release. To pin the app
to those addresses in a commit, download the asset into `deployments/` and
register it in `MANIFESTS` in `lib/contracts/deployments.ts`.

### Deploy locally

```sh
./scripts/build-reproducible.sh            # or build with cargo and set WASM_DIR
STELLAR_NETWORK=testnet \
STELLAR_RPC_URL=https://soroban-testnet.stellar.org \
STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015" \
STELLAR_ADMIN_SECRET=<secret or stellar-cli identity> \
STELLAR_CONTRACT_ADMIN=<G... admin for bounty/escrow constructors> \
node scripts/deploy.cjs --manifest deployments/testnet.json
```
