# Escrow Contract

The escrow contract holds funds for a single payer/payee pair and exposes explicit,
single-purpose entry points for each lifecycle transition.

## Entry points

| Function | Auth | Effect |
| --- | --- | --- |
| `deposit` | payer | Moves funds into escrow |
| `release` | payer | Pays the payee and closes the escrow |
| `refund` | payer | Returns funds to the payer and closes the escrow |
| `dispute` | payer or payee | Flags the escrow for arbitration |

Each entry point performs its own authorization check and emits exactly one
event describing the transition. There is no generic dispatcher: callers must
invoke the specific function they intend, so authorization and emitted events
are always identical to the direct call.

## Events

Every state change emits a single event (`deposit`, `release`, `refund`,
`dispute`). Because there is no dispatcher wrapper, indexers never observe a
duplicate or synthetic event for the same transition — one call, one event.

## Notes for integrators

- Call `release` / `refund` / `dispute` directly; do not look for a
  `submit_transaction`-style multiplexer.
- Indexers can key off the single event emitted per transition without
  de-duplication logic.
