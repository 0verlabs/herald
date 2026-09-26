import {
  type Chain,
  chainSchema,
  type EvmChain,
  evmChainSchema,
  type Network,
  networkByChain,
  viemChainByChain,
  type Wallet,
} from "@hrld/core";
import pc from "picocolors";
import { createPublicClient, createWalletClient, formatEther, type Hex, http } from "viem";
import { z } from "zod";
import { zodCommand } from "zod-commander";
import { getValidAccessToken } from "../lib/credentials.ts";
import { openWalletSession, type WalletSession } from "../lib/privy.ts";
import { toWalletAccount } from "../lib/viem.ts";
import { chainDisplayName, networkDisplayName } from "../utils/chain.ts";
import { CliError } from "../utils/errors.ts";
import { err, fields, isJson, ok } from "../utils/result.ts";

// Only 0G is supported today, but every command takes `--chain` so adding a
// network is a change to the enum in @hrld/core rather than to each command.
const evmChainOpt = evmChainSchema.prefault("0g").describe("c;Chain to operate on");

async function openSession() {
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new CliError("NOT_LOGGED_IN", "Not logged in.", "Run `hrld auth login`.");

  return openWalletSession(accessToken);
}

function requireWallet(session: WalletSession, chain: Chain): Wallet {
  const network = networkByChain[chain];
  const wallet = session.wallets.find((candidate) => candidate.network === network);
  if (!wallet)
    throw new CliError(
      "WALLET_NOT_FOUND",
      `This account has no ${network} embedded wallet.`,
      "Create one by signing in to the Herald app, then run this command again.",
    );

  return wallet;
}

const evmSignMessage = zodCommand({
  name: "sign-message",
  description: "Sign a plaintext message with the embedded EVM wallet",
  opts: {
    chain: evmChainOpt,
    message: z.string().describe("m;The message to sign"),
  },
  action: async (_args, opts) => {
    const json = isJson(evmSignMessage);

    const result = await signMessage(opts.chain, opts.message).catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);

    ok(
      fields([
        ["Address", pc.cyan(result.address)],
        ["Message", result.message],
        ["Signature", pc.cyan(result.signature)],
      ]),
      result,
    )(json);
  },
});

async function signMessage(chain: EvmChain, message: string) {
  const session = await openSession();
  const wallet = requireWallet(session, chain);

  return {
    address: wallet.address,
    message,
    signature: await toWalletAccount(session, wallet).signMessage({ message }),
  };
}

const typedDataSchema = z.object({
  domain: z.record(z.string(), z.unknown()).prefault({}),
  types: z.record(z.string(), z.unknown()),
  primaryType: z.string(),
  message: z.record(z.string(), z.unknown()),
});

const jsonStringSchema = z.string().transform((str, ctx) => {
  try {
    return JSON.parse(str);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid JSON format";

    ctx.addIssue({
      code: "invalid_format",
      format: "json_string",
      input: str,
      message: message,
    });

    return z.NEVER;
  }
});

const evmSignTypedData = zodCommand({
  name: "sign-typed-data",
  description: "Sign EIP-712 typed data with the embedded EVM wallet",
  opts: {
    chain: evmChainOpt,
    data: jsonStringSchema
      .pipe(typedDataSchema)
      .describe("d;EIP-712 payload as JSON: { domain, types, primaryType, message }"),
  },
  action: async (_args, opts) => {
    const json = isJson(evmSignTypedData);

    const result = await signTypedData(opts.chain, opts.data).catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);

    ok(
      fields([
        ["Address", pc.cyan(result.address)],
        ["Type", result.primaryType],
        ["Signature", pc.cyan(result.signature)],
      ]),
      result,
    )(json);
  },
});

async function signTypedData(chain: EvmChain, typedData: z.infer<typeof typedDataSchema>) {
  const session = await openSession();
  const wallet = requireWallet(session, chain);

  return {
    address: wallet.address,
    primaryType: typedData.primaryType,
    // Privy validates the typed data itself; viem's generics are stricter than
    // anything that survives a round trip through JSON on the command line.
    signature: await toWalletAccount(session, wallet).signTypedData(typedData),
  };
}

