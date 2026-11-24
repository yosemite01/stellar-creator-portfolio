# Governance Contract

On-chain governance for the Stellar Creator Portfolio: token holders create
proposals, vote on them, and the winning proposal is executed once the voting
window closes.

## Typed parameter proposals

Executable proposals are **typed**. A proposal cannot carry free-form payloads;
it must select one of the allowed actions below and supply parameter values that
fall inside the action's bounds. Out-of-bounds values are rejected at proposal
creation (`create_param_proposal`) and re-validated at execution time before any
state change is applied.

| Action | Parameter | Bounds |
| --- | --- | --- |
| `SetVotingPeriod` | `voting_period` (ledgers) | `MIN_VOTING_PERIOD..=MAX_VOTING_PERIOD` |
| `SetQuorum` | `quorum` (basis points) | `MIN_QUORUM..=MAX_QUORUM` |
| `SetApprovalThreshold` | `threshold` (basis points) | `MIN_THRESHOLD..=MAX_THRESHOLD` |
| `SetTimelock` | `timelock` (ledgers) | `MIN_TIMELOCK..=MAX_TIMELOCK` |

### Failure modes

- **Out-of-bounds parameter** — `create_param_proposal` returns an error and no
  proposal is stored. The same bounds are enforced again on execution, so a
  proposal that somehow became invalid cannot be applied.
- **Unknown action** — rejected at creation; only the enum variants above are
  executable.
- **Unauthorized execution** — only the winning proposal may be executed, and
  only after the voting window has closed.

### Events

Every state change emits an event: proposal creation, vote casting, and
proposal execution (including the typed action and applied parameter value).

## Off-chain simulation

The UI simulates the effect of a typed proposal before it is submitted, so
voters can see the resulting parameter value and confirm it is within bounds.
The simulation is advisory only — the contract remains the source of truth.

## Testing

Each allowed action has a test covering the happy path and at least one
out-of-bounds rejection. A regression test asserts that out-of-bounds
parameters are rejected at proposal creation.
