import { type EvmChain, viemChainByChain } from "@hrld/core";
import pc from "picocolors";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatEther,
  formatUnits,
  type Hex,
  http,
} from "viem";
import { z } from "zod";
import { zodCommand } from "zod-commander";
import { getCached, setCached } from "../lib/cache.ts";
import { openSession, requireWallet } from "../lib/session.ts";
import { toWalletAccount } from "../lib/viem.ts";
import { activeChain, chainDisplayName, networkDisplayName } from "../utils/chain.ts";
import { jsonStringSchema } from "../utils/json.ts";
import { err, fields, isJson, ok } from "../utils/result.ts";

const evmSignMessage = zodCommand({
  name: "sign-message",
  description: "Sign a plaintext message with active EVM wallet",
  opts: {
    message: z.string().describe("m;The message to sign"),
  },
  action: async (_args, opts) => {
    const json = isJson(evmSignMessage);

    const result = await signMessage(activeChain, opts.message).catch((error: Error) => error);
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

const evmSignTypedData = zodCommand({
  name: "sign-typed-data",
  description: "Sign EIP-712 typed data with active EVM wallet",
  opts: {
    data: jsonStringSchema
      .pipe(typedDataSchema)
      .describe("d;EIP-712 payload as JSON: { domain, types, primaryType, message }"),
  },
  action: async (_args, opts) => {
    const json = isJson(evmSignTypedData);

    const result = await signTypedData(activeChain, opts.data).catch((error: Error) => error);
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
  description: "Sign and broadcast a transaction with active EVM wallet",
  opts: {
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

    const result = await sendTransaction({ ...opts, chain: activeChain }).catch(
      (error: Error) => error,
    );
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
  description: "Show wallet address",
  action: async () => {
    const json = isJson(address);

    const result = await listAddresses().catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);

    ok(
      fields(
        result.wallets.map((wallet): [string, unknown] => [
          networkDisplayName[wallet.network],
          pc.cyan(wallet.address),
        ]),
      ),
      result,
    )(json);
  },
});

async function listAddresses() {
  const session = await openSession();

  // Privy also provisions an SVM embedded wallet, but the CLI is EVM-only for
  // now, so only EVM addresses are surfaced.
  return {
    wallets: session.wallets
      .filter((wallet) => wallet.network === "evm")
      .map((wallet) => ({
        network: wallet.network,
        address: wallet.address,
      })),
  };
}

const balance = zodCommand({
  name: "balance",
  description: "Show wallet's token balance",
  opts: {
    token: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/, "Expected a 0x-prefixed address")
      .optional()
      .describe("t;ERC-20 token contract address; defaults to the chain's native token"),
  },
  action: async (_args, opts) => {
    const json = isJson(balance);

    const result = await (
      opts.token ? readTokenBalance(activeChain, opts.token) : readBalance(activeChain)
    ).catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);

    ok(
      fields([
        ["Chain", pc.bold(chainDisplayName[result.chain])],
        ["Address", pc.cyan(result.address)],
        ...(result.token ? [["Token", pc.cyan(result.token)] as [string, unknown]] : []),
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
    // Present so the ternary in the action stays a proper union rather than
    // collapsing into the token-balance shape, which is otherwise a subtype.
    token: null,
  };
}

async function readTokenBalance(chain: EvmChain, token: string) {
  const session = await openSession();
  const wallet = requireWallet(session, chain);
  const client = createPublicClient({ chain: viemChainByChain[chain], transport: http() });
  const contract = { address: token as Hex, abi: erc20Abi } as const;

  const [wei, { decimals, symbol }] = await Promise.all([
    client.readContract({ ...contract, functionName: "balanceOf", args: [wallet.address as Hex] }),
    readTokenMetadata(client, chain, contract),
  ]);

  return {
    chain,
    address: wallet.address,
    token: contract.address,
    balance: `${formatUnits(wei, decimals)} ${symbol}`,
  };
}

type TokenMetadata = { decimals: number; symbol: string };

async function readTokenMetadata(
  client: ReturnType<typeof createPublicClient>,
  chain: EvmChain,
  contract: { address: Hex; abi: typeof erc20Abi },
): Promise<TokenMetadata> {
  // Decimals and symbol are immutable for a deployed contract, so they cache
  // forever; only the balance itself is read fresh on every call.
  const key = `${chain}:${contract.address.toLowerCase()}`;
  const cached = getCached<TokenMetadata>("token-metadata", key);
  if (cached) return cached;

  const [decimals, symbol] = await Promise.all([
    client.readContract({ ...contract, functionName: "decimals" }),
    client.readContract({ ...contract, functionName: "symbol" }),
  ]);

  const metadata = { decimals, symbol };
  setCached("token-metadata", key, metadata);
  return metadata;
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
