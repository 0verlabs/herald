---
status: accepted
---

# Settle natively on 0G, retire Circle Arc

Herald originally split identity/discovery (ERC-8004 on 0G Galileo Testnet) from payment settlement (Circle Arc Testnet, via Circle AppKit) because USDC/x402 rails weren't available on 0G at the time. This left two disjoint chain vocabularies with no bridge between them (`chain: "arc"` in wallet tools vs. `chainId: "eip155:16602"` in the indexer), and the README's "settles natively on 0G" claim didn't match the code.

Decision: settle natively on 0G going forward. Arc/Circle-specific code (`chain: "arc"` params, Circle AppKit calls, `arcTestnet`/EURC handling) is being removed, not kept alongside 0G. Chain identifiers throughout the domain and data layer use CAIP-2 (e.g. `eip155:16602`); human-readable slugs like `"0g-testnet"` are a display-only mapping in frontend/interface code, never stored. Herald is expected to go multi-chain within EVM in the future, so `Network` (VM family) and `Chain identifier` (specific chain) remain distinct concepts even though only one chain is live today.
