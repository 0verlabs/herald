import { createConfig } from "ponder";
import { arcTestnet } from "viem/chains";

import { identityRegistryAbi } from "./abis/IdentityRegistry";
// import { reputationRegistryAbi } from "./abis/ReputationRegistry";

export default createConfig({
  database: {
    kind: "postgres",
    connectionString: process.env.DATABASE_URL!,
  },
  chains: {
    arcTestnet: {
      id: arcTestnet.id,
      rpc: process.env.RPC_URL_5042002!,
    },
  },
  contracts: {
    IdentityRegistry: {
      chain: "arcTestnet",
      abi: identityRegistryAbi,
      address: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
      startBlock: "latest",
    },
    // ReputationRegistry: {
    //   chain: "arcTestnet",
    //   abi: reputationRegistryAbi,
    //   address: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
    //   startBlock: "latest",
    // },
  },
});
