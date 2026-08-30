import { createPublicClient, createWalletClient, http, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { zeroGMainnet } from "viem/chains";

const identityRegistryAddress = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

const abi = [
  {
    type: "function",
    name: "register",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "Registered",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "agentAddress", type: "address", indexed: true },
      { name: "agentURI", type: "string", indexed: false },
    ],
  },
] as const;

const privateKey = process.env.PRIVATE_KEY;
if (!privateKey) throw new Error("PRIVATE_KEY is required");
const rpcUrl = process.env.RPC_URL ?? zeroGMainnet.rpcUrls.default.http[0];

const card = await Bun.file(new URL("./agent-card.json", import.meta.url)).json();
const agentUri = `data:application/json;base64,${Buffer.from(JSON.stringify(card), "utf8").toString(
  "base64"
)}`;

const account = privateKeyToAccount(
  privateKey.startsWith("0x") ? (privateKey as `0x${string}`) : (`0x${privateKey}` as `0x${string}`)
);
const client = createPublicClient({ chain: zeroGMainnet, transport: http(rpcUrl) });
const wallet = createWalletClient({ chain: zeroGMainnet, transport: http(rpcUrl), account });

console.log(
  `Registering agent "${card.name}" from ${account.address} on ${client.chain.name} (${client.chain.id})`
);

const hash = await wallet.writeContract({
  address: identityRegistryAddress,
  abi,
  functionName: "register",
  args: [agentUri],
});

console.log(`Transaction: https://chainscan.0g.ai/tx/${hash}`);
