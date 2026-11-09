# Two Workers, business logic in `packages/core`, one set of gas wallets

Herald deploys two Cloudflare Workers: `apps/web`, a TanStack Start app serving the dashboard and its server functions, and `apps/facilitator`, which serves the x402 facilitator endpoints. There is no separate API Worker. All business logic (Receiving Address derivation, API keys, the payment log, Sweeps, 1Click) lives in `packages/core`, and both apps compose it. The gas wallets are shared. Each chain has one Durable Object in `apps/facilitator` that sends every transaction from that chain's gas wallet, settlements and Sweeps alike. `apps/web` reaches it through a cross-Worker Durable Object binding, so the two Workers never collide on nonces.

## Considered Options

- **A separate `apps/api` Worker**: rejected for V1. TanStack Start server functions cover the dashboard's backend, and moving logic later is cheap while it lives in `packages/core`.
- **Separate gas wallets per Worker**: rejected. It doubles the wallets to top up.

## Consequences

- `apps/web` depends on `apps/facilitator` being deployed, because Sweeps go through its Durable Objects.
- A bug in Sweep submission can stall payment settlement on that chain, because both share one queue.
