import { apiKeyPrefixes, facilitatorUrls, networkRegistry, type HeraldEnv } from "@herald/core";

export type Framework = "hono" | "express";

/** The frameworks the Integration page has a snippet for, in tab order. */
export const frameworkLabels: Record<Framework, string> = { hono: "Hono", express: "Express" };

export const frameworks = Object.keys(frameworkLabels) as Framework[];

export type Runtime = "node";

/** The languages and runtimes there are snippets for, each with its frameworks. */
export const runtimes: Record<Runtime, { label: string; frameworks: Framework[] }> = {
  node: { label: "Node.js", frameworks: ["hono", "express"] },
};

export type IntegrationSnippet = {
  /** The shell command that installs the packages the snippet imports. */
  install: string;
  /** The code: a Provider's server (stock x402 plus `accepts()`) or a Buyer. */
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
import { ExactNearScheme } from "@x402/near/exact/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
${parts.imports}

// Herald's facilitator settles every payment. /supported is public;
// verify and settle need your Herald API key.
const facilitator = new HTTPFacilitatorClient({
  url: facilitatorUrls.${input.env}, // ${facilitatorUrls[input.env]}
  createAuthHeaders: async () => {
    const auth = { Authorization: \`Bearer \${process.env.${API_KEY_ENV_VAR}}\` };
    return { verify: auth, settle: auth };
  },
});

// One scheme per chain family accepts() offers. The server refuses to start
// if a route lists a network it has no scheme for.
const server = new x402ResourceServer(facilitator)
  .register("near:*", new ExactNearScheme())
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
          // To offer only some chains, list them. This skips NEAR, and then
          // the near:* scheme above can go:
          // networks: [${networksWithoutNear(input.env).join(", ")}],
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
  const packages = [
    "@hrld/x402",
    "@x402/core",
    "@x402/evm",
    "@x402/near",
    "@x402/svm",
    ...parts.packages,
  ];
  return { install: `npm install ${packages.join(" ")}`, code };
}

/** Every network Herald lists on `env` but NEAR, quoted for the snippet. */
function networksWithoutNear(env: HeraldEnv): string[] {
  return networkRegistry[env]
    .filter((network) => network.kind !== "near")
    .map((network) => JSON.stringify(network.caip2));
}

/**
 * A ready-to-paste Node.js Buyer for the `integrationSnippet` server, with the
 * stock `@x402/fetch` client. It registers a scheme only for the chains whose
 * key is set: a stock client pays with the first Payment Option it has a
 * scheme for, without checking the balance, and Herald lists NEAR first.
 */
export function buyerSnippet(input: { env: HeraldEnv }): IntegrationSnippet {
  const code = `import { createKeyPairSignerFromBytes, getBase58Encoder } from "@solana/kit";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { createClientNearSigner, ExactNearScheme } from "@x402/near";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

// Register only the chains you hold USDC on. The client pays with the first
// Payment Option it has a scheme for, without checking your balance, and
// Herald lists NEAR first: register near:* only if you hold USDC on NEAR.
const client = new x402Client();

if (process.env.BUYER_NEAR_KEY) {
  // A NEAR ${input.env} account and one of its full-access keys (ed25519:…).
  // Function-call keys can't attach the 1 yoctoNEAR an ft_transfer needs.
  const signer = createClientNearSigner({
    accountId: process.env.BUYER_NEAR_ACCOUNT!,
    secretKey: process.env.BUYER_NEAR_KEY as \`ed25519:\${string}\`,
  });
  client.register("near:*", new ExactNearScheme(signer));
}
if (process.env.BUYER_PRIVATE_KEY) {
  // A 0x-prefixed hex private key.
  const account = privateKeyToAccount(process.env.BUYER_PRIVATE_KEY as \`0x\${string}\`);
  client.register("eip155:*", new ExactEvmScheme(account));
}
if (process.env.BUYER_SOLANA_KEY) {
  // A base58 64-byte secret key, as Phantom exports it.
  const bytes = getBase58Encoder().encode(process.env.BUYER_SOLANA_KEY);
  client.register("solana:*", new ExactSvmScheme(await createKeyPairSignerFromBytes(bytes)));
}

// Herald's facilitator pays the gas: you need USDC, and no ETH, SOL or NEAR.
const response = await wrapFetchWithPayment(fetch, client)("http://localhost:3000/weather");
console.log(response.status, await response.text());
const settlement = response.headers.get("PAYMENT-RESPONSE");
if (settlement) console.log(decodePaymentResponseHeader(settlement));
`;
  const packages = ["@x402/fetch", "@x402/evm", "@x402/near", "@x402/svm", "@solana/kit", "viem"];
  return { install: `npm install ${packages.join(" ")}`, code };
}
