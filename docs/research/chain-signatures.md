# NEAR Chain Signatures as the provider's receiving wallet

Status: research note, 2026-11-09/10. Every live value below came from read-only calls: RPC `view` calls on `v1.signer` / `v1.signer-prod.testnet` (fastnear public and archival RPC), transaction lookups, one Base `eth_getTransactionReceipt`, and local key math. Nothing was signed, sent, or spent. Mainnet was at protocol version 88, nearcore 2.14.0, block ~223.83M.

Source text is paraphrased throughout. Labels: **Verified** means checked against a primary source or a live call. **Inference** is my reasoning. **Unverified** means it is claimed somewhere but I did not confirm it.

## Design under test

- Each provider gets a NEAR account. The default is an implicit account built from a locally generated ed25519 key that stays in the provider's env.
- Chain Signatures derives one address per chain from that account: the EVM chains, Solana, and possibly more.
- Each derived address is the x402 `payTo`, used with stock `@x402/*` middleware and existing facilitators.
- Funds are swept later in one of two ways. Same chain: a transfer signed by MPC. Cross chain: send to a 1Click or PoA deposit address, then swap or withdraw.

## Verdict

**The design works.** Receiving is plain: a derived address is an ordinary EOA on EVM chains and an ordinary ed25519 account on Solana. Facilitators can't tell it apart from any other wallet. Nobody needs a NEAR account or any NEAR to *receive*. Signing only matters at sweep time.

Two constraints matter:

1. **Key custody.** Whoever holds the NEAR account's full-access key controls every derived address on every chain. The NEAR key becomes a single master key.
2. **Gas on the sweep chain.** A plain transfer from the derived address needs native gas. On EVM chains with native USDC, EIP-3009 removes this need. An MPC-signed EIP-3009 transfer has been settled on Base mainnet. On Solana, a separate fee payer removes it.

---

## 1. Signer contract, `sign` arguments, schemes, fees, gas, latency

### Contracts (Verified, live)

