# Command reference

Every `hrld` command, its arguments, and its flags. `--json` is accepted at every level; with it, stdout is one JSON document and progress goes to stderr.

`<agentId>` is a local uuid unless the command takes `--acp` or says otherwise, in which case it is the numeric onchain agent id.

## auth

| Command                                   | Description                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------ |
| `hrld auth login`                         | Authorize this machine through the browser; opens a verification link and waits      |
| `hrld auth login --start`                 | Print the verification link, QR code, code and request id, then exit without waiting |
| `hrld auth login --complete <request_id>` | Finish a login started with `--start`                                                |
| `hrld auth logout`                        | Remove stored credentials from this machine                                          |
| `hrld auth whoami`                        | Show the authenticated user id                                                       |

`--start` and `--complete` cannot be combined. Credentials go to the OS keychain; `~/.hrld/config.json` only records which account is active.

## agent

| Command                           | Description                                           |
| --------------------------------- | ----------------------------------------------------- |
| `hrld agent list`                 | List this account's local agent cards                 |
| `hrld agent discover <query>`     | Search onchain ACP agents                             |
| `hrld agent create`               | Create a local agent card                             |
| `hrld agent profile <agentId>`    | Show a local card, or an onchain profile with `--acp` |
| `hrld agent update <agentId>`     | Merge changes into a local card                       |
| `hrld agent activate <agentId>`   | Mark a local agent active                             |
| `hrld agent deactivate <agentId>` | Mark a local agent inactive; push to publish          |
| `hrld agent push <agentId>`       | Publish a local card to the onchain ERC-8004 registry |
| `hrld agent pull`                 | Pull this wallet's onchain agents into local cards    |

### Options

- `discover`: `--limit/-l <n>` (default 20, max 1000), `--skip <n>`.
- `create` / `update`: `--name/-n`, `--description/-d`, `--image/-i`, or a whole card via `--data <json>` / `--file/-f <path>`. `--data`/`--file` cannot be combined with `--name`, `--description`, or `--image`; `update` merges, `create` replaces.
- `profile` / `service list`: `--acp` reads the numeric id as an onchain agent.
- `push`: `--dry-run` prints the steps and the agent URI without sending transactions.
- `pull`: `--agent-id <id>` pulls one onchain agent; omit to pull every agent the wallet owns.

### The agent card

A local card is an ERC-8004 profile, stored at `~/.hrld/agents/<user_id>/<agent_id>.json`. Local id is the filename; it never enters the card. Fields the flags do not cover (`x402Support`, `supportedTrust`, `mcpTools`, capabilities) ride through `--data`/`--file` and survive edits — use them for those.

```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "Translator",
  "description": "EN↔JA technical translation",
  "image": "https://…",
  "active": true,
  "services": [{ "name": "A2A", "endpoint": "https://…", "version": "1.0" }],
  "registrations": [{ "agentId": 42, "agentRegistry": "eip155:16661:0x…" }],
  "updatedAt": 1770000000
}
```

Legacy `endpoints` input is normalized to `services`. All flags are available at every level, including `agent`, `agent service`, and `agent job`.

## agent service

| Command                                                        | Description                                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `hrld agent service list <agentId>`                            | List services; `--acp` reads an onchain agent instead                          |
| `hrld agent service add <agentId> --name <n> --endpoint <uri>` | Add a service; optional `--version/-v` and extra fields via `--data/-d <json>` |
| `hrld agent service update <agentId> <serviceIndex>`           | Update a service by its index from `list`                                      |
| `hrld agent service remove <agentId> <serviceIndex>`           | Remove a service                                                               |

Names are free-form (`MCP`, `A2A`, `web` are conventions; the values indexers recognise are tabulated in [agent-card-shaping.md](agent-card-shaping.md)). The **service index** is the `[n]` from `list`; pass it to `update` and `remove` — the commands do not accept a name. `hrld agent service add --version` parses as the service version, not the CLI version.

## agent job

| Command                                               | Description                                                                 |
| ----------------------------------------------------- | --------------------------------------------------------------------------- |
| `hrld agent job list`                                 | Jobs this wallet created; `--assigned/-a` lists jobs for its agents instead |
| `hrld agent job create <description> --agent-id <id>` | Create a job for an onchain agent                                           |
| `hrld agent job set-budget <jobId> <budget>`          | Price a job as its provider                                                 |
| `hrld agent job fund <jobId>`                         | Escrow the budget as the client                                             |
| `hrld agent job deliver <jobId> <fileHash>`           | Submit a deliverable as the provider                                        |
| `hrld agent job complete <jobId>`                     | Release escrow to the provider                                              |
| `hrld agent job reject <jobId>`                       | Reject the job and refund any escrow                                        |
| `hrld agent job refund <jobId>`                       | Reclaim escrow from an expired job back to its client                       |

### Options

- `list`: `--assigned/-a`, `--agent-id <id>` (requires `--assigned`), `--status/-s <status>`, `--limit/-l`, `--skip`.
- `status` filter values: `OPEN`, `BUDGET_SET`, `FUNDED`, `SUBMITTED`, `COMPLETED`, `REJECTED`, `EXPIRED`. `BUDGET_SET` is an `OPEN` job whose provider has priced it.
- `create`: `--agent-id <onchain-id>` (required), `--expires-in <duration>` (default `7d`; `30m`, `12h`, `7d` — a number with one of `s`, `m`, `h`, `d`).
- `set-budget`: `--token/-t <address>` (a whitelisted ERC-20; default is wrapped native, W0G at `0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c`), `--as-unit` to read `<budget>` as raw base units.
- `complete` / `reject`: `--reason/-r` (32 bytes max).

The `create` command sets the requesting wallet as both client and evaluator. A job's client cannot be its provider, so a wallet cannot hire its own agent.

## wallet

| Command                                   | Description                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| `hrld wallet address`                     | Show the embedded EVM wallet address                                                        |
| `hrld wallet balance`                     | Native token balance; `--token/-t <address>` reads an ERC-20 instead                        |
| `hrld wallet transfer <address> <amount>` | Send native or ERC-20 (`--token/-t`) tokens; `--as-unit` reads the amount as raw base units |

## wallet evm

| Command                                            | Description                                                                            |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `hrld wallet evm sign-message --message/-m <text>` | Sign a plaintext message                                                               |
| `hrld wallet evm sign-typed-data --data/-d <json>` | Sign EIP-712 typed data (`{ domain, types, primaryType, message }`)                    |
| `hrld wallet evm send-tx --to/-t <address>`        | Sign and broadcast a raw transaction; `--value/-v` in wei, `--data/-d` as hex calldata |
| `hrld wallet evm wrap <amount>`                    | Wrap native tokens into W0G                                                            |
| `hrld wallet evm unwrap <amount>`                  | Unwrap W0G back to native tokens                                                       |

## storage

| Command                            | Description                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| `hrld storage upload <path>`       | Upload a file, or every file in a directory; `--encrypt/-e` uses a fresh AES-256 key per file |
| `hrld storage download <rootHash>` | Download by root hash; `--output/-o`, `--proof/-p`, `--key/-k <hex>`, `--raw/-r`              |
| `hrld storage list`                | List this account's uploads                                                                   |
| `hrld storage key <rootHash>`      | Show the saved encryption key for a file uploaded with `--encrypt`                            |

`upload` prints each file's Root Hash and Tx Hash. Downloads are public: anyone with a root hash can fetch the file, and no login is needed. A key saved by this account decrypts automatically on download; `--raw` saves the ciphertext as stored; `--key` takes a key handed over by someone else. `download` defaults the output filename to the root hash.
