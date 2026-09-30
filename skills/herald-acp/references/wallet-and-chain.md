# Wallet, chain and storage

## What a "wallet" is here

Every authenticated account gets a hosted embedded wallet. One EVM key signs for everything: identity, escrow, transfers, storage. There is no seed phrase to manage and no separate agent keypair — the wallet is tied to your Herald account, and `hrld auth login` on a machine is what grants that machine access to it.

Credentials live in the OS keychain, keyed per account as `account-<user_id>`. `~/.hrld/config.json` records which account is active. Access tokens refresh automatically and the refresh token rotates on every use, so do not copy credentials between machines.

One account, one wallet. The same address is the client, the provider, the evaluator, the storage uploader, and the registry owner — which is exactly why `hrld agent job create` refuses when the target agent is provided by the same wallet.

## Funds

Two balances matter, and both are read the same way:

```sh
hrld wallet balance                       # native 0G
hrld wallet balance --token 0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c  # wrapped 0G
```

- **Native 0G** pays gas for every transaction — `push`, `fund`, `deliver`, `complete`, `reject`, `refund`, `transfer`, and the storage fee on `upload`.
- **Wrapped 0G (W0G)** is the default job payment token, at `0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c`. Escrow pulls it with `transferFrom`, so a client must _hold_ the budget in W0G **and** have approved it before `fund` can succeed. `hrld agent job fund` runs the approval itself when the allowance is short, so you rarely approve by hand.

`hrld wallet evm wrap <amount>` converts native into W0G; `hrld wallet evm unwrap <amount>` reverses it. Both default to treating the amount as whole token units — `--as-unit` reads raw base units instead.

Amount formats to remember: `transfer`, `wrap`, `unwrap`, and `set-budget` all take whole units like `1.5` unless `--as-unit` is passed. `hrld wallet evm send-tx --value` is always wei. When the CLI cannot read a token's decimals, it says so and points at `--as-unit`.

Naming the chain:

- Chain: **0G** only. `hrld` has no `--chain` flag yet; every command runs against 0G.
- Chain id: `16661`. Agent registry references are `eip155:16661:<contract>`.

## Contract addresses (0G)

| What                               | Address                                      |
| ---------------------------------- | -------------------------------------------- |
| Wrapped native token (W0G)         | `0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c` |
| ERC-8004 identity registry         | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| ERC-8004 reputation registry       | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
| ERC-8183 agentic commerce (escrow) | `0x6a9012eb291a1cc018470e7e436a87d4c010ee0e` |

W0G is the default payment token for `hrld agent job set-budget`, so it is the address you pass to any `--token`/`-t` flag when reading its balance or approving it:

```sh
hrld wallet balance --token 0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c
```

The identity registry is where `hrld agent push` registers and sets the agent URI. The escrow contract is where `fund`, `deliver`, `complete`, `reject`, and `refund` act.

## 0G Storage

Deliverables and any other artifact live on 0G Storage and are addressed by merkle **Root Hash**.

```sh
hrld storage upload ./deliverable.pdf        # → Name, Root Hash 0x…, Tx Hash, Size
hrld storage upload ./out --encrypt          # every file, fresh AES-256 key each
hrld storage download 0x… --output ./inbox/  # by root hash, no login needed
hrld storage list                            # this account's uploads
hrld storage key 0x…                         # the saved key, to hand to someone else
```

- Uploads need a logged-in account and enough balance to cover the storage fee and gas. Downloads need neither.
- `--encrypt` keys are machine-local in the OS keychain. `upload` never prints the key; `hrld storage key` is how you share it. A lost key means a lost file — there is no recovery.
- `download` picks up a key this account saved; otherwise pass `--key <hex>`, or `--raw` to keep the bytes as stored. A file whose header looks encrypted but which was written anyway triggers a warning, not a failure.
- A directory upload is recursive: every file inside goes up and each gets its own root hash.
- The root hash is the deliverable's identity. Uploading the same file twice is fine; changing even one byte changes the hash, and that hash is what the client will fetch and verify.

## On-chain agent facts

The API and the CLI expose the same profile. `hrld agent profile <id> --acp` returns the name, description, image, agent URI, owner address, feedback count, and creation time.

- **Owner** is the address that registered the agent — the wallet that ran `push`.
- **`registrations`** on a local card ties it to the owner's chain and registry: `{ agentId, agentRegistry }`. That pair is what makes `push` idempotent and `pull` able to match an onchain agent to a local card.
- **Metadata** may hold an `agentWallet` entry. When it is a valid address, that wallet is the **provider** paid by jobs; otherwise the agent's owner is. This is how an owner can direct the revenue from its agent to a different address — but the key must be set **on-chain**, and `hrld` has no command for it. An agent published entirely through the CLI is paid at its owner address. Details, including the EIP-712 path for setting it out-of-band, are in [agent-card-shaping.md](agent-card-shaping.md#payment-routing-and-the-trap).
- **Feedback** accrues against the numeric onchain id, independently of which client paid or which token settled the job.

On-chain ids are shared across the network and are what every other party references. Local uuids never leave the machine.

## Reading the network without a wallet

`hrld agent discover`, `hrld agent profile --acp`, and `hrld agent service list --acp` hit the Herald API, which indexes ERC-8004 registrations. They need no login and cost nothing. The same data is exposed to agent harnesses through the Herald MCP server as `search_agents`, `get_agent`, `list_agent_services`, `list_agent_feedbacks`, `list_jobs`, and `get_job` — but those are read-only. Anything that writes goes through `hrld`.
