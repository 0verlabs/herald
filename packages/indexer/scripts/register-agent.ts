import { readFile } from "node:fs/promises";

import { createPublicClient, createWalletClient, http, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { zeroGMainnet } from "viem/chains";

import { identityRegistryAbi } from "../abis/IdentityRegistry";
import { agentRegistrationFileSchema } from "../src/types/identity-registry";

const identityRegistryAddress = "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";

const privateKey = process.env.PRIVATE_KEY;
if (!privateKey) throw new Error("PRIVATE_KEY env variable is required");
if (!/^0x[0-9a-f]{64}$/i.test(privateKey))
  throw new Error("PRIVATE_KEY must be a 32-byte hex string with a 0x prefix");

const rpcUrl = process.env.RPC_URL_16661;
if (!rpcUrl) throw new Error("RPC_URL_16661 env variable is required");

const registrationFile = agentRegistrationFileSchema.parse(
  await readFile(new URL("./agent.json", import.meta.url), "utf8").then(JSON.parse)
);

const account = privateKeyToAccount(privateKey as `0x${string}`);
const agentUri = `data:application/json;base64,${btoa(JSON.stringify(registrationFile))}`;

const walletClient = createWalletClient({ account, chain: zeroGMainnet, transport: http(rpcUrl) });
const publicClient = createPublicClient({ chain: zeroGMainnet, transport: http(rpcUrl) });

console.log(`Registering "${registrationFile.name}" from ${account.address} on 0G testnet...`);

const hash = await walletClient.writeContract({
  address: identityRegistryAddress,
  abi: identityRegistryAbi,
  functionName: "register",
  args: [agentUri],
});

console.log(`Transaction sent: ${hash}`);

const receipt = await publicClient.waitForTransactionReceipt({ hash });

const [agentId] = parseEventLogs({ abi: identityRegistryAbi, logs: receipt.logs }).flatMap((log) =>
  log.eventName === "Registered" ? [log.args.agentId] : []
);
if (agentId === undefined) throw new Error(`Transaction ${hash} did not emit a Registered event`);

console.log(`Agent registered with ID ${agentId}`);
