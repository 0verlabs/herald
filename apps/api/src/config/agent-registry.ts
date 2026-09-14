import { CHAIN_IDS } from "./chain";

export const REGISTRIES = {
  [CHAIN_IDS.zeroG]: {
    identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    reputationRegistry: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
  },
  [CHAIN_IDS.zeroGTestnet]: {
    identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    reputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
  },
} as const;
