# Herald

Agentic commerce: `Assistant`s (acting on a user's behalf) discover, call, and pay `Agent`s for priced capabilities, settled on 0G.

## Language

**Agent**:
An ERC-8004 registered, on-chain counterparty — the thing you discover, call, and pay. Identified by a CAIP-2-scoped composite id (`{caip2ChainId}:{tokenId}`, e.g. `eip155:16602:42`) that stays composite even though 0G is currently the only chain, since re-migrating every foreign key later is far more expensive than keeping the prefix now.
_Avoid_: Bot, service provider

**Assistant**:
The user's own LLM, holding the user's wallet and calling tools and `Agent`s on the user's behalf. Distinct from `Agent`: an `Assistant` pays, an `Agent` gets paid.
_Avoid_: Agent (when referring to the user's own LLM), bot, model

**Interface**:
A protocol surface an `Agent` exposes — one MCP server, one REST API base, one A2A/OASF/wallet/ENS/DID/web/email declaration — declared in the registration file's `services[]`. An `Agent` can expose more than one `Interface` of the same kind (e.g. two MCP servers).
_Avoid_: Service (ambiguous — see Offer), endpoint (ambiguous — see below)
_Status_: Target vocabulary for the `services[]` entries once `packages/indexer/SCHEMA_FIX.md` is implemented; not yet reflected 1:1 in code.

**Offer**:
A single priced, callable capability behind an `Interface` — one MCP tool/prompt/resource, or one REST endpoint. The unit that has a `Fee` and gets invoked. Per Herald's model, an `Offer` is a stateless per-call micropayment: no accounts, keys, or subscriptions tie it to a specific caller.
_Avoid_: Service (ambiguous — see Interface), endpoint
_Status_: Target vocabulary for `attributes.pricing.*` entries once `packages/indexer/SCHEMA_FIX.md` is implemented.

**Fee**:
The price of an `Offer`, a plain non-negative number. `0` means free — there is no separate free/null state. Currency is USDC by convention; there is no `currency` field.
_Avoid_: Price, cost, startsFrom (that's a UI-derived "cheapest Offer" view, not a domain term)

**Owner**:
The ERC-721 holder of an `Agent` — a control relationship (can update the registration). Distinct from `Wallet`.

**Wallet** (of an `Agent`):
The address an `Agent` is paid at — a settlement relationship, set only via the `agentWallet` metadata service. Stays unset (`null`) until explicitly declared; it does not default to `Owner` on registration or fall back to `Owner` after a transfer. "No payable address yet" must be an explicit, checkable state, not a plausible-looking wrong address.
_Avoid_: Assuming Wallet == Owner

**Tag**:
A free-form, agent-authored string describing an `Agent`, taken verbatim from the on-chain registration file.

**Category**:
Herald's curated classification of an `Agent`, derived from its `Tag`s (unrecognized tags map to `"others"`). Currently one `Category` per `Agent`; the intended model is many `Category`s per `Agent`, matching `Tag` cardinality — today's single-category constraint is a known limitation, not the design.
_Avoid_: Treating Category as identical to Tag — Tag is on-chain and free-form, Category is off-chain and curated

**Chain identifier**:
A CAIP-2 string (e.g. `eip155:16602`) — the canonical form everywhere in the domain and data layer. Human-readable slugs (e.g. `"0g-testnet"`) exist only as a display/lookup layer in frontend and interface code and are never stored.
_Avoid_: Bare chain ids, chain-specific SDK names (`zeroGTestnet`, `Arc_Testnet`) as domain vocabulary

**Network**:
The VM family a `Wallet` (of a user) operates on, e.g. `"evm"`. Distinct from `Chain identifier`, which names a specific chain within a family. Kept as two separate concepts because Herald is heading multi-chain within EVM.
_Avoid_: Using "chain" and "network" interchangeably

**Score** / **Feedback**:
Reputation data modeled on-chain via `ReputationRegistry` (`NewFeedback`, `FeedbackRevoked`). Genuine, intended domain concepts — not speculative — but indexing is not yet wired up; the corresponding `Agent` columns are currently unfed.

## Deferred vocabulary

`Task`, `Job Request`, `Task Pool`, `Negotiation`, `Escrow`, and `ERC-8183` are real, intended roadmap concepts (task-brokering between `Agent`s, beyond simple per-call `Offer`s) but deliberately left undefined here. They need their own grilling session when that work actually starts, rather than a light sketch now.
