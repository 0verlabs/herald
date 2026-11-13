# Sponsored MPC `sign` through NEP-366

Status: live testnet checks for #46, 2026-11-14. The protocol half ran without a wallet: a script signed the delegate actions the way a wallet would. The Meteor Wallet half ran with `scripts/sponsored-sign-probe-wizard.sh` and is in the section at the end. Both passed.

Question: today the Provider's wallet sends each MPC `sign` call itself and pays its gas. Instead, can the wallet sign a NEP-366 delegate action from the Provider Account holding that one `sign` call, and Herald's NEAR relayer submit it and pay? The Provider Account stays the `sign` caller, so every Receiving Address stays the same.

## Answer

- **The MPC network answers a relayed `sign`.** A delegate action holding one `sign` call turns into a receipt from the Provider Account to the MPC signer that holds that one action, which is what MPC nodes index (see [multisign-wallets.md](multisign-wallets.md)). Every `sign` relayed in nonce order was signed, and its transaction was final within 30 seconds of sending.
- **The signature is in a receipt, not in the transaction's status.** The relayer transaction's top-level status is an empty `SuccessValue`, because the delegate receipt returns nothing. The signature is the `SuccessValue` of the MPC signer's second receipt (the first one yields and answers `SuccessReceiptId`). The transaction is read with the relayer as `sender_account_id`.
- **The signature is the Receiving Address's.** Each one verified against the key `v1.signer-prod.testnet` derives (`derived_public_key`) for the Provider Account as predecessor. The `sign` caller is the delegate action's sender, not the relayer.
- **The relayer pays everything.** The Provider Account's balance didn't change, not even by the 1 yoctoNEAR deposit. The relayer paid about 0.00095 NEAR per `sign` at 50 Tgas, the deposit included.
- **Only a full-access key can sign it.** The `sign` call must attach 1 yoctoNEAR, and NEAR refuses a delegate action with a deposit signed by a function-call key (`DelegateActionAccessKeyError: DepositWithFunctionCall`), even one limited to `sign` on the MPC signer.
- **Several delegate actions land if they arrive in nonce order.** Each delegate action needs a nonce above the signing key's, and landing one raises the key's nonce to it. Three sent back to back in ascending nonce order all landed, in all 4 runs. Sent highest nonce first, only the highest landed, and the other two failed with `DelegateActionInvalidNonce`.
- **Wallet support.** Meteor Wallet's entry in the `@hot-labs/near-connect` wallet manifest (entry version 1.1.1, testnet included) declares `signDelegateActions`. So do HOT, Intear, Ledger and NEAR Mobile. Meteor signs it: one delegate action with the 1 yoctoNEAR deposit, with the full-access key, valid for 203 blocks from just before signing, in one approval. Three in one request took one approval and got consecutive nonces in request order, and all three landed. Other wallets weren't tested.

## Method

`herald-nep366-7zi5l45f.testnet`, a throwaway faucet account standing in for the Provider Account, signed each delegate action with its full-access key. Each delegate action held one `sign` call to `v1.signer-prod.testnet` with a random 32-byte payload, path `herald-sponsored-probe`, domain 1 (EdDSA), 50 Tgas and 1 yoctoNEAR, and was valid for 100 to 120 blocks. Herald's own encoders built them (`encodeDelegateAction`, `nearDelegatePayloadHash`, `signedNearDelegate` and `signedRelayerTransaction` in `packages/core/src/server/near-protocol.ts`). A relayer wrapped each in its own transaction with one `Delegate` action and sent it with `send_tx`, then read it with `tx` at `FINAL`.

Two relayers were used: the throwaway `herald-msprobe-mwcku1r0.testnet`, and Herald's testnet relayer `2d67c0a3…2ccef`, through the probe page's server function (`relaySponsoredSigns`) with the wallet replaced by the same script.

## Results

