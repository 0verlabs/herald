---
status: accepted
---

# Herald sponsors the Provider's MPC `sign` gas with NEP-366

When the Provider's NEAR wallet declares `signDelegateActions`, the wallet doesn't send a Sweep's MPC `sign` call itself. It signs a NEP-366 delegate action from the Provider Account holding that one `sign` call, and Herald's NEAR relayer submits it, paying the gas and the 1 yoctoNEAR deposit. The Provider Account is still the `sign` caller, so the MPC signature is still its Receiving Address's, and no address changes. Herald charges no fee for this for now, and the daily Sweep cap bounds what it costs. This amends ADR 0009, which says the Provider "signs the same way as on every other chain", meaning the Provider's wallet sends and pays for its own `sign` call: with such a wallet, Herald pays for that call too. Wallets without `signDelegateActions` keep that path, and the Provider pays.

The #46 probe ([sponsored-mpc-sign.md](../research/sponsored-mpc-sign.md)) showed that this works on testnet, with script-signed delegate actions and then with Meteor Wallet: MPC nodes answer a `sign` arriving in a relayed delegate action, the signature verifies against the Provider Account's derived key, and the Provider Account pays nothing. Meteor signed one such delegate action, and three in one request, each with one approval.

## Considered Options

- **The Provider keeps paying for `sign`**: the default before this. Every Provider needs NEAR in the Provider Account before their first Sweep, the one step of a Sweep Herald can't take for them.
- **A Herald contract calls `sign` for the Provider**: rejected. The MPC signer derives keys from the predecessor, so the contract would be the caller, and every Receiving Address would change.
- **A function-call key on the Provider Account for `sign`**: rejected. The `sign` call needs 1 yoctoNEAR, and NEAR refuses a deposit from a function-call key, in a delegate action too.

## Consequences

- The signature isn't in the relayer transaction's status, which is an empty `SuccessValue`. Herald reads it from the MPC signer's receipt in that transaction, reading the transaction as the relayer's.
- Besides the USDC `ft_transfer` it relays today, the relayer now relays one more kind of delegate action: one holding a single `sign` call to the Herald environment's MPC signer. #48 sets the exact checks. ADR 0008's one `sign` per NEAR transaction still holds, because each delegate action goes in its own relayer transaction.
- Several delegate actions from one key must be relayed in ascending nonce order, since landing one raises the key's nonce past any lower one. One that fails on its nonce sent nothing to the MPC signer, so its Sweep can be signed again.
- A delegate action needs the Provider Account's full-access key on chain. An implicit Provider Account that was never funded has none until Herald creates it (#50).
- Herald pays about 0.00095 NEAR per sponsored `sign` at 50 Tgas.
