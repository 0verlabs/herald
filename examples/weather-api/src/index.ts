import { accepts, facilitatorUrls } from "@hrld/x402";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { SupportedResponse } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactNearScheme } from "@x402/near/exact/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { Hono } from "hono";

// A Provider API that sells weather data over x402. Everything below is the
// stock x402 setup; Herald only adds `accepts()` and its facilitator URL.

const app = new Hono<{ Bindings: CloudflareBindings }>();

// paymentMiddleware() fetches the facilitator's `/supported` each time it is
// built, and it is built per request below. The list rarely changes, so the
// first successful response is kept for the life of the isolate.
//
// The middleware itself can't be built once and shared: Workers don't let a
// later request wait on a fetch started by an earlier one, so a cold `/health`
// would leave the next `/weather` hanging.
let supported: SupportedResponse | undefined;

class CachedFacilitatorClient extends HTTPFacilitatorClient {
  override async getSupported(): Promise<SupportedResponse> {
    supported ??= await super.getSupported();
    return supported;
  }
}

// `routes` decides which requests need payment; every other route passes
// straight through.
app.use("*", (c, next) => {
  const facilitator = new CachedFacilitatorClient({
    url: c.env.HERALD_FACILITATOR_URL || facilitatorUrls.testnet,
    // `/supported` is public; verify and settle need the Herald API key.
    createAuthHeaders: async () => {
      const auth = { Authorization: `Bearer ${c.env.HERALD_API_KEY}` };
      return { verify: auth, settle: auth };
    },
  });

  // One scheme per chain family `accepts()` offers: the resource server
  // refuses a route that lists a network it has no scheme for.
  const server = new x402ResourceServer(facilitator)
    .register("near:*", new ExactNearScheme())
    .register("eip155:*", new ExactEvmScheme())
    .register("solana:*", new ExactSvmScheme());

  const routes = {
    "GET /weather": {
      accepts: accepts({
        providerAccount: c.env.PROVIDER_ACCOUNT,
        price: "$0.001",
        env: "testnet",
      }),
      description: "Current weather in Jakarta",
      mimeType: "application/json",
    },
  };

  return paymentMiddleware(routes, server)(c, next);
});

app.get("/health", (c) => c.json({ status: "ok", service: "weather-api" }));

app.get("/weather", (c) => c.json({ city: "Jakarta", temperatureC: 31, conditions: "Humid" }));

export default app;