| Check | Result | Relayer transactions |
|---|---|---|
| One delegate action | Signed and verified. Top-level status: empty `SuccessValue`. Provider Account balance change: 0. Relayer: −0.000949 NEAR. | [3CoHGNHC…](https://testnet.nearblocks.io/txns/3CoHGNHCjaYFXvz6TuHRByStT752aEHpuHvTzNSJbKMj) (throwaway relayer), [ARY1veif…](https://testnet.nearblocks.io/txns/ARY1veif98MLCrrCvzSh1HfXXhUkeYudurpWiYGbvFa3) (Herald's relayer) |
| Three, back to back, in ascending nonce order | 3 of 3 landed and signed, in each of 4 runs. Provider Account balance change: 0. Relayer: about −0.00284 NEAR per run. | [9YWi1njE…](https://testnet.nearblocks.io/txns/9YWi1njEZabs6wPSWnd3zMr2gSa3wLXjgpJ4nWnq2E8t), [B6RPmQk3…](https://testnet.nearblocks.io/txns/B6RPmQk3aFe8eayhvAZrzUdXvYxbnLSB9WtVTTDQU9WP), [GEVAigR8…](https://testnet.nearblocks.io/txns/GEVAigR8ZCirWq4sNv7BfqmJSF4ZEE41UU6LfqeapjuW); Herald's relayer, wallet answer order reversed: [3n6AMSbK…](https://testnet.nearblocks.io/txns/3n6AMSbKXDFacYyrFdjy3x5Fri1frtDbCjUzyr11qTCs), [2NuSUbEN…](https://testnet.nearblocks.io/txns/2NuSUbENL5HiNE3UcAhrcMBB2bgdEtiUxrXmBVj6yCvd), [8qrvkTG9…](https://testnet.nearblocks.io/txns/8qrvkTG9wqE7eNvrK4kyPCxDiMbGagaDRnj496HTe75F); also [2X3g2wA4…](https://testnet.nearblocks.io/txns/2X3g2wA4ADHUBpcaz3SgYPru12E9JESJvsgxbVq5LLWn), [FhdTk2Uv…](https://testnet.nearblocks.io/txns/FhdTk2UvfQ6vMN2RE35NLGdKsGS1XJUsjRoUB6sVfypm), [4xF41eQf…](https://testnet.nearblocks.io/txns/4xF41eQfEgz51PNSa3F7sKyKLiBA2rYmUFGdAGDjfdYC) and [C2oqeRA8…](https://testnet.nearblocks.io/txns/C2oqeRA8JRAnWUKHd8mVhChzWEoYnUetfN5LHr3i4omi), [7dNgy9LW…](https://testnet.nearblocks.io/txns/7dNgy9LW8NsGjCB8wSVErRpiWoBGHDvgzsU6ALwJE4Bd), [65DaF44n…](https://testnet.nearblocks.io/txns/65DaF44n8JFYHwi6jKEvrzm8fsW4MvL2KYn1tQLzdgb5) |
| Three, sent highest nonce first | Only the highest landed. The other two failed with `DelegateActionInvalidNonce` (`ak_nonce` …007, `delegate_nonce` …005 and …006). | [FLVdXQsj…](https://testnet.nearblocks.io/txns/FLVdXQsj1sYPVqLc2neqe7ksWyHaXvQMq1XkWNcKJFhd) (landed), [AuxYY3yx…](https://testnet.nearblocks.io/txns/AuxYY3yxBvRDT5yL8oqnSQBcE24smgCmrmfgwhGTBLpz), [68d9HKcz…](https://testnet.nearblocks.io/txns/68d9HKczfJ8ze2sJFCnYjUyikkgc3NKnWr7gxrNG7t6s) |
| Signed by a function-call key (allowance 0.25 NEAR, `sign` on `v1.signer-prod.testnet` only) | Refused: `DelegateActionAccessKeyError: DepositWithFunctionCall`. Nothing reached the MPC signer. | [6FGzxAuP…](https://testnet.nearblocks.io/txns/6FGzxAuP5cmVr5J53EFyp2FyHmajnkjqUYdhNFLVpMGh) (key added in [9wfKWmt8…](https://testnet.nearblocks.io/txns/9wfKWmt8AjTLn3SbQe9U7fkFxsNZZVeLYyBtx8tDaU8r)) |
| The probe server given a `sign` on another path (`ethereum-1`) | Refused before relaying: the probe relays only its own path. | none |

## What this means for Herald

- **Sponsoring works at the protocol level.** It needs no MPC or contract change, and every Receiving Address stays the same.
- **Reading the signature changes.** `readMpcSignature` reads the transaction's top-level `SuccessValue`. That is empty for a relayed `sign`, so a sponsored Sweep must take the MPC signer's receipt (`executor_id` is the MPC contract, `SuccessValue` not empty) and read the transaction as the relayer's.
- **The relayer relays in nonce order.** With several delegate actions from one key, the relayer must send them in ascending nonce order. NEAR doesn't promise that receipts from two relayer transactions run in nonce order, though back-to-back sends always did here. A delegate action that fails with `DelegateActionInvalidNonce` sent nothing to the MPC signer, so its Sweep can safely be signed again. This bears on #49, which relays Solana's delegate action first: Meteor numbers nonces in request order, so putting Solana's first in the request gives it the lowest nonce, and the relayer can send it first.
- **The delegate action expires in about 200 blocks.** Meteor set `max_block_height` 203 blocks above the final height just before signing. The relayer should send it right away, and #49 must relay all of a "Sweep all" within that window.
- **The Provider Account must exist with a full-access key.** A delegate action is checked against the sender's access key on chain. A function-call key can't attach the deposit. An implicit Provider Account that was never funded has no key on chain yet, which is #50.
- **Cost.** About 0.00095 NEAR per `sign` at 50 Tgas, paid by the relayer and bounded by the daily Sweep cap.

<!-- meteor-run:start -->

## Meteor Wallet run

Status: live testnet check for #46, 2026-11-14. Run with `scripts/sponsored-sign-probe-wizard.sh` against a local Herald testnet dashboard, Meteor Wallet and `@hot-labs/near-connect` 0.12.0. Relayer: `2d67c0a372e32b42e352225a954de6b2dbe95e0949ae309af195cc1d70e2ccef`.

| Question | Answer |
|---|---|
| 1. Do MPC nodes answer a `sign` inside a relayed delegate action, and can Herald read the signature from the relayer transaction's outcome? (check one) | Yes. MPC signatures read from receipts and verified: 1/1. Delegate receipts that succeeded: 1/1. Top-level status of the relayer transaction: an empty SuccessValue, so the signature is only in a receipt. |
| 2. Does Meteor's `signDelegateActions` sign a delegate action whose `sign` call carries 1 yoctoNEAR? Which key signs it, and how long does it stay valid? (check one) | Yes. Manifest declares `signDelegateActions`: yes. Deposit on the `sign` call: 1 yoctoNEAR. Signing key: FullAccess. Validity window (`max_block_height` minus the final height just before signing): 203 blocks. Blocks left when Herald received it: 188. Approval prompts: 1. Provider Account balance change across the relay: 0 yoctoNEAR. |
| 3. With 3 delegate actions in one `signDelegateActions` request, does each get its own nonce, so all of them land? (check three) | Yes. Nonces: 277056254000016, 277056254000017, 277056254000018 (distinct, ascending in request order). Delegate receipts that succeeded: 3/3. MPC signatures verified: 3/3. Signing public keys: 1. Approval prompts: 1. |

### Raw results

- **Check one** (1 approval prompt(s))
  - `wallet=meteor-wallet account=hrld.testnet check=one outcome=ok feature=yes delegates=1 nonces=277056254000015 key_nonce=277056254000014 key=FullAccess keys=1 valid_blocks=188 window_blocks=203 deposit=1 landed=1/1 signatures=1/1 tx_status=empty provider_delta=0 hashes=BhnohFFRbwjj11WM7thTH5MTMadZDtXSaMhgss9RWBwg error=`
  - [BhnohFFRbwjj11WM7thTH5MTMadZDtXSaMhgss9RWBwg](https://testnet.nearblocks.io/txns/BhnohFFRbwjj11WM7thTH5MTMadZDtXSaMhgss9RWBwg)
- **Check three** (1 approval prompt(s))
  - `wallet=meteor-wallet account=hrld.testnet check=three outcome=ok feature=yes delegates=3 nonces=277056254000016,277056254000017,277056254000018 key_nonce=277056254000015 key=FullAccess keys=1 valid_blocks=190 window_blocks=203 deposit=1 landed=3/3 signatures=3/3 tx_status=empty provider_delta=0 hashes=4sNATZauV9PF6PkRABTaEvfjBkSHZsiAStzauyvo4Rk1,2hC7Zjx9uxFrT3KKvw3mR4SJhwTuPRn6CWFbEJD1rFHN,39XxPRCYgFn8BefXBxvAYRAuPk81oJEwkErYRooondzT error=`
  - [4sNATZauV9PF6PkRABTaEvfjBkSHZsiAStzauyvo4Rk1](https://testnet.nearblocks.io/txns/4sNATZauV9PF6PkRABTaEvfjBkSHZsiAStzauyvo4Rk1)
  - [2hC7Zjx9uxFrT3KKvw3mR4SJhwTuPRn6CWFbEJD1rFHN](https://testnet.nearblocks.io/txns/2hC7Zjx9uxFrT3KKvw3mR4SJhwTuPRn6CWFbEJD1rFHN)
  - [39XxPRCYgFn8BefXBxvAYRAuPk81oJEwkErYRooondzT](https://testnet.nearblocks.io/txns/39XxPRCYgFn8BefXBxvAYRAuPk81oJEwkErYRooondzT)

### Verdict

Meteor signs sponsored `sign` calls, alone and three in one request, and all of them landed. ADR 0010 stands; #48, #49 and #50 can go ahead. Meteor numbers the nonces in request order, so #49 puts Solana's delegate action first in the request to have it relayed first.

<!-- meteor-run:end -->
