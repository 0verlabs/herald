import { CHAIN_IDS } from "./chain";

export const REGISTRIES = {
  [CHAIN_IDS.arcTestnet]: {
    identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    reputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
  },
} as const;
