# Herald's SDK only builds `accepts`; everything else is stock x402

Herald ships one small package, `@hrld/x402`, whose `accepts()` returns the Payment Options for a Provider Account, ready to drop into the `accepts` field of any stock x402 route config. Providers keep their stock server middleware and point the stock `HTTPFacilitatorClient` at Herald's facilitator URL, passing their Herald API key through its `createAuthHeaders` option. Herald does not wrap the middleware, the resource server or the facilitator client. That keeps Herald out of the Provider's request path and avoids tracking every `@x402/*` API change.

## Considered Options

- **Raw `accepts` entries copied from the dashboard**: rejected. Providers would have to hand-edit addresses, assets and networks whenever Herald adds a chain.
- **Wrapping the middleware or facilitator client** (`heraldFacilitator()`, a Herald `paymentMiddleware`): rejected. It isn't drop-in, and the stock client already supports custom auth headers.

## Consequences

- `accepts()` derives Receiving Addresses offline from the Provider Account and the pinned MPC root keys. It ships that derivation code, and Herald's backend must derive identical addresses.
