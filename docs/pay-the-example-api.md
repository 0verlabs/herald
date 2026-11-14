# Pay the example API

```bash
vp -C apps/facilitator run seed <provider-account>   # put the key in examples/weather-api/.dev.vars
vp -C apps/facilitator run dev                        # facilitator on :8787
vp -C examples/weather-api run dev                    # weather API on :8788 (HERALD_FACILITATOR_URL=http://localhost:8787)
curl -i http://localhost:8788/weather                 # 402 with a PAYMENT-REQUIRED header
BUYER_PRIVATE_KEY=0x… vp -C examples/weather-api run buy                           # pays on Base Sepolia
BUYER_PRIVATE_KEY=0x… vp -C examples/weather-api run buy --network eip155:421614   # pays on Arbitrum Sepolia
BUYER_SOLANA_KEY=… vp -C examples/weather-api run buy --network solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1  # pays on Solana Devnet
BUYER_NEAR_ACCOUNT=… BUYER_NEAR_KEY=ed25519:… vp -C examples/weather-api run buy --network near:testnet  # pays on NEAR Testnet
```

Set `PROVIDER_ACCOUNT` in `examples/weather-api/wrangler.jsonc` to the seeded account. The Buyer needs testnet USDC ([Circle faucet](https://faucet.circle.com)) and no ETH or SOL; the facilitator's EVM gas wallet needs Sepolia ETH on each chain, and its Solana gas wallet devnet SOL. `BUYER_SOLANA_KEY` is a base58 64-byte secret key. On NEAR the Buyer is a testnet account (`BUYER_NEAR_ACCOUNT`) with one of its full-access keys (`BUYER_NEAR_KEY`), and the facilitator needs `NEAR_RELAYER_KEY`; `examples/weather-api/README.md` has the NEAR demo step by step. The script registers a client scheme only for the `--network` it pays on: a stock client pays with the first Payment Option it has a scheme for, without checking the balance, and NEAR is listed first, so a Buyer registers `near:*` only if it holds USDC on NEAR. If both dev servers fail to start together, give them different `--inspector-port` values.

After changing a `wrangler.jsonc`, run `vp run -r types` to regenerate binding types (`wrangler types --env-interface CloudflareBindings`). Hono apps type their bindings as `new Hono<{ Bindings: CloudflareBindings }>()`; `env` from `cloudflare:workers` is typed through `Cloudflare.Env`, which Wrangler declares with the same bindings. After changing `packages/db/src/schema.ts`, run `vp run db:generate` to write a new migration.
