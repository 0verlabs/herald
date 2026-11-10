import { accepts, facilitatorUrls } from "@hrld/x402";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { env } from "cloudflare:workers";
import { Hono, type MiddlewareHandler } from "hono";

// A Provider API that sells weather data over x402. Everything below is the
// stock x402 setup; Herald only adds `accepts()` and its facilitator URL.

// `HERALD_FACILITATOR_URL` is an optional override (in .dev.vars) to run
// against a local facilitator. Providers just use `facilitatorUrls`.
const { HERALD_FACILITATOR_URL } = env as CloudflareBindings & { HERALD_FACILITATOR_URL?: string };

const facilitator = new HTTPFacilitatorClient({
  url: HERALD_FACILITATOR_URL || facilitatorUrls.testnet,
  // `/supported` is public; verify and settle need the Herald API key.
  createAuthHeaders: async () => {
    const auth = { Authorization: `Bearer ${env.HERALD_API_KEY}` };
    return { verify: auth, settle: auth };
  },
});

const server = new x402ResourceServer(facilitator)
  .register("eip155:*", new ExactEvmScheme())
  .register("solana:*", new ExactSvmScheme());

const routes = {
  "GET /weather": {
    accepts: accepts({
      providerAccount: env.PROVIDER_ACCOUNT,
      price: "$0.001",
      network: "testnet",
    }),
    description: "Current weather in Jakarta",
    mimeType: "application/json",
  },
};

// The middleware fetches the facilitator's /supported when it is created,
// and Workers only allow I/O inside a request, so create it on first use.
let x402: MiddlewareHandler | undefined;

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/health", (c) => c.json({ status: "ok", service: "weather-api" }));

app.use("/weather", (c, next) => {
  x402 ??= paymentMiddleware(routes, server);
  return x402(c, next);
});

app.get("/weather", (c) => c.json({ city: "Jakarta", temperatureC: 31, conditions: "Humid" }));

export default app;
