// A Buyer: calls the weather API with the stock @x402/fetch client and pays
// the 402 in testnet USDC. Nothing here is Herald-specific.
//
//   BUYER_PRIVATE_KEY=0x… node scripts/buy.ts [--network eip155:421614] [--url <weather URL>]
//   BUYER_SOLANA_KEY=… node scripts/buy.ts --network solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1
//   BUYER_NEAR_ACCOUNT=… BUYER_NEAR_KEY=ed25519:… node scripts/buy.ts --network near:testnet
//
// --network picks the Payment Option to pay with, and the script registers a
// scheme for that chain family only. Without it the Buyer is an EVM one and
// pays with the first EVM option the API offers, Base Sepolia.
//
// - EVM: a viem account (BUYER_PRIVATE_KEY, 0x-prefixed hex).
// - Solana: a key pair (BUYER_SOLANA_KEY, base58 64-byte secret key as
//   Phantom exports it).
// - NEAR: a testnet account (BUYER_NEAR_ACCOUNT) and one of its full-access
//   keys (BUYER_NEAR_KEY, `ed25519:…` as near-cli stores it). Function-call
//   keys can't attach the 1 yoctoNEAR an `ft_transfer` needs. The client reads
//   the key's nonce and the block height over NEAR RPC, from
//   BUYER_NEAR_RPC_URL if set, else the public FastNEAR testnet endpoint.
//
// Register `near:*` only if the Buyer holds USDC on NEAR. A stock client pays
// with the first Payment Option it has a scheme for, without checking the
// balance, and Herald lists NEAR first.
//
// The Buyer needs testnet USDC on that network (https://faucet.circle.com) and
// no ETH, SOL or NEAR: Herald's facilitator pays the gas.
import { parseArgs } from "node:util";
import { createKeyPairSignerFromBytes, getBase58Encoder } from "@solana/kit";
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { createClientNearSigner, ExactNearScheme } from "@x402/near";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const { values } = parseArgs({
  options: {
    network: { type: "string" },
    url: { type: "string", default: "http://localhost:8788/weather" },
  },
});

const client = new x402Client((_version, options) => {
  const chosen = values.network ? options.find((o) => o.network === values.network) : options[0];
  if (!chosen) {
    throw new Error(
      `The API doesn't offer ${values.network}; it offers ${options.map((o) => o.network).join(", ")}`,
    );
  }
  return chosen;
});

let buyer: string;
if (values.network?.startsWith("near:")) {
  const accountId = process.env.BUYER_NEAR_ACCOUNT;
  const secretKey = process.env.BUYER_NEAR_KEY;
  if (!accountId || !secretKey?.startsWith("ed25519:")) {
    console.error(
      "Set BUYER_NEAR_ACCOUNT to a NEAR testnet account holding USDC and BUYER_NEAR_KEY to one of its full-access keys (ed25519:…).",
    );
    process.exit(1);
  }
  const rpcUrl = process.env.BUYER_NEAR_RPC_URL;
  const signer = createClientNearSigner({
    accountId,
    secretKey: secretKey as `ed25519:${string}`,
    ...(rpcUrl && { rpcUrls: { [values.network]: rpcUrl } }),
  });
  client.register("near:*", new ExactNearScheme(signer));
  buyer = accountId;
} else if (values.network?.startsWith("solana:")) {
  const key = process.env.BUYER_SOLANA_KEY;
  if (!key) {
    console.error("Set BUYER_SOLANA_KEY to a base58 64-byte Solana secret key holding USDC.");
    process.exit(1);
  }
  const signer = await createKeyPairSignerFromBytes(getBase58Encoder().encode(key));
  client.register("solana:*", new ExactSvmScheme(signer));
  buyer = signer.address;
} else {
  const key = process.env.BUYER_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    console.error("Set BUYER_PRIVATE_KEY to a 0x-prefixed hex private key holding testnet USDC.");
    process.exit(1);
  }
  const account = privateKeyToAccount(key as `0x${string}`);
  client.register("eip155:*", new ExactEvmScheme(account));
  buyer = account.address;
}

console.log(`Buyer ${buyer} calling ${values.url}`);
const response = await wrapFetchWithPayment(fetch, client)(values.url);
console.log(`HTTP ${response.status}:`, await response.text());
const settlement = response.headers.get("PAYMENT-RESPONSE");
if (settlement) console.log("Settlement:", decodePaymentResponseHeader(settlement));
