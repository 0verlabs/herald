// A Buyer: calls the weather API with the stock @x402/fetch client and pays
// the 402 in testnet USDC from a viem account. Nothing here is Herald-specific.
//
//   BUYER_PRIVATE_KEY=0x… node scripts/buy.ts [--network eip155:421614] [--url <weather URL>]
//
// --network picks the Payment Option to pay with (default: the first one the
// API offers, Base Sepolia). The Buyer needs testnet USDC on that network
// (https://faucet.circle.com) and no ETH: Herald's facilitator pays the gas.
import { parseArgs } from "node:util";
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const { values } = parseArgs({
  options: {
    network: { type: "string" },
    url: { type: "string", default: "http://localhost:8788/weather" },
  },
});
const key = process.env.BUYER_PRIVATE_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error("Set BUYER_PRIVATE_KEY to a 0x-prefixed hex private key holding testnet USDC.");
  process.exit(1);
}

const account = privateKeyToAccount(key as `0x${string}`);
const client = new x402Client((_version, options) => {
  const chosen = values.network ? options.find((o) => o.network === values.network) : options[0];
  if (!chosen) {
    throw new Error(
      `The API doesn't offer ${values.network}; it offers ${options.map((o) => o.network).join(", ")}`,
    );
  }
  return chosen;
}).register("eip155:*", new ExactEvmScheme(account));

console.log(`Buyer ${account.address} calling ${values.url}`);
const response = await wrapFetchWithPayment(fetch, client)(values.url);
console.log(`HTTP ${response.status}:`, await response.text());
const settlement = response.headers.get("PAYMENT-RESPONSE");
if (settlement) console.log("Settlement:", decodePaymentResponseHeader(settlement));
