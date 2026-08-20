import { createConfig } from "ponder";
import { zeroGMainnet, zeroGTestnet } from "viem/chains";

import { identityRegistryAbi } from "./abis/IdentityRegistry";
// import { reputationRegistryAbi } from "./abis/ReputationRegistry";

export default createConfig({
  database: {
    kind: "postgres",
    connectionString: process.env.DATABASE_URL!,
  },
  chains: {
    zeroGMainnet: {
      id: zeroGMainnet.id,
      rpc: process.env.RPC_URL_16661!,
    },
    zeroGTestnet: {
      id: zeroGTestnet.id,
      rpc: process.env.RPC_URL_16602!,
    },
  },
  contracts: {
    IdentityRegistry: {
      abi: identityRegistryAbi,
      chain: {
        zeroGMainnet: {
          address: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
          startBlock: "latest",
        },
        zeroGTestnet: {
          address: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
          startBlock: "latest",
        },
      },
    },
    // ReputationRegistry: {
    //   chain: "zeroGTestnet",
    //   abi: reputationRegistryAbi,
    //   address: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
    //   startBlock: "latest",
    // },
  },
});
