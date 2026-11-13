# @hrld/x402

Accept [x402](https://x402.org) payments on many chains with the stock x402 libraries. Payments land in Receiving Addresses controlled by one NEAR account, your Provider Account. Herald pays the gas.

`@hrld/x402` is a small helper: it builds the `accepts` list for your routes and exports Herald's facilitator URLs. Everything else is the stock `@x402/*` setup.

## Install

```bash
npm install @hrld/x402 @x402/core @x402/evm @x402/near @x402/svm
```

Add the `@x402/*` server package for your framework, such as `@x402/hono` or `@x402/express`.

## Use

```ts
import { accepts, facilitatorUrls } from "@hrld/x402";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactNearScheme } from "@x402/near/exact/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";

const facilitator = new HTTPFacilitatorClient({
  url: facilitatorUrls.mainnet,
  // /supported is public; verify and settle need your Herald API key.
  createAuthHeaders: async () => {
    const auth = { Authorization: `Bearer ${process.env.HERALD_API_KEY}` };
    return { verify: auth, settle: auth };
  },
});

const server = new x402ResourceServer(facilitator)
  .register("near:*", new ExactNearScheme())
  .register("eip155:*", new ExactEvmScheme())
  .register("solana:*", new ExactSvmScheme());

app.use(
  paymentMiddleware(
    {
      "GET /weather": {
        accepts: accepts({ providerAccount: "alice.near", price: "$0.01" }),
      },
    },
    server,
  ),
);
```

## API

### `accepts(options)`

Returns one `exact` USDC payment option per network, paying into your Receiving Addresses. It is synchronous and makes no network calls. It throws a `TypeError` on invalid input.

| Option            | Description                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| `providerAccount` | The NEAR account that controls the Receiving Addresses, e.g. `"alice.near"`.                           |
| `price`           | USD price per request, e.g. `"$0.01"`.                                                                 |
| `env`             | `"mainnet"` (default) or `"testnet"`.                                                                  |
| `networks`        | Optional CAIP-2 ids to offer, e.g. `["eip155:8453"]`. Defaults to every network Herald lists in `env`. |

Networks: NEAR, Base, Solana and Arbitrum, plus Polygon and Avalanche on mainnet.

### `facilitatorUrls`

Herald's facilitator URL per environment (`mainnet`, `testnet`), for `HTTPFacilitatorClient`.

## License

MIT
