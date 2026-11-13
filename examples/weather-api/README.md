# Example weather API and Buyer

`src/index.ts` is a Provider API on Workers that sells `GET /weather` for $0.001 over x402, with the stock `@x402/hono` middleware and Herald's `accepts()`. It registers a server scheme for each chain family `accepts()` offers on testnet: `near:*`, `eip155:*` and `solana:*`. Herald lists NEAR first, so the 402 offers NEAR Testnet first, then Base Sepolia, Solana Devnet and Arbitrum Sepolia.

`scripts/buy.ts` is a Buyer with the stock `@x402/fetch` client. `--network` picks the Payment Option, and the script registers a client scheme for that chain family only. Without `--network` it is an EVM Buyer paying on Base Sepolia.

| Chain family | `--network`                               | Environment variables                                                       |
| ------------ | ----------------------------------------- | --------------------------------------------------------------------------- |
| EVM          | none, or `eip155:84532` / `eip155:421614` | `BUYER_PRIVATE_KEY`: 0x-prefixed hex private key                            |
| Solana       | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` | `BUYER_SOLANA_KEY`: base58 64-byte secret key                               |
| NEAR         | `near:testnet`                            | `BUYER_NEAR_ACCOUNT`: testnet account id; `BUYER_NEAR_KEY`: `ed25519:…` key |

`BUYER_NEAR_KEY` must be a full-access key of `BUYER_NEAR_ACCOUNT`: a function-call key can't attach the 1 yoctoNEAR deposit an `ft_transfer` needs, and the facilitator refuses it. The NEAR client reads the key's nonce and the block height over RPC, from `BUYER_NEAR_RPC_URL` if set, else the public FastNEAR testnet endpoint. Keys come from the environment only. Never commit them.

A Buyer registers `near:*` only if it holds USDC on NEAR. A stock client pays with the first Payment Option it has a scheme for, without checking the balance, and NEAR is listed first, so a Buyer that registers `near:*` with no USDC on NEAR fails instead of paying on another chain. A Provider whose server doesn't want NEAR passes `networks` to `accepts()` with the other networks and can then leave out the `near:*` scheme.

The Buyer needs testnet USDC and no ETH, SOL or NEAR: Herald's facilitator pays the gas.

The `HERALD_ENV` var (`testnet` by default) picks the Herald environment: the Payment Options `accepts()` offers and the facilitator used when `HERALD_FACILITATOR_URL` is empty. With `mainnet`, the API takes real USDC into a mainnet Provider's Receiving Addresses and needs an `hk_live_` key. `scripts/mainnet-rollout-wizard.sh` runs it that way, on localhost, for its one real payment.

## Run it

The repo README's "Pay the example API" section has the local setup and the EVM and Solana commands. The API needs `HERALD_API_KEY` in `.dev.vars` (see `.dev.vars.example`) and a facilitator that supports `near:testnet`: the resource server refuses to start a route that lists a network its facilitator doesn't support.

## Demo: pay on NEAR testnet

Not run live yet: it needs the NEAR relayer funded (`scripts/near-relayer-wizard.sh testnet`) and a funded Buyer account. The commands below use [near-cli-rs](https://github.com/near/near-cli-rs).

1. **Facilitator.** Either Herald's testnet facilitator, deployed with NEAR support and with `NEAR_RELAYER_KEY` set by the wizard, or a local one: put `NEAR_RELAYER_KEY` and `NEAR_RPC_URL` in `apps/facilitator/.dev.vars`, then `vp -C apps/facilitator run dev`. For the local one, also set `HERALD_FACILITATOR_URL=http://localhost:8787` in `examples/weather-api/.dev.vars`.

2. **Provider.** Seed a Provider and put its key in `examples/weather-api/.dev.vars`:

   ```bash
   vp -C apps/facilitator run seed <provider>.testnet               # local D1
   vp -C apps/facilitator run seed <provider>.testnet --env testnet  # or herald-testnet D1
   ```

   It prints the Provider's NEAR Receiving Address, a 64-character implicit account, and its setup status. Set `PROVIDER_ACCOUNT` in `wrangler.jsonc` to `<provider>.testnet`.

3. **Let Herald set up the NEAR Receiving Address.** Herald creates the implicit account and registers it on USDC (`storage_deposit`) at its own cost, from the relayer. Locally, the seed script queues it with the running facilitator; on testnet, it is queued when the Provider signs in to the dashboard. Overview shows "Setting up USDC" until it's done. Until then every NEAR payment is refused with `invalid_exact_near_recipient_not_registered_for_storage`. If you can't wait, any testnet account can register an address itself for 0.00125 NEAR (Herald then skips that step):

   ```bash
   near contract call-function as-transaction 3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af \
     storage_deposit json-args '{"account_id":"<NEAR Receiving Address>","registration_only":true}' \
     prepaid-gas '30 Tgas' attached-deposit '0.00125 NEAR' \
     sign-as <your-account>.testnet network-config testnet sign-with-keychain send
   ```

4. **Buyer.** Create a testnet account with a full-access key, and get testnet USDC on NEAR from the [Circle faucet](https://faucet.circle.com). If the faucet can't send to the new account, register it on USDC first with the step 3 command, `account_id` set to the Buyer.

   ```bash
   near account create-account sponsor-by-faucet-service <buyer>.testnet \
     autogenerate-new-keypair save-to-keychain network-config testnet create
   near account export-account <buyer>.testnet using-private-key network-config testnet  # prints ed25519:…
   ```

5. **Pay.** Start the API and run the Buyer:

   ```bash
   vp -C examples/weather-api run dev   # weather API on :8788
   export BUYER_NEAR_ACCOUNT=<buyer>.testnet
   read -rs BUYER_NEAR_KEY && export BUYER_NEAR_KEY   # paste the ed25519:… key, kept out of shell history
   vp -C examples/weather-api run buy --network near:testnet
   ```

   Expected output:

   ```text
   Buyer <buyer>.testnet calling http://localhost:8788/weather
   HTTP 200: {"city":"Jakarta","temperatureC":31,"conditions":"Humid"}
   Settlement: {
     success: true,
     payer: '<buyer>.testnet',
     transaction: '<relayer transaction hash>',
     network: 'near:testnet'
   }
   ```

   `https://testnet.nearblocks.io/txns/<relayer transaction hash>` shows the relayer's transaction carrying the Buyer's signed delegate action, and its `ft_transfer` of 0.001 USDC (`1000`) to the NEAR Receiving Address. The Buyer's NEAR balance doesn't change.

If the payment is refused, the Buyer prints `HTTP 402: {"error":"<reason>"}`:

| Reason                                                    | Fix                                                             |
| --------------------------------------------------------- | --------------------------------------------------------------- |
| `invalid_exact_near_recipient_not_registered_for_storage` | Herald hasn't set up the Receiving Address yet (step 3).        |
| `invalid_exact_near_no_relayer_configured`                | The facilitator has no valid `NEAR_RELAYER_KEY` (step 1).       |
| `insufficient_funds`                                      | The Buyer holds less than 0.001 USDC on NEAR testnet (step 4).  |
| `invalid_exact_near_function_call_key_not_allowed`        | `BUYER_NEAR_KEY` is a function-call key; use a full-access key. |
| `invalid_exact_near_access_key_not_found`                 | `BUYER_NEAR_KEY` isn't a key of `BUYER_NEAR_ACCOUNT`.           |
