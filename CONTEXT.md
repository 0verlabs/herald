# Herald

Agentic commerce on 0G: AI agents with embedded wallets discover each other through ERC-8004 registries, transact per call, and settle natively in 0G/USDC. `@hrld/core` is the canonical home of this vocabulary — pure zod schemas, consumed by every other package.

## Language

### Agents

**Agent**:
An AI service registered in the ERC-8004 IdentityRegistry on a supported chain, discoverable in the Herald marketplace.

**Agent Id**:
The canonical application-wide identifier for an Agent: `"<chain>:<onChainAgentId>"` (e.g. `0g-testnet:42`). Derived, never generated.
_Avoid_: uuid, database id

**On-Chain Agent Id**:
The numeric id assigned by the IdentityRegistry on a single chain. Only unique per chain; never use it alone as an identifier.

**Registration File**:
The document at an Agent's `agentURI` describing the agent (name, description, image, tags, services). Fetched and parsed by the Indexer.

**Tag**:
A free-text label an Agent self-declares in its Registration File. An Agent has multiple Tags. Stored as-is, uncontrolled.
_Avoid_: category

**Curated Tag**:
A Tag from Herald's closed, application-defined list (`tags` in `@hrld/core`), used for marketplace filtering. Filtering by "Others" matches Agents whose Tags fall outside the curated list.

**Score**:
An Agent's reputation value (0–100), sourced from the ERC-8004 ReputationRegistry.

**Feedback Count**:
The number of reputation feedback entries backing an Agent's Score, from the ReputationRegistry.

### Services & Fees

**Service**:
A callable capability an Agent offers (API or MCP). The unit that carries a Fee. Model under redesign — not currently part of the canonical schema.

**Fee**:
The price to call a Service, always denominated in USDC, represented as a base-unit string (6 decimals, e.g. `"1500000"` = 1.5 USDC).
_Avoid_: price, cost

**Starts From**:
An Agent-level display value derived as the minimum of its Services' Fees. Never stored.

### Chain primitives

**Chain**:
A specific blockchain Herald settles on, identified by slug (`0g`, `0g-testnet`).

**Network**:
A wallet/VM family (`evm`, `solana`). A user has one wallet per Network.

**Token**:
An asset Herald can hold or transfer on a Chain: `native` or `usdc`.

### Infrastructure roles

**Indexer**:
The Ponder app that indexes ERC-8004 registries into queryable Agent data. Its tables are ephemeral — rebuilt on re-index — so nothing durable may be generated there.

**User Wallet**:
A Privy embedded wallet provisioned per user per Network, signed server-side.
