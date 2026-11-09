# Herald runs its own x402 facilitator

The keyless public facilitators were unreliable in testing. Dexter's `/verify` returned 503, and PayAI doesn't cover every listed chain. The stock x402 server also exits at startup when a listed network has no live facilitator. So Herald runs its own facilitator, built on the stock `@x402/*` facilitator packages, covering every chain Herald lists. Providers point the stock `HTTPFacilitatorClient` at it, so integration stays drop-in. Herald pays settlement gas from its own wallet on each chain, and the same wallets submit Sweeps.

## Considered Options

- **Route to Dexter and PayAI with a saved list of their supported networks**: rejected. Herald would depend on third parties it can't fix or rate-limit, and Dexter's settlement was unconfirmed.
- **Providers bring their own facilitator (CDP with their keys)**: still possible, because the stock client takes any facilitator. It isn't the default.

## Consequences

- Herald pays gas on every Buyer payment and every Sweep.
- Herald needs one gas wallet per chain family, and settlement must stay correct across Worker isolates: no double settlement, no nonce collisions.