| | Mainnet | Testnet |
|---|---|---|
| Account | `v1.signer` | `v1.signer-prod.testnet` |
| `version` | `3.18.0` | `3.18.0` |
| Source (from `contract_source_metadata`) | [near/mpc @ e691bdb](https://github.com/near/mpc/tree/e691bdb98d68dcf74653da58d043453a6318765f), committed 2026-10-28 | same |
| State | `Running`, epoch 16 | `Running` |
| Participants / threshold | **16 / 11** | 16 / 11 |

Domains, read from `state` on mainnet:

| `domain_id` | Curve | Protocol | Purpose | Root public key (`public_key`) |
|---|---|---|---|---|
| 0 | Secp256k1 | CaitSith (threshold ECDSA) | Sign | `secp256k1:3tFRbMqmoa6AAALMrEFAYCEoHcqKxeW38YptwowBVBtXK1vo36HDbUWuR6EZmoK4JcH6HDkNMGGqP1ouV7VZUWya` |
| 1 | Ed25519 | Frost (threshold EdDSA) | Sign | `ed25519:G9hwngxWNKdmqMCmU1Yt6LPhFpayJeKFxyAV1HqMNLtF` |
| 2 | Bls12381 | ConfidentialKeyDerivation | CKD | (not needed) |
| 3 | Secp256k1 | CaitSith | ForeignTx (`verify_foreign_transaction`) | (not needed) |

The testnet roots are `secp256k1:4NfTiv3U…HFwx3` and `ed25519:6vSEtQxr…3Un2`. They differ from mainnet, so testnet-derived addresses are not mainnet addresses.

Participants are `multichain-mainnet-aurora.near`, `near-mpc-staking4all-01.near`, `nodemonster.near`, `n1-multichain.near`, `everstake-mpc-1.near`, `stakin-mpc.near`, `mpch-01.near`, `svrn-01.near`, `greenfield-mpc01.near`, `natsai-mpc.near`, `hashkeympc.near`, `astrostakers-mainnet.near`, `klever-nearmpc-01.near`, `nansen-ai-mpc.near`, `bitwise-mpc01.near`, and `mpc-lgns.near`. The [NEAR blog on TEEs](https://near.org/blog/chain-signatures-tee) says "11 out of 17". The live contract shows 16. Trust the contract.

### `sign` method (Verified: source + README + live txs)

- Signature: `sign(request: SignRequestArgs)`, payable ([sign.rs L26-81](https://github.com/near/mpc/blob/e691bdb98d68dcf74653da58d043453a6318765f/crates/contract/src/api/sign.rs)).
- Arguments ([contract README](https://github.com/near/mpc/blob/main/crates/contract/README.md)):
  - `path`: any string.
  - `payload_v2`: either `{"Ecdsa": "<32-byte hex>"}` or `{"Eddsa": "<hex, 32 to 1232 bytes>"}`.
  - `domain_id`: 0 or 1. The legacy name `key_version` is still accepted with the same meaning.
- Payload rules:
  - An ECDSA payload must be a valid secp256k1 scalar. Any 32-byte digest qualifies (tx hash, EIP-712 digest).
  - EdDSA signs the raw message, up to 1232 bytes. 1232 bytes is the Solana packet limit, so a full Solana tx message fits.
- Example request: `{"request":{"payload_v2":{"Ecdsa":"…"},"path":"base-1","domain_id":0}}`.
- Response:
  - Secp256k1: `big_r`, `s` (low-s normalized), `recovery_id`.
  - Ed25519: `signature` bytes.
  - The README warns that recovery returns some key even for forged signatures. Check the recovered key against `derived_public_key(path, predecessor, domain_id)`.
- Duplicate pending requests (same caller, domain, path, payload) are queued and share one response.

**Is EdDSA live on mainnet? Yes.** Evidence:

- Domain 1 (Frost/Ed25519) is in the live mainnet state.
- Archival `public_key({"domain_id":1})` returns the same ed25519 root at blocks 150M (2025-06-06), 160M, 170M, and 180M. At 140M (2025-02-18) it returned the secp key, which means the domain did not exist yet.
- Mainnet tx `CLhgqus9hkSPMu93UdTw6oUj71Rg9KWbNiPQn1psNAo1` (`domain_id: 1`) returned an Ed25519 signature.
- An outside reviewer dates FROST on mainnet to 2026-10-23 ([alinush](https://alinush.github.io/near)). That conflicts with the archival data, which shows the domain from mid-2025. That note may mean a protocol or library change rather than domain creation (unverified).

### Deposit / fee (Verified)

- **1 yoctoNEAR.** `SIGN_DEPOSIT_YOCTONEAR = 1` (`crates/near-mpc-contract-interface/src/deposits.rs`). Any excess is refunded (README "Deposit requirement").
- The deposit exists only so that a function-call access key (which can't attach a deposit) can't trigger signing. It is not a fee.
- `experimental_signature_deposit` and `latest_key_version` **no longer exist**. Both return `MethodNotFound` on mainnet.
- `chainsig.js` hard-codes `getCurrentSignatureDeposit() { return 1 }`, and `near-ca` attaches deposit `"1"`.
- **Docs are stale:** the [controlling-NEAR-accounts tutorial](https://docs.near.org/chain-abstraction/chain-signatures/tutorials/controlling-near-accounts/2-transfer.md) still attaches 0.1 NEAR "to pay MPC fee". That fee is gone.

### Gas (Verified)

- Live `config`: `sign_call_gas_attachment_requirement_tera_gas: 15`. The contract rejects `sign` calls with less than **15 Tgas** attached. The README still says 10 Tgas. The callback reserves `return_signature_and_clean_state_on_success_call_tera_gas: 7`.
- Measured on mainnet tx `GhNcmYbd…` (20 Tgas attached): about 4.19 + 3.37 + 2×0.22 ≈ **7.9 Tgas burnt**. Tokens burnt were **0.00079 NEAR** at the live gas price of 1e8 yocto/gas.
- At $3.61/NEAR (price used in [near-intents.md](near-intents.md)), that is about **$0.003 per signature**.
- Libraries over-attach: `chainsig.js` 300 Tgas, `near-ca` 250 Tgas. Unused gas is refunded.

### Latency (Verified, small sample)

Measured from the tx block to the `v1.signer` receipt that returns the signature, using archival RPC on 5 recent mainnet `sign` txs from `tx-bench.near` (2026-11-09):

| Scheme | Samples | Time until signature |
|---|---|---|
| ECDSA (domain 0) | 2 | 4.8 s, 9.3 s |
| EdDSA (domain 1) | 3 | 3.9 s, 4.1 s, 3.9 s |

The caller sees the result about 0.6 s later. Gliana reports about 15 s end to end for an x402 pay ([README](https://github.com/Gliana-Labs/gliana-near-x402)). Sweeps are not latency-critical, so this is fine.

---

## 2. Derivation

### Formula (Verified: source + reproduced locally)

From [`near-mpc-crypto-types/src/kdf.rs`](https://github.com/near/mpc/blob/e691bdb98d68dcf74653da58d043453a6318765f/crates/near-mpc-crypto-types/src/kdf.rs) and [`contract/src/crypto_shared/kdf.rs`](https://github.com/near/mpc/blob/e691bdb98d68dcf74653da58d043453a6318765f/crates/contract/src/crypto_shared/kdf.rs):

```
tweak = SHA3-256("near-mpc-recovery v0.1.0 epsilon derivation:" + predecessor_id + "," + path)
secp256k1: derived_pk = root_pk + tweak·G            (tweak as big-endian scalar; must be < n)
ed25519:   derived_pk = root_pk + (tweak mod L)·B    (tweak read little-endian, from_bytes_mod_order)
EVM address    = keccak256(uncompressed derived_pk without 0x04)[12..]
Solana address = base58(derived ed25519 pk)
```

`predecessor_id` is the account that calls `sign` (`env::predecessor_account_id()`). When a contract proxies the call, the predecessor is the contract, not the user.

### Offline computation (Verified)

I computed the keys with `@noble/curves` and no network access, then compared them with `v1.signer.derived_public_key`:

| predecessor | path | domain | Offline = contract? | Result |
|---|---|---|---|---|
| `herald-test.near` | `ethereum-1` | 0 | yes | pk `secp256k1:2NNii7NL…QDvpC` → **`0xf437261ba00ac4f34effb54d54df13a81b220e13`** |
| `herald-test.near` | `solana-1` | 1 | yes | **`H396yYAeSpsgC6pQ7Qd681g9MSTT7oYZ4bCqGHGdbNiq`** |
| `example.near` | `ethereum-1` | 0 | yes | `0xef4ea05e5c11057decc8e1bd6f5369f2acd91fa5` |
| implicit `5672dfd4…5f79` (demo key) | `base-1` | 0 | yes | `0xee7f1f10b5299a6c9878bbadbe5fad0d7a88da0c` |
| same | `solana-1` | 1 | yes | `37qks5cRfyFgBtbxUPvYb3vniuXothCBwxr6XKZqVWkB` |

- `herald-test.near` **does not exist** on mainnet (`UNKNOWN_ACCOUNT`), and derivation still works. A provider can publish `payTo` addresses before its NEAR account exists.
- The only input that needs RPC is the two root keys, and both are constants.
- `chainsig.js` 1.1.16 hard-codes the same mainnet and testnet root keys (`constants.ROOT_PUBLIC_KEYS`). Its `getDerivedPublicKey` computes locally for the known contract IDs and calls RPC only for unknown contracts.
- **Docs inconsistency:** [the docs](https://docs.near.org/chain-abstraction/chain-signatures.md) list `example.near` + `ethereum-1` = `0x1b48b83a…aa3b`. The live mainnet contract and my computation give `0xef4ea05e…1fa5`. The docs value was probably made with an older or testnet key (unverified). Don't use doc examples as test vectors.

### Stability (Verified history; no explicit permanence guarantee)

- **History:** archival `v1.signer.public_key` returned the identical secp256k1 root at blocks 125,000,000 (2024-08-04), 140M, 160M, 180M, 200M, 215M, and today. The ed25519 root has been identical since at least 150M (2025-06). The keyset `attempt` is 0 for domains 0 and 1. The network went through many resharings (now epoch 16) without changing the roots.
- **Mechanism:**
  - Resharing and refresh take the old master public key as input and keep it ([threshold-signatures/docs/dkg.md](https://github.com/near/mpc/blob/main/crates/threshold-signatures/docs/dkg.md)). Refresh is defined as changing shares without changing the master public key.
  - The docs say nodes can join and leave without re-deriving the master key ([docs](https://docs.near.org/chain-abstraction/chain-signatures.md)).
  - A source test, `derive_tweak__has_not_changed`, pins the tweak function.
- **What could still change addresses (Inference):**
  - A vote to add a *new* domain (new key) changes nothing for existing domains, but a new library might switch callers to it.
  - A redeployment under a different contract account would have a different root key.
  - A total key loss would force a new keygen. The network then could not sign for old addresses at all, which is a liveness and custody risk, not an address change.
- **Gap:** I found no statement from NEAR that says "derived addresses are permanent". Treat stability as strong de facto (more than 2 years unchanged) rather than a written guarantee.
- **Herald rule:** pin `v1.signer` plus the root keys in the SDK. At startup, check `public_key(domain_id)` against the pinned constants and refuse to emit `payTo` on a mismatch.

---

## 3. Implicit account as predecessor; funding; relayers

- **Implicit accounts can be the predecessor. Verified.**
  - An implicit ID is the 64-char lowercase hex of the ed25519 public key ([account-id](https://docs.near.org/protocol/accounts-contracts/account-id.md), [integrations/accounts](https://docs.near.org/integrations/accounts.md)).
  - Derivation only hashes the account ID string, so any valid ID works. The demo implicit row above was checked against the live contract.
- **Receiving needs nothing.** The derived addresses exist on their own chains with no NEAR account at all. (Verified for derivation; inference for "no NEAR needed", which follows from x402 sending to the foreign address.)
- **Signing needs the account to exist on chain.** A transaction (or a meta-tx delegate action) needs an access key with a nonce ([meta-tx docs, "Accounts must be initialized"](https://docs.near.org/protocol/transactions/meta-tx.md)). (Verified)
  - Any **transfer, even 0 NEAR,** to the implicit ID creates it. The *sender* pays a **0.007 NEAR** creation charge through gas ([integrations/accounts](https://docs.near.org/integrations/accounts.md)).
  - Zero-balance accounts: up to 770 bytes of storage need no staked balance. A one-key implicit account fits, so **the minimum balance is 0 NEAR** ([storage staking](https://docs.near.org/protocol/storage/storage-staking.md)).
  - Herald (or anyone) can create the provider's account for about 0.007 NEAR (≈ $0.025). This gives Herald no control: the key is the provider's.
- **Can a relayer pay so the provider holds no NEAR? Yes.** (Verified from [meta-tx docs](https://docs.near.org/protocol/transactions/meta-tx.md))
  - The relayer pays gas, and **pays any attached deposit of the inner actions**, here the 1-yocto deposit for `sign`.
  - The inner actions run with the user as `predecessor_account_id`, so the derivation still uses the provider's account.
  - The delegate action must be signed with a regular access key. `DelegateV2` with gas keys was removed in protocol 87.
- **Deposit and key type.** The 1-yocto deposit only rules out a *function-call* key signing a plain tx. Under a meta-tx the relayer pays the deposit, and the docs say allowance is not checked. Whether a function-call key limited to `v1.signer`/`sign` can sign a delegate action that carries a deposit is **unverified**. The protocol may reject deposits for function-call keys on the inner action. Assume the provider's full-access key signs the delegate action.
- **Cost per sweep** (borne by the relayer): about 0.0008 NEAR per `sign`, plus delegate-action overhead. That is under $0.01 (inference from measured burn).

---

## 4. Sweep mechanics

### The cited tutorial covers a different case

[controlling-near-accounts/2-transfer](https://docs.near.org/chain-abstraction/chain-signatures/tutorials/controlling-near-accounts/2-transfer.md) and its siblings ([intro](https://docs.near.org/chain-abstraction/chain-signatures/tutorials/controlling-near-accounts/0-introduction.md), [setup](https://docs.near.org/chain-abstraction/chain-signatures/tutorials/controlling-near-accounts/1-setup.md)) cover a different case. An MPC-derived **secp256k1 key is added as an access key on a NEAR account**, and a proxy contract (`broken-rock.testnet`) builds and gets signed a **NEAR** transfer. The setup page is still useful for one point: when a proxy contract calls `sign`, the **contract becomes the predecessor**, and the path encodes the user (`"{caller}-{signer_id}"`). Same-chain EVM and Solana sweeps are covered on the [Signing Transactions](https://docs.near.org/chain-abstraction/chain-signatures/implementation.md) page with `chainsig.js`.

### EVM flow (Verified from docs + `chainsig.js` 1.1.16 typings)

1. `Evm.deriveAddressAndPublicKey(accountId, path)`.
2. `Evm.prepareTransactionForSigning({from, to, value | data})`. This fills nonce, gas, and EIP-1559 fees from a viem `PublicClient`, and returns `{transaction, hashesToSign}`.
3. `contract.sign({payloads, path, keyType: "Ecdsa", signerAccount})`. This sends `sign` with `domain_id 0`, 300 Tgas, and 1 yocto. `signerAccount.signAndSendTransactions` is pluggable, so a meta-tx relayer can sit behind it (inference).
4. `Evm.finalizeTransactionSigning({transaction, rsvSignatures})`, which returns a `0x02…` raw tx.
5. `Evm.broadcastTx(raw)`.

For an ERC-20 sweep, encode `transfer(to, amount)` as `data`, as in the docs' "EVM Function Calls" section. Use EIP-155 / typed txs and **a distinct path per chain**. The docs warn about cross-chain replay and recommend separate paths such as `ethereum-1` and `polygon-1`.

**Who pays EVM gas:** in this flow, the derived address does. It needs ETH, POL, AVAX, or BNB. (Verified: a standard type-2 tx from that EOA.)

### Gasless EVM sweep via EIP-3009 (Verified on mainnet)

- `chainsig.js` EVM has `prepareTypedDataForSigning(TypedDataDefinition)` → `hashToSign`, and `finalizeTypedDataSigning`. It also has `prepareMessageForSigning`, `prepareUserOpForSigning` (ERC-4337 v6/v7), and `prepareAuthorizationForSigning` (EIP-7702).
- `near-ca` ([BitteProtocol/near-ca](https://github.com/BitteProtocol/near-ca), 0.12.1, last pushed 2025-11) is another EVM-focused option.
- **Mainnet evidence:** the [Gliana Labs](https://github.com/Gliana-Labs/gliana-near-x402) NEAR contract has `v1.signer` sign an EIP-3009 `TransferWithAuthorization` digest, and a facilitator settles it on Base.
  - I checked Base tx [`0x8e7d8bea…046a`](https://basescan.org/tx/0x8e7d8bea652438a03ba0cdd21cd3499822e34b07552c61913b50a2e25467046a): status 1, sent by `0x59b7…e704` to USDC.
  - The logs are `AuthorizationUsed(authorizer=0x1ec5…679d)` and `Transfer(0x1ec5…679d → 0x7662…80ad, 2000)`, i.e. $0.002.
  - So an MPC secp256k1 signature over an EIP-712 digest passes USDC's `ecrecover`.
- **Herald sweep (Inference):**
  1. The SDK builds `transferWithAuthorization(from=derived, to=destination or 1Click/PoA deposit address, value, validAfter, validBefore, nonce)`.
  2. MPC signs the digest.
  3. A Herald relayer submits the call and pays gas.
  4. The derived address never holds ETH.
- **Limits (Inference, based on token contracts):**
  - This works only for tokens that implement EIP-3009: Circle-native USDC on Ethereum, Base, Arbitrum, Optimism, Polygon PoS, and Avalanche.
  - It does **not** work for BNB Chain USDC (Binance-Peg) or most USDT deployments. Those need native gas, Permit2/EIP-2612 where available, or EIP-7702 delegation of the derived EOA to a sponsoring smart account (`prepareAuthorizationForSigning` exists; no mainnet example found).

### Solana flow (Verified from docs + typings; fee payer inferred)

1. `Solana.prepareTransactionForSigning({from, to, amount, instructions?, feePayer?})` returns `{transaction, hashesToSign}`, where `hashesToSign` is the serialized message.
2. `sign` with `keyType: "Eddsa"` (`domain_id 1`).
3. `finalizeTransactionSigning`, then `broadcastTx`.

- **SOL for fees:** Solana charges the fee payer, which is the first signer. `SolanaTransactionRequest.feePayer` is an option in `chainsig.js`.
- **Sponsoring (Inference):** a Herald-held fee-payer key can sponsor the sweep. The tx needs two signatures: the MPC signature for the token-account owner, and the relayer's own signature as fee payer. In that case the derived address needs **no SOL**. `chainsig.js` may need the relayer to add its signature after `finalizeTransactionSigning` (not tested).
- **USDC ATA:** x402 SVM pays into the ATA of `payTo`. Anyone can create an owner's ATA (idempotent create, about 0.002 SOL rent paid by the creator). The options are the same as in [static-deposit-address.md](static-deposit-address.md): pre-create once, or rely on `ataCreationSponsored`.
- **Rent destination (Inference):** the derived address itself never needs SOL. The rent stays locked in the ATA and is returned to whoever closes the ATA, to an address of the closer's choosing.

### Cross-chain sweep via NEAR Intents (Inference)

The derived address is just a sender. Use either the EVM EIP-3009 flow or the Solana flow above to send USDC to a 1Click `depositAddress` or a PoA `deposit_address`. Prior work found that PoA credits the token `Transfer` log, not the tx sender ([static-deposit-address.md](static-deposit-address.md)), so relayer-submitted EIP-3009 deposits should be credited. Minimums and fees are in [near-intents.md](near-intents.md) and [stack-and-minimums.md](stack-and-minimums.md).

---

## 5. Supported chains

The MPC network signs any chain that uses secp256k1 ECDSA or ed25519 EdDSA. The [docs](https://docs.near.org/chain-abstraction/chain-signatures.md) name Bitcoin, Ethereum, Solana, BNB, TON, and Stellar as examples. Chain-specific tx building is the caller's job. (Verified)

| Source | Chains |
|---|---|
| docs.near.org example implementation | Bitcoin, Solana, Cosmos, XRP, Aptos, Sui, EVM (Ethereum, Base, BNB, Avalanche, Polygon, Arbitrum, zkSync, …) |
| `chainsig.js` 1.1.16 adapters (`chainAdapters.*`) | `evm`, `btc` (Mempool RPC adapter), `cosmos`, `solana`, `aptos`, `sui`, `xrp` |
| Rust, in-contract | [omni-transaction-rs](https://github.com/near/omni-transaction-rs) (Bitcoin, EVM, …) |
| Not in `chainsig.js` | TON, Stellar, Tron: the curve is supported, but you build the tx yourself (inference) |

All of Herald's target EVM chains plus Solana are covered by the `evm` and `solana` adapters.

---

## 6. Security and trust

- **MPC trust model (Verified).**
  - Any 11 of the 16 nodes can sign, and no single node can.
  - The participant set and threshold are on chain and change only by participant votes (`vote_new_parameters`).
  - Nodes run in Intel TDX TEEs with on-chain attestation ([NEAR blog](https://near.org/blog/chain-signatures-tee)).
  - Trail of Bits audited the network, and the reports are in [near/mpc/audits](https://github.com/near/mpc/tree/main/audits). The live operator list is at [mpc.nearone.org](https://mpc.nearone.org).
  - **The threshold is the custody risk:** a colluding or compromised set of 11 nodes could sign for any derived address.
- **Independent critique** ([Alin Tomescu, "Notes on NEAR's MPC"](https://alinush.github.io/near)). These are concerns, not incidents:
  - There is no scheduled proactive refresh. Resharings happen only when membership changes.
  - The protocol is not robust: one bad node can abort signing without being identified. This is a DoS and liveness risk.
  - Some audit items are open, rated Medium or Informational.
  - Third-party news reports an IP dispute with DFINITY over the threshold-ECDSA design (unverified, not a security incident).
- **Incidents:** I found **no reported fund-loss incident** for Chain Signatures (searched 2026-11). Absence of reports is not proof.
- **NEAR key leak = total loss (Verified by construction).** Anyone with a full-access key for the predecessor account can call `sign` with any path and drain every derived address on every chain. The attacker could also add keys or delete the account. Treat the env key like a hot-wallet seed.
- **Contract as predecessor (Verified):**
  - The docs say NEAR accounts *including smart contracts* can request signatures. In a proxy, the contract is the predecessor.
  - Existing patterns:
    - The tutorial proxy (`broken-rock.testnet`, [source](https://github.com/nearuaguild/control-near-account-with-mpc-example)).
    - [Abstract DAO](https://docs.near.org/chain-abstraction/chain-signatures/tutorials/multichain-dao/0-intro.md): a DAO vote leads to EVM txs.
    - The Shade Agents agent contract: only registered TEE agents may call `request_signature` ([docs](https://docs.near.org/ai/shade-agents/reference/agent-contract)).
    - [Gliana's allowance contract](https://github.com/Gliana-Labs/gliana-near-x402): the contract rebuilds the EIP-3009 digest itself, checks a payee allowlist, then calls `v1.signer`. Its mainnet README links a refused "attack" tx.
  - **Herald sweep contract (Inference):**
    - The contract builds the sweep payload itself, either an EIP-3009 digest or a Solana/EVM tx via omni-transaction-rs. It never signs a caller-supplied hash.
    - It hard-codes or stores the provider's destination.
    - Anyone, such as a Herald cron job, can trigger a sweep, but funds can only go to the provider's chosen destination.
    - The predecessor is then the contract, so addresses derive from `(contract_id, path)`. Use a per-provider path, or a per-provider contract account.
  - **The custody catch:** whoever can upgrade that contract controls every address it derives. A shared Herald contract with a Herald full-access key would make Herald custodial. Options:
    - Deploy to the provider's own account.
    - Use a keyless **deterministic `0s` account**. Its address comes from global-contract code hash plus initial state, it starts with no access keys, and it is pinned by code hash ([account-id docs](https://docs.near.org/protocol/accounts-contracts/account-id.md)). That makes it computable offline and immutable unless its own code allows changes. No one has shown that a `0s` account works for Chain Signatures (Inference).
- **HOT / Omni:**
  - Omni Bridge uses NEAR's MPC ([Omni docs](https://docs.near.org/chain-abstraction/omnibridge/overview.md)).
  - The HOT bridge uses HOT Labs' own MPC, not `v1.signer`. This is unverified here and out of scope.
- **`verify_foreign_transaction` (domain 3, "Read MPC") (Inference):** MPC nodes check a foreign-chain tx against a quorum of RPCs. This could later let a contract confirm a payment landed before acting. Not needed for sweeps.

---

## 7. Prior art: Chain Signatures addresses as x402 `payTo` / merchant receiving

Searches covered the web (Kiro web search) and GitHub (`gh search repos/code`) for "chain signatures x402", "chainsig x402", "chainsig.js x402", "v1.signer payTo", "near chain signatures merchant", and "chain signatures payment receiving address". GitHub code search returned nothing for any query.

| Project | What it does with Chain Signatures + x402 | Seller-side payTo? |
|---|---|---|
| [Gliana-Labs/gliana-near-x402](https://github.com/Gliana-Labs/gliana-near-x402) (NEAR Hackathon 2026, updated 2026-11-09) | A NEAR contract owns a Base address and MPC-signs EIP-3009 to pay standard x402 sellers. Mainnet txs verified (above). | **No**, buyer side |
| [kurodenjiro/Anyone-pay](https://github.com/kurodenjiro/Anyone-pay) | A relayer that uses Chain Signatures pays x402 merchants after a Zcash → 1Click bridge ([prior-art.md](prior-art.md)) | No, buyer/relayer side |
| [r-near/x402-near-demo](https://github.com/r-near/x402-near-demo) | x402 on NEAR via meta-transactions | No Chain Signatures |
| [MultiAgency/near-agencies](https://github.com/MultiAgency/near-agencies) | x402 and wallet deposits, DAO payouts | No evidence of derived `payTo` (README description only) |
| NEAR docs use case | "Receive Bitcoin payments with a native transfer to a Chain Signature derived account" ([docs](https://docs.near.org/chain-abstraction/chain-signatures.md)) | General merchant-receive idea, not x402 |

**I found no project that uses Chain Signatures-derived addresses as the seller's x402 `payTo`.** Herald would be the first I can find. The building blocks are each shown on mainnet: derivation, MPC-signed EIP-3009 settled by an x402 facilitator, and contract-gated signing.

---

## Open items to test (testnet first, human sign-off for anything wet)

1. A meta-tx (NEP-366) relayer submits `v1.signer.sign` for an implicit account on `v1.signer-prod.testnet`. Confirm the relayer pays the 1 yocto and that the predecessor equals the implicit ID.
2. An EIP-3009 sweep from a derived address to a PoA deposit address on Base or Arbitrum. Confirm the Intents credit.
3. A Solana sweep with an external fee payer plus the MPC owner signature, through `chainsig.js`.
4. Whether a function-call key limited to `v1.signer`/`sign` can sign the delegate action that carries the 1 yocto deposit.
5. A per-provider sweep contract on a keyless `0s` account. Confirm that offline address derivation matches.

## Reproduction

- Live views: `public_key`, `derived_public_key`, `state`, `config`, `version`, `contract_source_metadata` on `v1.signer` via `https://rpc.mainnet.fastnear.com`. Archival history via `https://archival-rpc.mainnet.fastnear.com` with `block_id`.
- Offline derivation (Node, `@noble/curves` 2.4, `@noble/hashes` 2.4, `bs58`):

```js
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ed25519 as ed } from "@noble/curves/ed25519.js";
import { sha3_256, keccak_256 } from "@noble/hashes/sha3.js";
import bs58 from "bs58";
const ROOT_SECP = "3tFRbMqmoa6AAALMrEFAYCEoHcqKxeW38YptwowBVBtXK1vo36HDbUWuR6EZmoK4JcH6HDkNMGGqP1ouV7VZUWya";
const ROOT_ED = "G9hwngxWNKdmqMCmU1Yt6LPhFpayJeKFxyAV1HqMNLtF";
const tweak = (a, p) => sha3_256(new TextEncoder().encode(`near-mpc-recovery v0.1.0 epsilon derivation:${a},${p}`));
export function evmAddress(acct, path) {
  const P = secp256k1.Point.fromHex("04" + Buffer.from(bs58.decode(ROOT_SECP)).toString("hex"));
  const t = BigInt("0x" + Buffer.from(tweak(acct, path)).toString("hex"));
  const unc = secp256k1.Point.BASE.multiply(t).add(P).toBytes(false).slice(1);
  return "0x" + Buffer.from(keccak_256(unc).slice(-20)).toString("hex");
}
export function solanaAddress(acct, path) {
  const P = ed.Point.fromHex(Buffer.from(bs58.decode(ROOT_ED)).toString("hex"));
  const t = BigInt("0x" + Buffer.from(tweak(acct, path)).reverse().toString("hex")) % ed.Point.CURVE().n;
  return bs58.encode(P.add(ed.Point.BASE.multiply(t)).toBytes());
}
```
