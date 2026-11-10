import { accepts, facilitatorUrls } from "@hrld/x402";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { Hono } from "hono";

// A Provider API that sells weather data over x402. Everything below is the
// stock x402 setup; Herald only adds `accepts()` and its facilitator URL.

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/health", (c) => c.json({ status: "ok", service: "weather-api" }));

// Built per request from the Worker's bindings. Creating the middleware
// fetches the facilitator's /supported, so it only runs on paid routes.
app.use("/weather", (c, next) => {
  const facilitator = new HTTPFacilitatorClient({
    url: c.env.HERALD_FACILITATOR_URL || facilitatorUrls.testnet,
    // `/supported` is public; verify and settle need the Herald API key.
    createAuthHeaders: async () => {
      const auth = { Authorization: `Bearer ${c.env.HERALD_API_KEY}` };
      return { verify: auth, settle: auth };
    },
  });

  const server = new x402ResourceServer(facilitator)
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

app.get("/weather", (c) => c.json({ city: "Jakarta", temperatureC: 31, conditions: "Humid" }));

export default app;
