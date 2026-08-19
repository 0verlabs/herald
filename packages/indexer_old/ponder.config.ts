import { createConfig } from "ponder";
import { zeroGTestnet } from "viem/chains";

import { identityRegistryAbi } from "./abis/IdentityRegistry";
// import { reputationRegistryAbi } from "./abis/ReputationRegistry";

export default createConfig({
  database: {
    kind: "postgres",
    connectionString: process.env.DATABASE_URL!,
  },
  chains: {
    zeroGTestnet: {
      id: zeroGTestnet.id,
      rpc: process.env.RPC_URL_16602!,
    },
  },
  contracts: {
    IdentityRegistry: {
      chain: "zeroGTestnet",
      abi: identityRegistryAbi,
      address: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
      startBlock: "latest",
    },
    // ReputationRegistry: {
    //   chain: "zeroGTestnet",
    //   abi: reputationRegistryAbi,
    //   address: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
    //   startBlock: "latest",
    // },
  },
});
