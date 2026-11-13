# NEAR payments go to a derived implicit account, not the Provider Account

Herald lists USDC on NEAR (Circle's NEP-141) as a Payment Option, settled by the stock `@x402/near` `exact` scheme. The NEAR Receiving Address is derived through Chain Signatures like every other one: the MPC ed25519 key on path `near-1` (domain 1), whose hex is a 64-character implicit account. Taking the Provider Account itself as `payTo` would have needed no derivation and no MPC to Sweep, but payments would mix with whatever the account already holds, and NEAR would be the one chain where the Provider Account holds funds. Keeping one model means a Receiving Address only ever holds payments, and the Provider Account only controls.

## Considered Options

- **The Provider Account as `payTo`**: rejected for the reasons above. It is the fallback if the derived account can't be made to work.
- **Native NEAR as the asset**: rejected. The stock scheme only sends `ft_transfer`, and NEAR's price moves while a Price is the same USD amount on every Payment Option.
- **MPC signs a full NEAR transaction from the implicit account for a Sweep**: rejected. The implicit account would pay its own gas, so Herald would have to keep it topped up with NEAR.

## Consequences

- Herald sets up each Provider's NEAR Receiving Address at registration, and existing Providers once: it creates the implicit account with a little NEAR and storage-registers it on USDC (0.00125 NEAR). Until registration lands, `@x402/near` rejects every NEAR payment to it (`invalid_exact_near_recipient_not_registered_for_storage`).
- A NEAR Sweep is one MPC `sign` call over a NEP-366 delegate action from the implicit account holding one `ft_transfer`. Herald's relayer submits it and pays the gas, so the Provider signs the same way as on every other chain. (ADR 0010 amends this: with a wallet that signs delegate actions, Herald's relayer also submits the Provider's `sign` call and pays for it.)
- 1Click's NEAR deposit addresses are fresh implicit accounts that aren't registered on USDC, so a `cross_chain` or `intents` Sweep from NEAR would fail at the `ft_transfer`. Before submitting a Sweep, the relayer storage-registers its receiver when it isn't (0.00125 NEAR, not returned), in a relayer transaction of its own, so the delegate action still holds the one `ft_transfer`. Every NEAR 1Click Sweep costs Herald that much on top of the gas, bounded by the daily Sweep cap.
- Each Herald environment has one NEAR relayer account. It submits Buyer settlements (as `@x402/near`'s facilitator signer), setups and Sweeps, all through a `NearChainQueue` Durable Object that serializes its nonce. The stock signer reads the nonce and adds one per settlement, which collides under concurrent payments.
- Changing the path or the curve changes every Provider's NEAR Receiving Address.