const evmSendTx = zodCommand({
  name: "send-tx",
  description: "Sign and broadcast a transaction with the embedded EVM wallet",
  opts: {
    chain: evmChainOpt,
    to: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/, "Expected a 0x-prefixed address")
      .describe("t;Recipient address"),
    value: z.coerce.bigint().optional().describe("v;Amount to send, in wei"),
    data: z
      .string()
      .regex(/^0x[0-9a-fA-F]*$/, "Expected 0x-prefixed hex")
      .optional()
      .describe("d;Calldata as 0x-prefixed hex"),
  },
  action: async (_args, opts) => {
    const json = isJson(evmSendTx);

    const result = await sendTransaction(opts).catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);

    ok(
      fields([
        ["Chain", pc.bold(chainDisplayName[result.chain])],
        ["From", pc.cyan(result.from)],
        ["To", pc.cyan(result.to)],
        ["Hash", pc.cyan(result.hash)],
      ]),
      result,
    )(json);
  },
});

async function sendTransaction(opts: {
  chain: EvmChain;
  to: string;
  value?: bigint;
  data?: string;
}) {
  const session = await openSession();
  const wallet = requireWallet(session, opts.chain);

  // viem prepares the transaction (nonce, gas, fees) and broadcasts it against
  // the chain's own RPC; Privy only produces the signature.
  const hash = await createWalletClient({
    account: toWalletAccount(session, wallet),
    chain: viemChainByChain[opts.chain],
    transport: http(),
  }).sendTransaction({
    to: opts.to as Hex,
    ...(opts.value !== undefined && { value: opts.value }),
    ...(opts.data && { data: opts.data as Hex }),
  });

  return { chain: opts.chain, from: wallet.address, to: opts.to, hash };
}

const address = zodCommand({
  name: "address",
  description: "Show the embedded wallet addresses",
  opts: {
    chain: chainSchema.optional().describe("c;Limit the output to a single chain"),
  },
  action: async (_args, opts) => {
    const json = isJson(address);

    const result = await listAddresses(opts.chain).catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);

    const stdout =
      "address" in result
        ? fields([
            ["Chain", pc.bold(chainDisplayName[result.chain])],
            ["Address", pc.cyan(result.address)],
          ])
        : fields(
            result.wallets.map((wallet): [string, unknown] => [
              networkDisplayName[wallet.network],
              pc.cyan(wallet.address),
            ]),
          );

    ok(stdout, result)(json);
  },
});

async function listAddresses(
  chain: Chain | undefined,
): Promise<
  { chain: Chain; address: string } | { wallets: Array<{ network: Network; address: string }> }
> {
  const session = await openSession();
  if (chain) return { chain, address: requireWallet(session, chain).address };

  return {
    wallets: session.wallets.map((wallet) => ({
      network: wallet.network,
      address: wallet.address,
    })),
  };
}

const balance = zodCommand({
  name: "balance",
  description: "Show the embedded wallet's native token balance",
  opts: {
    chain: evmChainOpt,
  },
  action: async (_args, opts) => {
    const json = isJson(balance);

    const result = await readBalance(opts.chain).catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);

    ok(
      fields([
        ["Chain", pc.bold(chainDisplayName[result.chain])],
        ["Address", pc.cyan(result.address)],
        ["Balance", pc.bold(result.balance)],
      ]),
      result,
    )(json);
  },
});

async function readBalance(chain: EvmChain) {
  const session = await openSession();
  const wallet = requireWallet(session, chain);
  const config = viemChainByChain[chain];

  // A balance is a plain chain read, so it goes straight to the chain's RPC
  // rather than through Privy.
  const wei = await createPublicClient({ chain: config, transport: http() }).getBalance({
    address: wallet.address as Hex,
  });

  return {
    chain,
    address: wallet.address,
    balance: `${formatEther(wei)} ${config.nativeCurrency.symbol}`,
  };
}

const evm = zodCommand({
  name: "evm",
  description: "EVM wallet operations",
})
  .addCommand(evmSignMessage)
  .addCommand(evmSignTypedData)
  .addCommand(evmSendTx);

export const wallet = zodCommand({
  name: "wallet",
  description: "Operate the Privy embedded wallet for the authenticated account",
})
  .addCommand(address)
  .addCommand(balance)
  .addCommand(evm);
