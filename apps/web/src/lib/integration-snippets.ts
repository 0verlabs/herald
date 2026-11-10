import { apiKeyPrefixes, type HeraldEnv } from "@herald/core";

export type Framework = "hono" | "express";

/** The frameworks the Integration page has a snippet for, in tab order. */
export const frameworkLabels: Record<Framework, string> = { hono: "Hono", express: "Express" };

export const frameworks = Object.keys(frameworkLabels) as Framework[];

export type IntegrationSnippet = {
  /** The shell command that installs the packages the snippet imports. */
  install: string;
  /** The Provider's Node.js server: stock x402 setup plus `accepts()`. */
  code: string;
};

/** The environment variable the snippets read the Herald API key from. */
export const API_KEY_ENV_VAR = "HERALD_API_KEY";

/** The `.env` line a Provider adds, with a placeholder for its API key. */
export function envFileSnippet(env: HeraldEnv): string {
  return `${API_KEY_ENV_VAR}=${apiKeyPrefixes[env]}…`;
}

const frameworkParts: Record<
  Framework,
  { packages: string[]; imports: string; createApp: string; routeAndServe: string }
> = {
  hono: {
    packages: ["@x402/hono", "hono", "@hono/node-server"],
    imports: `import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { serve } from "@hono/node-server";
import { Hono } from "hono";`,
    createApp: "const app = new Hono();",
    routeAndServe: `app.get("/weather", (c) => c.json({ city: "Jakarta", temperatureC: 31 }));

serve({ fetch: app.fetch, port: 3000 });`,
  },
  express: {
    packages: ["@x402/express", "express"],
    imports: `import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import express from "express";`,
    createApp: "const app = express();",
    routeAndServe: `app.get("/weather", (req, res) => {
  res.json({ city: "Jakarta", temperatureC: 31 });
});

app.listen(3000);`,
  },
};

/**
 * A ready-to-paste Node.js x402 server for a Provider: the stock
 * `HTTPFacilitatorClient` pointed at Herald's facilitator with the Herald API
 * key from `HERALD_API_KEY`, and `accepts()` with the Provider Account filled
 * in. Herald adds nothing else (ADR-0005).
 */
export function integrationSnippet(input: {
  framework: Framework;
  providerAccount: string;
  env: HeraldEnv;
}): IntegrationSnippet {
  const parts = frameworkParts[input.framework];
  const code = `import { accepts, facilitatorUrls } from "@hrld/x402";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
${parts.imports}

// Herald's facilitator settles every payment. /supported is public;
// verify and settle need your Herald API key.
const facilitator = new HTTPFacilitatorClient({
  url: facilitatorUrls.${input.env},
  createAuthHeaders: async () => {
    const auth = { Authorization: \`Bearer \${process.env.${API_KEY_ENV_VAR}}\` };
    return { verify: auth, settle: auth };
  },
});

const server = new x402ResourceServer(facilitator)
  .register("eip155:*", new ExactEvmScheme())
  .register("solana:*", new ExactSvmScheme());

${parts.createApp}

app.use(
  paymentMiddleware(
    {
      "GET /weather": {
        // One Payment Option per chain, each paying into your Receiving Address.
        accepts: accepts({
          providerAccount: ${JSON.stringify(input.providerAccount)},
          price: "$0.001",
          env: ${JSON.stringify(input.env)},
        }),
        description: "Current weather",
        mimeType: "application/json",
      },
    },
    server,
  ),
);

${parts.routeAndServe}
`;
  const packages = ["@hrld/x402", "@x402/core", "@x402/evm", "@x402/svm", ...parts.packages];
  return { install: `npm install ${packages.join(" ")}`, code };
}
